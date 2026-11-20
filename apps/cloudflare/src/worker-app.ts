import { Hono, type MiddlewareHandler } from "hono"
import type { GiveawayRoomDO } from "./durable-objects/giveaway-room-do.ts"

export interface WorkerAppOptions {
  /** The HTTP app of core. */
  readonly api: Hono
  readonly rooms: DurableObjectNamespace<GiveawayRoomDO>
}

/** Everything the Worker answers: WebSocket upgrades of the live and overlay routes, and the API of core. */
export function createWorkerApp(options: WorkerAppOptions): Hono {
  const { api, rooms } = options
  const app = new Hono()

  app.get("/api/live/:id", liveSocket(api, rooms))
  app.get("/api/overlay/:id/:token", liveSocket(api, rooms))
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
