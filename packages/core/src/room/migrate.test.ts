import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync } from "node:fs"
import { BunSqliteSyncSql } from "../sqlite-bun.ts"
import { applyMigrations } from "./migrate.ts"
import { roomMigrations } from "./migrations.ts"

function openSql(): BunSqliteSyncSql {
  return new BunSqliteSyncSql(new Database(":memory:"))
}

function version(sql: BunSqliteSyncSql): unknown {
  return sql.exec("PRAGMA user_version", [])[0]?.user_version
}

function roomBefore(status: string, closesAt: number | null, seed: string): BunSqliteSyncSql {
  const sql = openSql()
  applyMigrations(sql, roomMigrations.slice(0, 1))
  sql.exec(
    `INSERT INTO room_state (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status, closes_at, seed)
     VALUES (1, 'twitch', 'g', 'b', 't', 'c', '{}', 300, ?, ?, ${seed})`,
    [status, closesAt],
  )
  return sql
}

function closedAt(sql: BunSqliteSyncSql): unknown {
  applyMigrations(sql, roomMigrations)
  return sql.exec("SELECT closed_at FROM room_state", [])[0]?.closed_at
}

describe("applyMigrations", () => {
  it("applies the room schema twice as a no-op", () => {
    const sql = openSql()
    applyMigrations(sql, roomMigrations)
    sql.exec(
      "INSERT INTO room_state (id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds, status) VALUES (1, 'twitch', 'g', 'b', 't', 'c', '{}', 300, 'open')",
      [],
    )
    applyMigrations(sql, roomMigrations)
    expect(version(sql)).toBe(roomMigrations.length)
    expect(sql.exec("SELECT COUNT(*) AS c FROM room_state", [])[0]?.c).toBe(1)
  })

  it("applies a new file once and keeps the older ones", () => {
    const sql = openSql()
    applyMigrations(sql, ["CREATE TABLE a (id INTEGER)"])
    applyMigrations(sql, ["CREATE TABLE a (id INTEGER)", "CREATE TABLE b (id INTEGER)"])
    applyMigrations(sql, ["CREATE TABLE a (id INTEGER)", "CREATE TABLE b (id INTEGER)"])
    expect(version(sql)).toBe(2)
    expect(
      sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", []),
    ).toEqual([{ name: "a" }, { name: "b" }])
  })

  it("keeps the version and the earlier statements out when a file fails", () => {
    const sql = openSql()
    expect(() =>
      applyMigrations(sql, ["CREATE TABLE a (id INTEGER); CREATE TABLE a (id INTEGER)"]),
    ).toThrow()
    expect(version(sql)).toBe(0)
    expect(sql.exec("SELECT name FROM sqlite_master WHERE name = 'a'", [])).toEqual([])
  })

  it("refuses a database newer than the code", () => {
    const sql = openSql()
    applyMigrations(sql, ["CREATE TABLE a (id INTEGER)", "CREATE TABLE b (id INTEGER)"])
    expect(() => applyMigrations(sql, ["CREATE TABLE a (id INTEGER)"])).toThrow(RangeError)
  })

  it("lists every file of schema/room in order", () => {
    const files = readdirSync(new URL("../../schema/room", import.meta.url)).toSorted()
    expect(files).toHaveLength(roomMigrations.length)
    expect(files.map((name) => name.slice(0, 4))).toEqual(
      files.map((_, index) => String(index + 1).padStart(4, "0")),
    )
  })

  describe("the close time of rooms that existed before it was stored", () => {
    it("takes the time of the draw for a drawn room", () => {
      const sql = roomBefore("drawn", 5000, "x'00'")
      sql.exec(
        "INSERT INTO draws (n, platform, platform_user_id, drawn_at, claim_until) VALUES (0, 'twitch', 'u', 9000, 9500)",
        [],
      )

      expect(closedAt(sql)).toBe(9000)
    })

    it("takes the end time for a closed room that was never drawn", () => {
      expect(closedAt(roomBefore("closed", 5000, "NULL"))).toBe(5000)
    })

    it("caps a planned end time in the future at now, for a room the streamer closed early", () => {
      const before = Date.now()
      const farFuture = 4_102_444_800_000

      const result = closedAt(roomBefore("closed", farFuture, "NULL"))

      expect(result).toBeGreaterThanOrEqual(before - 1000)
      expect(result).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it("takes the latest entry for a closed room without an end time", () => {
      const sql = roomBefore("closed", null, "NULL")
      sql.exec(
        "INSERT INTO entries (seq, platform, platform_user_id, login, display_name, group_name, tickets, entered_at) VALUES (1, 'twitch', 'u', 'l', 'n', 'viewer', 1, 7000)",
        [],
      )

      expect(closedAt(sql)).toBe(7000)
    })

    it("takes zero for a closed room with nothing to date it, so it holds no data to delete", () => {
      expect(closedAt(roomBefore("closed", null, "NULL"))).toBe(0)
    })

    it("leaves an open room without a close time", () => {
      expect(closedAt(roomBefore("open", null, "NULL"))).toBeNull()
    })
  })
})
