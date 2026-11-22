import { errorClass } from "@rafflink/core/lib/error-class"
import { SQLiteError, type Database } from "bun:sqlite"
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { GiveawayRoom, overlaySnapshot, type RoomConfig } from "@rafflink/core/room/giveaway-room"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { roomMigrations } from "@rafflink/core/room/migrations"
import type { ChatOpener } from "@rafflink/core/platform/chat-source"
import {
  RoomTransientError,
  type RoomDirectory,
  type RoomStub,
} from "@rafflink/core/room/room-directory"
import type { Clock, Random, RandomnessBeacon } from "@rafflink/core/ports"
import { BunSqliteSyncSql } from "@rafflink/core/sqlite-bun"
import { openDatabase } from "./database.ts"
import { TimerAlarm } from "./timer-alarm.ts"

export interface LocalRoomDirectoryDeps {
  /** Holds one SQLite file per giveaway, named by its id. */
  readonly roomsDir: string
  readonly config: RoomConfig
  readonly clock: Clock
  readonly random: Random
  /** Where the rooms read the drand round their draw is seeded with. */
  readonly beacon: RandomnessBeacon
  /** Sends one text to every socket subscribed to the topic. */
  readonly publish: (topic: string, message: string) => void
  /** How many sockets are subscribed to the topic. */
  readonly subscriberCount: (topic: string) => number
  /** Runs when a room's alarm fires; its error is logged and goes no further. */
  readonly onAlarm: (giveawayId: string, room: GiveawayRoom) => Promise<void>
  /** Opens the chat of a giveaway's room. */
  readonly chat: (giveawayId: string) => ChatOpener
}

/** The pub/sub topic of a room's live pages. */
export function liveTopic(giveawayId: string): string {
  return `live:${giveawayId}`
}

/** The pub/sub topic of a room's OBS overlay, which gets no winner chat. */
export function overlayTopic(giveawayId: string): string {
  return `overlay:${giveawayId}`
}

/** The pub/sub topic of a room's viewer pages. */
export function viewerTopic(giveawayId: string): string {
  return `viewers:${giveawayId}`
}

/** A page's socket of a room, as the directory closes it when the room is deleted. */
export interface RoomSocket {
  close(code?: number, reason?: string): void
}

interface OpenRoom {
  readonly room: GiveawayRoom
  readonly alarm: TimerAlarm
  readonly db: Database
}

// A giveaway id is `randomId`: 32 hex characters. Anything else never becomes a file name.
const giveawayIdPattern = /^[0-9a-f]{32}$/

/** Rooms in this process, each over its own SQLite file; a file is opened on first use and kept open. */
export class LocalRoomDirectory implements RoomDirectory {
  private readonly open = new Map<string, OpenRoom>()
  // Each running alarm with the id of its room, so deleting a room waits for its own work.
  private readonly inFlight = new Map<Promise<void>, string>()
  // Each page's socket of a room with the moderator link it was opened through, null for the streamer, overlay and viewers.
  private readonly sockets = new Map<string, Map<RoomSocket, string | null>>()
  // Links revoked in this process: a socket whose route check passed just before the revoke opens after it.
  private readonly revokedLinks = new Set<string>()
  // Rooms deleted in this process: a call that looked the giveaway up before the delete must not create a new file.
  private readonly deleted = new Set<string>()
  private closing = false

  constructor(private readonly deps: LocalRoomDirectoryDeps) {
    mkdirSync(deps.roomsDir, { recursive: true })
  }

  get(giveawayId: string): RoomStub {
    return new LocalRoomStub(this.roomFor(giveawayId), () =>
      this.deps.subscriberCount(viewerTopic(giveawayId)),
    )
  }

  /**
   * Stops the room's chat and alarm, waits for its running alarm work, closes its pages' sockets and its
   * database, and removes its file with the write-ahead log files beside it. Any later call for the id fails.
   */
  async delete(giveawayId: string): Promise<void> {
    if (!giveawayIdPattern.test(giveawayId)) throw new RangeError("not a giveaway id")
    this.deleted.add(giveawayId)
    const open = this.open.get(giveawayId)
    if (open !== undefined) {
      open.room.closeChat()
      open.alarm.clear()
      const running = [...this.inFlight].flatMap(([run, id]) => (id === giveawayId ? [run] : []))
      await Promise.allSettled(running)
      open.alarm.clear() // finished alarm work may have armed the next one
      open.db.close()
      this.open.delete(giveawayId)
    }
    for (const socket of this.sockets.get(giveawayId)?.keys() ?? []) {
      socket.close(1000, "giveaway deleted")
    }
    this.sockets.delete(giveawayId)
    const path = join(this.deps.roomsDir, `${giveawayId}${sqliteSuffix}`)
    for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true })
  }

  /**
   * Remembers a page's socket of the room, so deleting the room, or revoking the moderator link `linkId` it
   * was opened through, closes it; the returned function forgets it.
   */
  attachSocket(giveawayId: string, socket: RoomSocket, linkId: string | null): () => void {
    if (linkId !== null && this.revokedLinks.has(linkId)) {
      socket.close(policyViolationCloseCode, "moderator link revoked")
      return keepNothing
    }
    const attached = this.sockets.get(giveawayId) ?? new Map<RoomSocket, string | null>()
    attached.set(socket, linkId)
    this.sockets.set(giveawayId, attached)
    return () => {
      attached.delete(socket)
      if (attached.size === 0 && this.sockets.get(giveawayId) === attached) {
        this.sockets.delete(giveawayId)
      }
    }
  }

  async closeModeratorSockets(giveawayId: string, linkId: string): Promise<void> {
    this.revokedLinks.add(linkId)
    for (const [socket, opener] of this.sockets.get(giveawayId) ?? []) {
      if (opener === linkId) socket.close(policyViolationCloseCode, "moderator link revoked")
    }
  }

  /** The outcome a viewer's page connecting now starts from, as the JSON text of a push. */
  viewerPushText(giveawayId: string): string {
    return JSON.stringify(this.roomFor(giveawayId).viewerPush())
  }

  /** The snapshot a streamer's live page connecting now starts from, as the JSON text of a push. */
  liveSnapshotText(giveawayId: string): string {
    return JSON.stringify(this.roomFor(giveawayId).liveSnapshot())
  }

  /** {@link liveSnapshotText} for the overlay: without the winner chat. */
  overlaySnapshotText(giveawayId: string): string {
    return JSON.stringify(overlaySnapshot(this.roomFor(giveawayId).liveSnapshot()))
  }

  /** Opens every room file and runs its alarm once, so a restart finds the end times, role refreshes and mirrors that were due. */
  async reviveAll(): Promise<void> {
    for (const name of readdirSync(this.deps.roomsDir)) {
      const giveawayId = name.slice(0, -sqliteSuffix.length)
      if (!name.endsWith(sqliteSuffix) || !giveawayIdPattern.test(giveawayId)) continue
      await this.fire(giveawayId, this.roomFor(giveawayId))
    }
  }

  /** Stops the timers, lets alarm work that already runs finish, then closes the room databases. */
  async close(): Promise<void> {
    this.closing = true
    for (const { room, alarm } of this.open.values()) {
      room.closeChat()
      alarm.clear()
    }
    await Promise.allSettled(this.inFlight.keys())
    for (const { alarm, db } of this.open.values()) {
      alarm.clear() // finished alarm work may have armed the next one
      db.close()
    }
    this.open.clear()
    this.closing = false
  }

  private roomFor(giveawayId: string): GiveawayRoom {
    const existing = this.open.get(giveawayId)
    if (existing !== undefined) return existing.room
    if (!giveawayIdPattern.test(giveawayId)) throw new RangeError("not a giveaway id")
    if (this.deleted.has(giveawayId)) throw new Error("the giveaway room was deleted")
    const db = openDatabase(join(this.deps.roomsDir, `${giveawayId}${sqliteSuffix}`))
    const sql = new BunSqliteSyncSql(db)
    applyMigrations(sql, roomMigrations)
    const alarm = new TimerAlarm(this.deps.clock, () => {
      const open = this.open.get(giveawayId)
      if (open !== undefined) void this.fire(giveawayId, open.room)
    })
    const room = new GiveawayRoom({
      sql,
      alarm,
      live: {
        broadcast: (json) => this.deps.publish(liveTopic(giveawayId), json),
        broadcastOverlay: (json) => this.deps.publish(overlayTopic(giveawayId), json),
        broadcastViewers: (json) => this.deps.publish(viewerTopic(giveawayId), json),
      },
      clock: this.deps.clock,
      random: this.deps.random,
      config: this.deps.config,
      beacon: this.deps.beacon,
      chat: this.deps.chat(giveawayId),
    })
    this.open.set(giveawayId, { room, alarm, db })
    return room
  }

  private async fire(giveawayId: string, room: GiveawayRoom): Promise<void> {
    if (this.closing) return
    const run = this.runAlarm(giveawayId, room)
    this.inFlight.set(run, giveawayId)
    await run
    this.inFlight.delete(run)
  }

  private async runAlarm(giveawayId: string, room: GiveawayRoom): Promise<void> {
    try {
      await this.deps.onAlarm(giveawayId, room)
    } catch (error) {
      console.error("room alarm failed", {
        giveawayId,
        errorClass: errorClass(error),
      })
    }
  }
}

const sqliteSuffix = ".sqlite"

// RFC 6455: the server ends a socket whose peer is no longer allowed.
const policyViolationCloseCode = 1008

// What a socket refused at attach has to forget when it closes.
const keepNothing = (): void => {}

/** The room's methods as the async stub the HTTP app expects; a locked database is transient, anything else is not. */
class LocalRoomStub implements RoomStub {
  constructor(
    private readonly room: GiveawayRoom,
    private readonly viewers: () => number,
  ) {}

  init(...args: Parameters<GiveawayRoom["init"]>) {
    return inRoom(() => this.room.init(...args))
  }
  loadExclusions(...args: Parameters<GiveawayRoom["loadExclusions"]>) {
    return inRoom(() => this.room.loadExclusions(...args))
  }
  replaceBlocked(...args: Parameters<GiveawayRoom["replaceBlocked"]>) {
    return inRoom(() => this.room.replaceBlocked(...args))
  }
  enter(...args: Parameters<GiveawayRoom["enter"]>) {
    return inRoom(() => this.room.enter(...args))
  }
  summary() {
    return inRoom(() => this.room.summary())
  }
  entryOf(...args: Parameters<GiveawayRoom["entryOf"]>) {
    return inRoom(() => this.room.entryOf(...args))
  }
  hasChatEntrant(...args: Parameters<GiveawayRoom["hasChatEntrant"]>) {
    return inRoom(() => this.room.hasChatEntrant(...args))
  }
  entrants(...args: Parameters<GiveawayRoom["entrants"]>) {
    return inRoom(() => this.room.entrants(...args))
  }
  leafOf(...args: Parameters<GiveawayRoom["leafOf"]>) {
    return inRoom(() => this.room.leafOf(...args))
  }
  verification() {
    return inRoom(() => this.room.verification())
  }
  leaves() {
    return inRoom(() => this.room.leaves())
  }
  close(...args: Parameters<GiveawayRoom["close"]>) {
    return inRoom(() => this.room.close(...args))
  }
  requestDraw(...args: Parameters<GiveawayRoom["requestDraw"]>) {
    return inRoom(() => this.room.requestDraw(...args))
  }
  draw(...args: Parameters<GiveawayRoom["draw"]>) {
    return inRoom(() => this.room.draw(...args))
  }
  setWinnerCount(...args: Parameters<GiveawayRoom["setWinnerCount"]>) {
    return inRoom(() => this.room.setWinnerCount(...args))
  }
  reroll(...args: Parameters<GiveawayRoom["reroll"]>) {
    return inRoom(() => this.room.reroll(...args))
  }
  claim(...args: Parameters<GiveawayRoom["claim"]>) {
    return inRoom(() => this.room.claim(...args))
  }
  picks() {
    return inRoom(() => this.room.picks())
  }
  removeWinnerName(...args: Parameters<GiveawayRoom["removeWinnerName"]>) {
    return inRoom(() => this.room.removeWinnerName(...args))
  }
  markMirrored(...args: Parameters<GiveawayRoom["markMirrored"]>) {
    return inRoom(() => this.room.markMirrored(...args))
  }
  liveSnapshot() {
    return inRoom(() => this.room.liveSnapshot())
  }
  entriesPerSecondBefore(...args: Parameters<GiveawayRoom["entriesPerSecondBefore"]>) {
    return inRoom(() => this.room.entriesPerSecondBefore(...args))
  }
  pushOverlayTheme(...args: Parameters<GiveawayRoom["pushOverlayTheme"]>) {
    return inRoom(() => this.room.pushOverlayTheme(...args))
  }
  liveCounts() {
    return inRoom(() => ({ ...this.room.liveCounts(), viewers: this.viewers() }))
  }
}

async function inRoom<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof SQLiteError && busyCodes.includes(error.code ?? "")) {
      throw new RoomTransientError("room database is locked", { cause: error })
    }
    throw error
  }
}

const busyCodes: readonly string[] = ["SQLITE_BUSY", "SQLITE_LOCKED"]
