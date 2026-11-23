import { createServer } from "node:http"
import { once } from "node:events"
import { gunzipSync } from "node:zlib"
import { waitFor } from "./contract/wait.ts"

/** A Sentry ingest on a local port: the DSN points the SDK at it, so a test sees what would leave the process. */
export interface FakeSentry {
  readonly dsn: string
  /** The error events of every envelope received, as the SDK sent them. */
  readonly events: unknown[]
  /** Every request that reached the ingest, envelopes of any kind included. */
  readonly requests: () => number
  /** Resolves once `count` events arrived; fails the test after `eventWaitMs`. */
  readonly eventsArrived: (count: number) => Promise<void>
  readonly stop: () => Promise<void>
}

// An event leaves after the SDK flushed it; a Worker sends it from `waitUntil`.
const eventWaitMs = 5000

// A Node server, not `Bun.serve`: the web tests replace the global `Response` with happy-dom's, which Bun cannot send.
export async function startFakeSentry(): Promise<FakeSentry> {
  const events: unknown[] = []
  let requests = 0
  const server = createServer((request, response) => {
    requests += 1
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const raw = Buffer.concat(chunks)
      const body = request.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw
      events.push(...envelopeEvents(body.toString("utf8")))
      // The browser SDK posts across origins.
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      })
      response.end("{}")
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("no TCP port")
  return {
    dsn: `http://public@127.0.0.1:${address.port}/1`,
    events,
    requests: () => requests,
    eventsArrived: (count) =>
      waitFor(async () => events.length >= count, eventWaitMs, `${count} Sentry events`),
    stop: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, "close")
    },
  }
}

// An envelope is newline-separated JSON: its header, then a header and a payload per item.
function envelopeEvents(envelope: string): unknown[] {
  const [, ...lines] = envelope.split("\n").filter((line) => line !== "")
  const events: unknown[] = []
  for (let at = 0; at + 1 < lines.length; at += 2) {
    const header: { type?: string } = JSON.parse(lines[at] ?? "{}")
    if (header.type === "event") events.push(JSON.parse(lines[at + 1] ?? "null"))
  }
  return events
}
