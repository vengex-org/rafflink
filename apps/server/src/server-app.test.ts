import { websocket } from "@hono/bun"
import { afterEach, describe, expect, it } from "bun:test"
import { viewerRoomHeader } from "@rafflink/core/http/viewer-socket"
import { Hono } from "hono"
import { createServerApp } from "./server-app.ts"
import { viewerTopic } from "./local-room-directory.ts"

const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

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
        viewerPushText: () => {
          server.publish(viewerTopic("g1"), "pushed while the first message was built")
          return "first"
        },
      },
      fakeTwitch: null,
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
