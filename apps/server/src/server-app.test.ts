import { websocket } from "@hono/bun"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { viewerRoomHeader } from "@rafflink/core/http/viewer-socket"
import { MemorySitePresence } from "@rafflink/core/lib/memory-site-presence"
import { presenceKindHeader, type PresenceCounts } from "@rafflink/core/presence/site-presence"
import { Hono } from "hono"
import { createServerApp } from "./server-app.ts"
import { liveTopic, overlayTopic, viewerTopic } from "./local-room-directory.ts"

const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

const unusedText = (): string => {
  throw new Error("not this socket")
}
const keepSocket = () => () => {}

describe("viewer socket", () => {
  it("builds the first message after the subscribe, so a push made while it is built arrives", async () => {
    const api = new Hono().get("/api/g/:code/live", (c) =>
      c.body(null, 204, { [viewerRoomHeader]: "g1" }),
    )
    const server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => app.fetch(request, bunServer),
      websocket,
    })
    stops.push(() => void server.stop(true))
    const app = createServerApp({
      api,
      rooms: {
        attachSocket: keepSocket,
        liveSnapshotText: unusedText,
        overlaySnapshotText: unusedText,
        viewerPushText: () => {
          server.publish(viewerTopic("g1"), "pushed while the first message was built")
          return "first"
        },
      },
      presence: new MemorySitePresence(),
      fakeTwitch: null,
      fakeKick: null,
      fakeYouTube: null,
      staticDir: null,
    })

    const socket = new WebSocket(`ws://localhost:${server.port}/api/g/ABCDE/live`)
    const messages: string[] = []
    socket.addEventListener("message", (event) => messages.push(String(event.data)))
    await new Promise((resolve) => setTimeout(resolve, 300))
    socket.close()

    expect(messages).toEqual(["pushed while the first message was built", "first"])
  })
})

describe.each([
  { name: "live", path: "/api/live/g1", topic: liveTopic("g1") },
  { name: "overlay", path: "/api/overlay/g1/token", topic: overlayTopic("g1") },
])("$name socket", ({ path, topic, name }) => {
  it("reads the first message after the subscribe, so a push made while it is read arrives", async () => {
    const api = new Hono().get(path, (c) => c.json({ answeredByTheCheck: true }))
    const server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => app.fetch(request, bunServer),
      websocket,
    })
    stops.push(() => void server.stop(true))
    const read = (id: string): string => {
      expect(id).toBe("g1")
      server.publish(topic, "pushed while the snapshot was read")
      return "snapshot"
    }
    const app = createServerApp({
      api,
      rooms: {
        attachSocket: keepSocket,
        viewerPushText: unusedText,
        liveSnapshotText: name === "live" ? read : unusedText,
        overlaySnapshotText: name === "overlay" ? read : unusedText,
      },
      presence: new MemorySitePresence(),
      fakeTwitch: null,
      fakeKick: null,
      fakeYouTube: null,
      staticDir: null,
    })

    const socket = new WebSocket(`ws://localhost:${server.port}${path}`)
    const messages: string[] = []
    socket.addEventListener("message", (event) => messages.push(String(event.data)))
    await new Promise((resolve) => setTimeout(resolve, 300))
    socket.close()

    expect(messages).toEqual(["pushed while the snapshot was read", "snapshot"])
  })
})

describe("a socket whose first message cannot be built", () => {
  it("closes with an internal error code and logs the error class without the message", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    const api = new Hono().get("/api/live/g1", (c) => c.json({ answeredByTheCheck: true }))
    const server = Bun.serve({
      port: 0,
      fetch: (request, bunServer) => app.fetch(request, bunServer),
      websocket,
    })
    stops.push(() => void server.stop(true))
    const app = createServerApp({
      api,
      rooms: {
        attachSocket: keepSocket,
        viewerPushText: unusedText,
        overlaySnapshotText: unusedText,
        liveSnapshotText: () => {
          throw new RangeError("database is locked")
        },
      },
      presence: new MemorySitePresence(),
      fakeTwitch: null,
      fakeKick: null,
      fakeYouTube: null,
      staticDir: null,
    })

    const socket = new WebSocket(`ws://localhost:${server.port}/api/live/g1`)
    const messages: string[] = []
    socket.addEventListener("message", (event) => messages.push(String(event.data)))
    const closed = await new Promise<CloseEvent>((resolve) =>
      socket.addEventListener("close", resolve),
    )

    expect(closed.code).toBe(1011)
    expect(messages).toEqual([])
    expect(logged).toHaveBeenCalledWith("socket first message failed", {
      topic: liveTopic("g1"),
      errorClass: "RangeError",
    })
    logged.mockRestore()
  })
})

function startPresence(api: Hono) {
  const presence = new MemorySitePresence()
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  })
  stops.push(() => void server.stop(true))
  const app = createServerApp({
    api,
    rooms: {
      attachSocket: keepSocket,
      viewerPushText: unusedText,
      liveSnapshotText: unusedText,
      overlaySnapshotText: unusedText,
    },
    presence,
    fakeTwitch: null,
    fakeKick: null,
    fakeYouTube: null,
    staticDir: null,
  })
  const open = (kind: string) =>
    new WebSocket(`ws://localhost:${server.port}/api/presence?kind=${kind}`)
  return { presence, open }
}

async function countsReach(presence: MemorySitePresence, expected: PresenceCounts): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (Bun.deepEquals(await presence.counts(), expected)) return
    await Bun.sleep(10)
  }
  expect(await presence.counts()).toEqual(expected)
}

describe("presence socket", () => {
  it("counts an open socket under its page kind and drops it when it closes", async () => {
    const { presence, open } = startPresence(
      new Hono().get("/api/presence", (c) =>
        c.body(null, 204, { [presenceKindHeader]: c.req.query("kind") ?? "" }),
      ),
    )

    const home = open("home")
    open("giveaway")
    await countsReach(presence, {
      total: 2,
      byKind: { home: 1, legal: 0, dashboard: 0, giveaway: 1, other: 0 },
    })
    home.close()

    await countsReach(presence, {
      total: 1,
      byKind: { home: 0, legal: 0, dashboard: 0, giveaway: 1, other: 0 },
    })
  })

  it("counts nothing for a socket the route of core refuses", async () => {
    const { presence, open } = startPresence(
      new Hono().get("/api/presence", (c) => c.json({ error: "forbidden-origin" }, 403)),
    )

    const socket = open("home")
    await new Promise((resolve) => socket.addEventListener("close", resolve))

    expect((await presence.counts()).total).toBe(0)
  })
})
