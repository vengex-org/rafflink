import { DurableObject } from "cloudflare:workers"
import { errorClass } from "@rafflink/core/lib/error-class"
import { moderatorLinkHeader } from "@rafflink/core/http/moderator-routes"
import { GiveawayRoom, overlaySnapshot } from "@rafflink/core/room/giveaway-room"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { roomMigrations } from "@rafflink/core/room/migrations"
import { runRoomAlarm } from "@rafflink/core/room/run-room-alarm"
import { roomChat } from "@rafflink/core/room/room-chat"
import { DurableObjectAlarm } from "../adapters/durable-object-alarm.ts"
import { DurableObjectSocketConnector } from "../adapters/durable-object-socket-connector.ts"
import { DurableObjectSyncSql } from "../adapters/durable-object-sync-sql.ts"
import type { WorkerEnv } from "../env.ts"
import { runtimeOf, type Runtime } from "../runtime.ts"

interface OpenRoom {
  readonly room: GiveawayRoom
  readonly runtime: Runtime
}

// Tags of the hibernating sockets: the streamer's live page, the OBS overlay, and the viewers' giveaway pages.
const liveTag = "live"
const overlayTag = "overlay"
const viewerTag = "viewer"

/** The extra tag of a live socket opened through a moderator link, so revoking the link finds it. */
function moderatorTag(linkId: string): string {
  return `mod:${linkId}`
}

// The storage key that marks a moderator link revoked; `destroy` deletes it with everything else.
function revokedLinkKey(linkId: string): string {
  return `revoked-link:${linkId}`
}

// RFC 6455: the server ends a socket whose peer is no longer allowed.
const policyViolationCloseCode = 1008

/**
 * One giveaway's room in a SQLite-backed Durable Object named by the giveaway id. Live pages are
 * hibernating WebSockets of the object; the storage alarm runs {@link runRoomAlarm}.
 */
export class GiveawayRoomObject extends DurableObject<WorkerEnv> {
  // Replaced by a rejection once `destroy` ran, so no later call writes into the emptied storage.
  private opened: Promise<OpenRoom>
  private destroyed = false

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.opened = ctx.blockConcurrencyWhile(() => this.open())
  }

  /** Ends the chat and the pages' sockets, then deletes the alarm and every stored row; every later call of this object fails. A repeat does nothing. */
  async destroy(): Promise<void> {
    if (this.destroyed) return
    const { room } = await this.opened
    await this.ctx.blockConcurrencyWhile(async () => {
      this.destroyed = true
      const gone = Promise.reject(new Error("the giveaway room was deleted"))
      // Handled here so the rejection is not reported as unhandled; each later call awaits it and fails.
      gone.catch(() => {})
      this.opened = gone
      room.closeChat()
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, "giveaway deleted")
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
    })
  }

  /**
   * Closes the live sockets opened through the moderator link and remembers the revoke, so a socket whose
   * route check passed just before it is refused when it arrives; the room and every other socket stay.
   */
  async closeModeratorSockets(linkId: string): Promise<void> {
    await this.ctx.storage.put(revokedLinkKey(linkId), true)
    for (const socket of this.ctx.getWebSockets(moderatorTag(linkId))) {
      socket.close(policyViolationCloseCode, "moderator link revoked")
    }
  }

  async init(...args: Parameters<GiveawayRoom["init"]>) {
    return (await this.opened).room.init(...args)
  }
  async loadExclusions(...args: Parameters<GiveawayRoom["loadExclusions"]>) {
    return (await this.opened).room.loadExclusions(...args)
  }
  async replaceBlocked(...args: Parameters<GiveawayRoom["replaceBlocked"]>) {
    return (await this.opened).room.replaceBlocked(...args)
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
  async hasChatEntrant(...args: Parameters<GiveawayRoom["hasChatEntrant"]>) {
    return (await this.opened).room.hasChatEntrant(...args)
  }
  async entrants(...args: Parameters<GiveawayRoom["entrants"]>) {
    return (await this.opened).room.entrants(...args)
  }
  async leafOf(...args: Parameters<GiveawayRoom["leafOf"]>) {
    return (await this.opened).room.leafOf(...args)
  }
  async verification() {
    return (await this.opened).room.verification()
  }
  async leaves() {
    return (await this.opened).room.leaves()
  }
  async close(...args: Parameters<GiveawayRoom["close"]>) {
    return (await this.opened).room.close(...args)
  }
  async requestDraw(...args: Parameters<GiveawayRoom["requestDraw"]>) {
    return (await this.opened).room.requestDraw(...args)
  }
  async draw(...args: Parameters<GiveawayRoom["draw"]>) {
    return (await this.opened).room.draw(...args)
  }
  async setWinnerCount(...args: Parameters<GiveawayRoom["setWinnerCount"]>) {
    return (await this.opened).room.setWinnerCount(...args)
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
  async removeWinnerName(...args: Parameters<GiveawayRoom["removeWinnerName"]>) {
    return (await this.opened).room.removeWinnerName(...args)
  }
  async mirrorState() {
    return (await this.opened).room.mirrorState()
  }
  async saveWinnerAnswers(...args: Parameters<GiveawayRoom["saveWinnerAnswers"]>) {
    return (await this.opened).room.saveWinnerAnswers(...args)
  }
  async winnerAnswers() {
    return (await this.opened).room.winnerAnswers()
  }
  async markDelivered(...args: Parameters<GiveawayRoom["markDelivered"]>) {
    return (await this.opened).room.markDelivered(...args)
  }
  async markMirrored(...args: Parameters<GiveawayRoom["markMirrored"]>) {
    return (await this.opened).room.markMirrored(...args)
  }
  async liveSnapshot() {
    return (await this.opened).room.liveSnapshot()
  }
  async entriesPerSecondBefore(...args: Parameters<GiveawayRoom["entriesPerSecondBefore"]>) {
    return (await this.opened).room.entriesPerSecondBefore(...args)
  }
  async pushOverlayTheme(...args: Parameters<GiveawayRoom["pushOverlayTheme"]>) {
    return (await this.opened).room.pushOverlayTheme(...args)
  }
  async receiveChat(...args: Parameters<GiveawayRoom["receiveChat"]>) {
    return (await this.opened).room.receiveChat(...args)
  }
  async receiveChannelEntries(...args: Parameters<GiveawayRoom["receiveChannelEntries"]>) {
    return (await this.opened).room.receiveChannelEntries(...args)
  }
  async liveCounts() {
    const { room } = await this.opened
    return { ...room.liveCounts(), viewers: this.ctx.getWebSockets(viewerTag).length }
  }

  /**
   * Accepts a page's WebSocket and sends it the current snapshot (without the winner chat for the overlay),
   * or for a viewer's page the current outcome; the Worker has already checked who may connect, and names
   * the moderator link of a moderator's page in a header.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 })
    }
    const { room } = await this.opened
    const pair = new WebSocketPair()
    const { pathname } = new URL(request.url)
    if (pathname.startsWith("/api/g/")) {
      this.ctx.acceptWebSocket(pair[1], [viewerTag])
      pair[1].send(JSON.stringify(room.viewerPush()))
    } else if (pathname.startsWith("/api/mod/")) {
      const linkId = request.headers.get(moderatorLinkHeader)
      if (linkId === null) return new Response("expected a moderator link", { status: 400 })
      if ((await this.ctx.storage.get(revokedLinkKey(linkId))) === true) {
        return new Response("moderator link revoked", { status: 403 })
      }
      this.ctx.acceptWebSocket(pair[1], [liveTag, moderatorTag(linkId)])
      pair[1].send(JSON.stringify(room.liveSnapshot()))
    } else if (pathname.startsWith("/api/overlay/")) {
      this.ctx.acceptWebSocket(pair[1], [overlayTag])
      pair[1].send(JSON.stringify(overlaySnapshot(room.liveSnapshot())))
    } else {
      this.ctx.acceptWebSocket(pair[1], [liveTag])
      pair[1].send(JSON.stringify(room.liveSnapshot()))
    }
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  override webSocketClose(socket: WebSocket, code: number): void {
    // 1005 and 1006 only describe a close; they are not codes a close frame may carry.
    socket.close(code === 1005 || code === 1006 ? 1000 : code)
  }

  override async alarm(): Promise<void> {
    // A deleted room has nothing to do, and a throw would make the runtime retry the alarm.
    if (this.destroyed) return
    const { room, runtime } = await this.opened
    const giveawayId = this.giveawayId()
    try {
      if ((await runRoomAlarm(runtime, giveawayId, room)) === "gone") {
        console.warn("room deleted: its giveaway no longer exists", { giveawayId })
        await this.destroy()
      }
    } catch (error) {
      // Rethrown so the runtime retries the alarm: without it the room's next wake-up is not armed.
      console.error("room alarm failed", { giveawayId, errorClass: errorClass(error) })
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
      live: {
        broadcast: (json) => this.broadcast(json, liveTag),
        broadcastOverlay: (json) => this.broadcast(json, overlayTag),
        broadcastViewers: (json) => this.broadcast(json, viewerTag),
      },
      clock: runtime.clock,
      random: runtime.random,
      config: runtime.config,
      beacon: runtime.beacon,
      // The id is read when the chat opens, as the alarm reads it, not when the object starts.
      chat: (platform, listener) =>
        roomChat(
          runtime,
          new DurableObjectSocketConnector(),
          this.giveawayId(),
        )(platform, listener),
    })
    room.armAlarm()
    return { room, runtime }
  }

  private broadcast(json: string, tag: string): void {
    for (const socket of this.ctx.getWebSockets(tag)) {
      try {
        socket.send(json)
      } catch (error) {
        console.warn("live push failed", {
          giveawayId: this.giveawayId(),
          errorClass: errorClass(error),
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
