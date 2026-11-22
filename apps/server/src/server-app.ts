import { serveStatic, upgradeWebSocket } from "@hono/bun"
import { apiPrefixes, fakeTwitchPrefixes } from "@rafflink/core/http/api-paths"
import { staticCacheControl } from "@rafflink/core/http/static-headers"
import { errorClass } from "@rafflink/core/lib/error-class"
import { viewerRoomHeader } from "@rafflink/core/http/viewer-socket"
import { Hono, type Context, type MiddlewareHandler } from "hono"
import {
  liveTopic,
  overlayTopic,
  viewerTopic,
  type LocalRoomDirectory,
} from "./local-room-directory.ts"

export interface ServerAppOptions {
  /** The HTTP app of core. */
  readonly api: Hono
  /** Where a socket gets its first message. */
  readonly rooms: Pick<
    LocalRoomDirectory,
    "viewerPushText" | "liveSnapshotText" | "overlaySnapshotText" | "attachSocket"
  >
  /** Mounted under {@link fakeTwitchPrefixes} in dev only. */
  readonly fakeTwitch: Hono | null
  /** The built SPA files except `index.html`, which the HTTP app of core answers as a page; null serves no files. */
  readonly staticDir: string | null
}

/**
 * Everything the Bun server answers except the dev SPA bundle: the API, WebSocket upgrades of the
 * live, overlay and viewer routes, the fake Twitch in dev, the SPA files, and the pages of core for every other path.
 */
export function createServerApp(options: ServerAppOptions): Hono {
  const { api, rooms, fakeTwitch, staticDir } = options
  const app = new Hono()

  app.get(
    "/api/live/:id",
    socketRoute(api, rooms, (c) => {
      const id = c.req.param("id") ?? ""
      return { roomId: id, topic: liveTopic(id), first: () => rooms.liveSnapshotText(id) }
    }),
  )
  app.get(
    "/api/overlay/:id/:token",
    socketRoute(api, rooms, (c) => {
      const id = c.req.param("id") ?? ""
      return { roomId: id, topic: overlayTopic(id), first: () => rooms.overlaySnapshotText(id) }
    }),
  )
  app.get(
    "/api/g/:code/live",
    socketRoute(api, rooms, (_c, checked) => {
      const roomId = checked.headers.get(viewerRoomHeader)
      if (roomId === null) throw new TypeError("the viewer socket route named no room")
      return { roomId, topic: viewerTopic(roomId), first: () => rooms.viewerPushText(roomId) }
    }),
  )
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

// What a socket that never opened has to forget when it closes.
const keepNothing = (): void => {}

// RFC 6455: the server hit an unexpected condition and cannot serve the socket.
const internalErrorCloseCode = 1011

interface Subscribable {
  subscribe(topic: string): void
}

/** What a socket is subscribed to and the message it gets on open; `first` runs after the subscribe, so no push falls between the two. */
interface Subscription {
  readonly roomId: string
  readonly topic: string
  readonly first: () => string
}

/**
 * Turns a WebSocket upgrade into a subscription to a room's topic. The JSON route of core on the same
 * path decides who may connect, so the checks live in one place; `subscribe` says what the socket gets.
 */
function socketRoute(
  api: Hono,
  rooms: Pick<LocalRoomDirectory, "attachSocket">,
  subscribe: (c: Context, checked: Response) => Subscription,
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const checked = await api.fetch(c.req.raw)
    if (!checked.ok) return checked
    const { roomId, topic, first } = subscribe(c, checked)
    let detach = keepNothing
    return upgradeWebSocket(() => ({
      onOpen: (_event, ws) => {
        if (!isSubscribable(ws.raw)) throw new TypeError("the socket cannot subscribe to a topic")
        ws.raw.subscribe(topic)
        detach = rooms.attachSocket(roomId, ws)
        try {
          ws.send(first())
        } catch (error) {
          console.error("socket first message failed", { topic, errorClass: errorClass(error) })
          ws.close(internalErrorCloseCode)
        }
      },
      onClose: () => detach(),
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
