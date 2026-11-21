import { fromHex, toHex } from "../../src/lib/encoding.ts"
import { quicknet, roundPath } from "../../src/lib/drand.ts"

/** How the fake answers a round request. */
export type DrandMode = "published" | "not-yet" | "down"

export interface RunningFakeDrand {
  readonly origin: string
  mode: DrandMode
  /** Rounds requested so far, in order. */
  readonly requested: number[]
  /** The randomness the fake publishes for `round`, as the draw seed. */
  seedOf(round: number): Promise<Uint8Array<ArrayBuffer>>
  stop(): Promise<void>
}

/** A drand HTTP API on its own port that publishes the quicknet path with signatures it made up: only the SHA-256 link of randomness to signature holds. */
export function startFakeDrand(): RunningFakeDrand {
  const fake: RunningFakeDrand = {
    origin: "",
    mode: "published",
    requested: [],
    seedOf: async (round) => (await publish(round)).seed,
    stop: async () => {
      await server.stop(true)
    },
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const { pathname } = new URL(request.url)
      const round = Number(pathname.split("/").at(-1))
      if (pathname !== roundPath(quicknet.chainHash, round))
        return new Response("", { status: 404 })
      fake.requested.push(round)
      if (fake.mode === "down") return new Response("", { status: 500 })
      if (fake.mode === "not-yet") {
        return new Response("Requested future beacon", { status: 425 })
      }
      const { signature, seed } = await publish(round)
      return Response.json({ round, randomness: toHex(seed), signature })
    },
  })
  return Object.assign(fake, { origin: server.url.origin })
}

async function publish(round: number) {
  const signature = toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`round ${round}`)),
    ),
  )
  const signed = fromHex(signature)
  if (signed === null) throw new Error("hex of a digest is hex")
  return { signature, seed: new Uint8Array(await crypto.subtle.digest("SHA-256", signed)) }
}
