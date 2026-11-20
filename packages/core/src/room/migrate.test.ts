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

describe("applyMigrations", () => {
  it("applies the room schema twice as a no-op", () => {
    const sql = openSql()
    applyMigrations(sql, roomMigrations)
    sql.exec(
      "INSERT INTO room_state (id, platform, giveaway_id, broadcaster_id, rules_json, claim_seconds, status) VALUES (1, 'twitch', 'g', 'b', '{}', 300, 'open')",
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
})
