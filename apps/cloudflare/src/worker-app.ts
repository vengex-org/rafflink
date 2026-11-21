import { viewerRoomHeader } from "@rafflink/core/http/viewer-socket"
import { Hono, type MiddlewareHandler } from "hono"
import type { GiveawayRoomObject } from "./durable-objects/giveaway-room-do.ts"

export interface WorkerAppOptions {
  /** The HTTP app of core. */
  readonly api: Hono
  readonly rooms: DurableObjectNamespace<GiveawayRoomObject>
}

/** Everything the Worker answers: WebSocket upgrades of the live, overlay and viewer routes, and the API and the indexable pages of core. */
export function createWorkerApp(options: WorkerAppOptions): Hono {
  const { api, rooms } = options
  const app = new Hono()

  app.get("/api/live/:id", liveSocket(api, rooms))
  app.get("/api/overlay/:id/:token", liveSocket(api, rooms))
  app.get("/api/g/:code/live", viewerSocket(api, rooms))
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
