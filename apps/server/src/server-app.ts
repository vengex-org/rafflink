import { serveStatic, upgradeWebSocket } from "@hono/bun"
import { apiPrefixes, fakeTwitchPrefixes } from "@rafflink/core/http/api-paths"
import { staticCacheControl } from "@rafflink/core/http/static-headers"
import { Hono, type MiddlewareHandler } from "hono"
import { liveTopic } from "./local-room-directory.ts"

export interface ServerAppOptions {
  /** The HTTP app of core. */
  readonly api: Hono
  /** Mounted under {@link fakeTwitchPrefixes} in dev only. */
  readonly fakeTwitch: Hono | null
  /** The built SPA files except `index.html`, which the HTTP app of core answers as a page; null serves no files. */
  readonly staticDir: string | null
}

/**
 * Everything the Bun server answers except the dev SPA bundle: the API, WebSocket upgrades of the
 * live and overlay routes, the fake Twitch in dev, the SPA files, and the pages of core for every other path.
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
    const files = serveStatic({
      root: staticDir,
      onFound: (_path, c) => c.header("Cache-Control", staticCacheControl(c.req.path)),
    })
    app.use("*", (c, next) => (isPagePath(c.req.path) ? next() : files(c, next)))
  }
  app.notFound((c) => api.fetch(c.req.raw))

  return app
}

/** The paths `serveStatic` would answer with `index.html` itself, bypassing the page of core. */
function isPagePath(pathname: string): boolean {
  return pathname.endsWith("/") || pathname === "/index.html"
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
