import { errorClass } from "@rafflink/core/lib/error-class"
import { SQLiteError, type Database } from "bun:sqlite"
import { mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { GiveawayRoom, type RoomConfig } from "@rafflink/core/room/giveaway-room"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { roomMigrations } from "@rafflink/core/room/migrations"
import {
  RoomTransientError,
  type RoomDirectory,
  type RoomStub,
} from "@rafflink/core/room/room-directory"
import type { Clock, Random, SocketConnector } from "@rafflink/core/ports"
import { BunSqliteSyncSql } from "@rafflink/core/sqlite-bun"
import { openDatabase } from "./database.ts"
import { TimerAlarm } from "./timer-alarm.ts"

export interface LocalRoomDirectoryDeps {
  /** Holds one SQLite file per giveaway, named by its id. */
  readonly roomsDir: string
  readonly config: RoomConfig
  readonly clock: Clock
  readonly random: Random
  /** Sends one text to every socket subscribed to the topic. */
  readonly publish: (topic: string, message: string) => void
  /** Runs when a room's alarm fires; its error is logged and goes no further. */
  readonly onAlarm: (giveawayId: string, room: GiveawayRoom) => Promise<void>
  readonly connector: SocketConnector
  /** Subscribes an EventSub session to the chat of a giveaway's channel. */
  readonly subscribeChat: (giveawayId: string, sessionId: string) => Promise<void>
}

/** The pub/sub topic of a room's live pages. */
export function liveTopic(giveawayId: string): string {
  return `live:${giveawayId}`
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
  private readonly inFlight = new Set<Promise<void>>()
  private closing = false

  constructor(private readonly deps: LocalRoomDirectoryDeps) {
    mkdirSync(deps.roomsDir, { recursive: true })
  }

  get(giveawayId: string): RoomStub {
    return new LocalRoomStub(this.roomFor(giveawayId))
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
    await Promise.allSettled(this.inFlight)
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
      live: { broadcast: (json) => this.deps.publish(liveTopic(giveawayId), json) },
      clock: this.deps.clock,
      random: this.deps.random,
      config: this.deps.config,
      chat: {
        connector: this.deps.connector,
        subscribe: (sessionId) => this.deps.subscribeChat(giveawayId, sessionId),
      },
    })
    this.open.set(giveawayId, { room, alarm, db })
    return room
  }

  private async fire(giveawayId: string, room: GiveawayRoom): Promise<void> {
    if (this.closing) return
    const run = this.runAlarm(giveawayId, room)
    this.inFlight.add(run)
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

/** The room's methods as the async stub the HTTP app expects; a locked database is transient, anything else is not. */
class LocalRoomStub implements RoomStub {
  constructor(private readonly room: GiveawayRoom) {}

  init(...args: Parameters<GiveawayRoom["init"]>) {
    return inRoom(() => this.room.init(...args))
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
  entrants(...args: Parameters<GiveawayRoom["entrants"]>) {
    return inRoom(() => this.room.entrants(...args))
  }
  close() {
    return inRoom(() => this.room.close())
  }
  draw(...args: Parameters<GiveawayRoom["draw"]>) {
    return inRoom(() => this.room.draw(...args))
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
  markMirrored(...args: Parameters<GiveawayRoom["markMirrored"]>) {
    return inRoom(() => this.room.markMirrored(...args))
  }
  liveSnapshot() {
    return inRoom(() => this.room.liveSnapshot())
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
