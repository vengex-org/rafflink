import { moderatorLinkHeader } from "@rafflink/core/http/moderator-routes"
import { presenceKindHeader, presenceSocketPath } from "@rafflink/core/presence/site-presence"
import { viewerRoomHeader } from "@rafflink/core/http/viewer-socket"
import { Hono, type MiddlewareHandler } from "hono"
import { sitePresenceStub } from "./adapters/durable-object-site-presence.ts"
import type { GiveawayRoomObject } from "./durable-objects/giveaway-room-do.ts"
import type { SitePresenceObject } from "./durable-objects/site-presence-do.ts"

export interface WorkerAppOptions {
  /** The HTTP app of core. */
  readonly api: Hono
  readonly rooms: DurableObjectNamespace<GiveawayRoomObject>
  /** Null without the binding: the presence upgrade then reaches the route of core, which answers 404. */
  readonly presence: DurableObjectNamespace<SitePresenceObject> | null
}

/** Everything the Worker answers: WebSocket upgrades of the live, overlay, viewer and presence routes, and the API and the pages of core that `run_worker_first` sends to it. */
export function createWorkerApp(options: WorkerAppOptions): Hono {
  const { api, rooms, presence } = options
  const app = new Hono()

  app.get("/api/live/:id", liveSocket(api, rooms))
  app.get("/api/mod/:id", moderatorSocket(api, rooms))
  app.get("/api/overlay/:id/:token", liveSocket(api, rooms))
  app.get("/api/g/:code/live", viewerSocket(api, rooms))
  if (presence !== null) app.get(presenceSocketPath, presenceSocket(api, presence))
  app.all("*", (c) => api.fetch(c.req.raw))

  return app
}

/**
 * Hands a WebSocket upgrade of a live route to the room's object. The JSON route of the same path
 * decides who may connect, so the checks live in one place.
 */
function liveSocket(api: Hono, rooms: WorkerAppOptions["rooms"]): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const checked = await api.fetch(c.req.raw)
    if (!checked.ok) return checked
    return rooms.get(rooms.idFromName(c.req.param("id") ?? "")).fetch(c.req.raw)
  }
}

/**
 * Like {@link liveSocket} for a moderator link's page: the room's object gets the link the route of core
 * named, in the same header, so revoking the link closes the socket. A header the browser sent is replaced.
 */
function moderatorSocket(api: Hono, rooms: WorkerAppOptions["rooms"]): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const checked = await api.fetch(c.req.raw)
    if (!checked.ok) return checked
    const linkId = checked.headers.get(moderatorLinkHeader)
    if (linkId === null) throw new TypeError("the moderator socket route named no link")
    const headers = new Headers(c.req.raw.headers)
    headers.set(moderatorLinkHeader, linkId)
    const forwarded = new Request(c.req.raw, { headers })
    return rooms.get(rooms.idFromName(c.req.param("id") ?? "")).fetch(forwarded)
  }
}

/** Like {@link liveSocket}, with the room found by the giveaway code: the route of core answers with the room's id. */
function viewerSocket(api: Hono, rooms: WorkerAppOptions["rooms"]): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const checked = await api.fetch(c.req.raw)
    if (!checked.ok) return checked
    const roomId = checked.headers.get(viewerRoomHeader)
    if (roomId === null) throw new TypeError("the viewer socket route named no room")
    return rooms.get(rooms.idFromName(roomId)).fetch(c.req.raw)
  }
}

/**
 * Like {@link moderatorSocket} for the presence socket of a page, which goes to the one presence object with
 * the page kind the route of core named. A header the browser sent is replaced.
 */
function presenceSocket(
  api: Hono,
  presence: DurableObjectNamespace<SitePresenceObject>,
): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return next()
    const checked = await api.fetch(c.req.raw)
    if (!checked.ok) return checked
    const kind = checked.headers.get(presenceKindHeader)
    if (kind === null) throw new TypeError("the presence route named no page kind")
    const headers = new Headers(c.req.raw.headers)
    headers.set(presenceKindHeader, kind)
    return sitePresenceStub(presence).fetch(new Request(c.req.raw, { headers }))
  }
}
