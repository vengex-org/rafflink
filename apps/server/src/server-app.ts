import { serveStatic, upgradeWebSocket } from "@hono/bun"
import {
  apiPrefixes,
  fakeKickPrefixes,
  fakeTwitchPrefixes,
  fakeYouTubePrefixes,
} from "@rafflink/core/http/api-paths"
import { staticCacheControl, staticRobotsTag } from "@rafflink/core/http/static-headers"
import { errorClass } from "@rafflink/core/lib/error-class"
import { captureException } from "@sentry/core"
import { moderatorLinkHeader } from "@rafflink/core/http/moderator-routes"
import type { MemorySitePresence } from "@rafflink/core/lib/memory-site-presence"
import { presenceKindHeader, presenceSocketPath } from "@rafflink/core/presence/site-presence"
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
  /** Counts the presence sockets of the pages. */
  readonly presence: Pick<MemorySitePresence, "join">
  /** Mounted under {@link fakeTwitchPrefixes} in dev only. */
  readonly fakeTwitch: Hono | null
  /** Mounted under {@link fakeKickPrefixes} in dev only. */
  readonly fakeKick: Hono | null
  /** Mounted under {@link fakeYouTubePrefixes} in dev only. */
  readonly fakeYouTube: Hono | null
  /** The built SPA files except its HTML pages, which the HTTP app of core answers; null serves no files. */
  readonly staticDir: string | null
}

/**
 * Everything the Bun server answers except the dev SPA bundle: the API, WebSocket upgrades of the
 * live, overlay, viewer and presence routes, the fake Twitch, Kick and YouTube in dev, the SPA files, and the pages of core for every
 * other path.
 */
export function createServerApp(options: ServerAppOptions): Hono {
  const { api, rooms, presence, fakeTwitch, fakeKick, fakeYouTube, staticDir } = options
  const app = new Hono()

  app.get(
    "/api/live/:id",
    socketRoute(api, rooms, (c) => {
      const id = c.req.param("id") ?? ""
      return {
        roomId: id,
        topic: liveTopic(id),
        first: () => rooms.liveSnapshotText(id),
        linkId: null,
      }
    }),
  )
  app.get(
    "/api/mod/:id",
    socketRoute(api, rooms, (c, checked) => {
      const id = c.req.param("id") ?? ""
      const linkId = checked.headers.get(moderatorLinkHeader)
      if (linkId === null) throw new TypeError("the moderator socket route named no link")
      return { roomId: id, topic: liveTopic(id), first: () => rooms.liveSnapshotText(id), linkId }
    }),
  )
  app.get(
    "/api/overlay/:id/:token",
    socketRoute(api, rooms, (c) => {
      const id = c.req.param("id") ?? ""
      return {
        roomId: id,
        topic: overlayTopic(id),
        first: () => rooms.overlaySnapshotText(id),
        linkId: null,
      }
    }),
  )
  app.get(
    "/api/g/:code/live",
    socketRoute(api, rooms, (_c, checked) => {
      const roomId = checked.headers.get(viewerRoomHeader)
      if (roomId === null) throw new TypeError("the viewer socket route named no room")
      return {
        roomId,
        topic: viewerTopic(roomId),
        first: () => rooms.viewerPushText(roomId),
        linkId: null,
      }
    }),
  )
  app.get(presenceSocketPath, presenceSocket(api, presence))
  for (const prefix of apiPrefixes) app.all(`${prefix}*`, (c) => api.fetch(c.req.raw))
  for (const prefix of fakeTwitchPrefixes) {
    app.all(`${prefix}*`, (c) =>
      fakeTwitch === null ? api.fetch(c.req.raw) : fakeTwitch.fetch(c.req.raw, c.env),
    )
  }
  for (const prefix of fakeKickPrefixes) {
    app.all(`${prefix}*`, (c) =>
      fakeKick === null ? api.fetch(c.req.raw) : fakeKick.fetch(c.req.raw, c.env),
    )
  }
  for (const prefix of fakeYouTubePrefixes) {
    app.all(`${prefix}*`, (c) =>
      fakeYouTube === null ? api.fetch(c.req.raw) : fakeYouTube.fetch(c.req.raw, c.env),
    )
  }
  if (staticDir !== null) {
    const files = serveStatic({
      root: staticDir,
      onFound: (_path, c) => {
        c.header("Cache-Control", staticCacheControl(c.req.path))
        const robots = staticRobotsTag(c.req.path)
        if (robots !== null) c.header("X-Robots-Tag", robots)
      },
    })
    app.use("*", (c, next) => (isPagePath(c.req.path) ? next() : files(c, next)))
  }
  app.notFound((c) => api.fetch(c.req.raw))

  return app
}

/**
 * The paths core answers as pages: every path without a file extension and every HTML file. `serveStatic` would
 * answer `/de` with `de/index.html` itself, bypassing the page of core and its CSP.
 */
function isPagePath(pathname: string): boolean {
  return !/\.[^/]+$/.test(pathname) || pathname.endsWith(".html")
}

// What a socket that never opened has to forget when it closes.
const keepNothing = (): void => {}

// RFC 6455: the server hit an unexpected condition and cannot serve the socket.
const internalErrorCloseCode = 1011

interface Subscribable {
  subscribe(topic: string): void
}

/**
 * What a socket is subscribed to and the message it gets on open; `first` runs after the subscribe, so no
 * push falls between the two. `linkId` is the moderator link the socket was opened through, else null.
 */
interface Subscription {
  readonly roomId: string
  readonly topic: string
  readonly first: () => string
  readonly linkId: string | null
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
    const { roomId, topic, first, linkId } = subscribe(c, checked)
    let detach = keepNothing
    return upgradeWebSocket(() => ({
      onOpen: (_event, ws) => {
        if (!isSubscribable(ws.raw)) throw new TypeError("the socket cannot subscribe to a topic")
        ws.raw.subscribe(topic)
        detach = rooms.attachSocket(roomId, ws, linkId)
        try {
          ws.send(first())
        } catch (error) {
          captureException(error)
          console.error("socket first message failed", { topic, errorClass: errorClass(error) })
          ws.close(internalErrorCloseCode)
        }
      },
      onClose: () => detach(),
    }))(c, next)
  }
}

/** Counts a page's presence socket while it is open. The JSON route of core on the same path decides who may connect. */
function presenceSocket(api: Hono, presence: ServerAppOptions["presence"]): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const checked = await api.fetch(c.req.raw)
    if (!checked.ok) return checked
    const kind = checked.headers.get(presenceKindHeader)
    if (kind === null) throw new TypeError("the presence route named no page kind")
    let leave = keepNothing
    return upgradeWebSocket(() => ({
      onOpen: () => {
        leave = presence.join(kind)
      },
      onClose: () => leave(),
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
