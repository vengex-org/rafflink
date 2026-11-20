import { DurableObject } from "cloudflare:workers"
import { GiveawayRoom } from "@rafflink/core/room/giveaway-room"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { roomMigrations } from "@rafflink/core/room/migrations"
import { runRoomAlarm } from "@rafflink/core/room/run-room-alarm"
import { subscribeChat } from "@rafflink/core/room/subscribe-chat"
import { DurableObjectAlarm } from "../adapters/durable-object-alarm.ts"
import { DurableObjectSocketConnector } from "../adapters/durable-object-socket-connector.ts"
import { DurableObjectSyncSql } from "../adapters/durable-object-sync-sql.ts"
import type { WorkerEnv } from "../env.ts"
import { runtimeOf, type Runtime } from "../runtime.ts"

interface OpenRoom {
  readonly room: GiveawayRoom
  readonly runtime: Runtime
}

/**
 * One giveaway's room in a SQLite-backed Durable Object named by the giveaway id. Live pages are
 * hibernating WebSockets of the object; the storage alarm runs {@link runRoomAlarm}.
 */
export class GiveawayRoomDO extends DurableObject<WorkerEnv> {
  private readonly opened: Promise<OpenRoom>

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.opened = ctx.blockConcurrencyWhile(() => this.open())
  }

  async init(...args: Parameters<GiveawayRoom["init"]>) {
    return (await this.opened).room.init(...args)
  }
  async enter(...args: Parameters<GiveawayRoom["enter"]>) {
    return (await this.opened).room.enter(...args)
  }
  async summary() {
    return (await this.opened).room.summary()
  }
  async entryOf(...args: Parameters<GiveawayRoom["entryOf"]>) {
    return (await this.opened).room.entryOf(...args)
  }
  async close() {
    return (await this.opened).room.close()
  }
  async draw(...args: Parameters<GiveawayRoom["draw"]>) {
    return (await this.opened).room.draw(...args)
  }
  async reroll(...args: Parameters<GiveawayRoom["reroll"]>) {
    return (await this.opened).room.reroll(...args)
  }
  async claim(...args: Parameters<GiveawayRoom["claim"]>) {
    return (await this.opened).room.claim(...args)
  }
  async picks() {
    return (await this.opened).room.picks()
  }
  async markMirrored(...args: Parameters<GiveawayRoom["markMirrored"]>) {
    return (await this.opened).room.markMirrored(...args)
  }
  async liveSnapshot() {
    return (await this.opened).room.liveSnapshot()
  }

  /** Accepts a live page's WebSocket and sends it the current snapshot; the Worker has already checked who may connect. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 })
    }
    const { room } = await this.opened
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].send(JSON.stringify(room.liveSnapshot()))
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  override webSocketClose(socket: WebSocket, code: number): void {
    // 1005 and 1006 only describe a close; they are not codes a close frame may carry.
    socket.close(code === 1005 || code === 1006 ? 1000 : code)
  }

  override async alarm(): Promise<void> {
    const { room, runtime } = await this.opened
    const giveawayId = this.giveawayId()
    try {
      await runRoomAlarm(runtime, giveawayId, room)
    } catch (error) {
      // Rethrown so the runtime retries the alarm: without it the room's next wake-up is not armed.
      console.error("room alarm failed", { giveawayId, errorClass: errorClassOf(error) })
      throw error
    }
  }

  private async open(): Promise<OpenRoom> {
    const runtime = await runtimeOf(this.env)
    const sql = new DurableObjectSyncSql(this.ctx.storage)
    applyMigrations(sql, roomMigrations)
    const room = new GiveawayRoom({
      sql,
      alarm: new DurableObjectAlarm(this.ctx.storage),
      live: { broadcast: (json) => this.broadcast(json) },
      clock: runtime.clock,
      random: runtime.random,
      config: runtime.config,
      chat: {
        connector: new DurableObjectSocketConnector(),
        subscribe: (sessionId) => subscribeChat(runtime, this.giveawayId(), sessionId),
      },
    })
    return { room, runtime }
  }

  private broadcast(json: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(json)
      } catch (error) {
        console.warn("live push failed", {
          giveawayId: this.giveawayId(),
          errorClass: errorClassOf(error),
        })
      }
    }
  }

  private giveawayId(): string {
    const name = this.ctx.id.name
    if (name === undefined) throw new TypeError("the room object was not addressed by name")
    return name
  }
}

function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error
}
