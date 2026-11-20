import { serveStatic, upgradeWebSocket } from "@hono/bun"
import { Hono, type MiddlewareHandler } from "hono"
import { liveTopic } from "./local-room-directory.ts"

/** Paths the HTTP app of core answers. */
export const apiPrefixes = ["/api/", "/auth/"] as const

/** Paths of the fake Twitch; without it they answer like any other unknown API path. */
export const fakeTwitchPrefixes = ["/oauth2/", "/helix/", "/eventsub/"] as const

export interface ServerAppOptions {
  /** The HTTP app of core. */
  readonly api: Hono
  /** Mounted under {@link fakeTwitchPrefixes} in dev only. */
  readonly fakeTwitch: Hono | null
  /** The built SPA; null serves no files. */
  readonly staticDir: string | null
}

/**
 * Everything the Bun server answers except the dev SPA bundle: the API, WebSocket upgrades of the
 * live and overlay routes, the fake Twitch in dev, and the SPA files with an `index.html` fallback.
 */
export function createServerApp(options: ServerAppOptions): Hono {
  const { api, fakeTwitch, staticDir } = options
  const app = new Hono()

  app.get("/api/live/:id", liveSocket(api))
  app.get("/api/overlay/:id/:token", liveSocket(api))
  for (const prefix of apiPrefixes) app.all(`${prefix}*`, (c) => api.fetch(c.req.raw))
  for (const prefix of fakeTwitchPrefixes) {
    app.all(`${prefix}*`, (c) =>
      fakeTwitch === null ? api.fetch(c.req.raw) : fakeTwitch.fetch(c.req.raw, c.env),
    )
  }
  if (staticDir !== null) {
    app.use("*", serveStatic({ root: staticDir }))
    app.get("*", serveStatic({ root: staticDir, path: "index.html" }))
  }
  app.notFound((c) => api.fetch(c.req.raw))

  return app
}

interface Subscribable {
  subscribe(topic: string): void
}

/**
 * Turns a WebSocket upgrade of a live route into a subscription to the room's topic. The JSON route of
 * the same path decides who may connect and what the first message is, so the checks live in one place.
 */
function liveSocket(api: Hono): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const snapshot = await api.fetch(c.req.raw)
    if (!snapshot.ok) return snapshot
    const first = await snapshot.text()
    const topic = liveTopic(c.req.param("id") ?? "")
    return upgradeWebSocket(() => ({
      onOpen: (_event, ws) => {
        if (!isSubscribable(ws.raw)) throw new TypeError("the socket cannot subscribe to a topic")
        ws.raw.subscribe(topic)
        ws.send(first)
      },
    }))(c, next)
  }
}

function isSubscribable(raw: unknown): raw is Subscribable {
  return (
    typeof raw === "object"
    && raw !== null
    && "subscribe" in raw
    && typeof raw.subscribe === "function"
  )
}
