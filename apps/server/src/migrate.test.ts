import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { systemClock } from "@rafflink/core/lib/system-ports"
import { applyAccountsMigrations, coreAccountsSchemaDir } from "./migrate.ts"

let dir: string
let db: Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rafflink-migrate-"))
  db = new Database(":memory:")
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function write(name: string, sql: string): void {
  writeFileSync(join(dir, name), sql)
}

function tables(): string[] {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
}

describe("applyAccountsMigrations", () => {
  it("applying the accounts migrations twice is a no-op and a new file is applied once", () => {
    write("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);")

    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual(["0001_first.sql"])
    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual([])

    write("0002_second.sql", "CREATE TABLE second (id INTEGER PRIMARY KEY);")

    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual(["0002_second.sql"])
    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual([])
    expect(tables()).toEqual(["first", "schema_migrations", "second"])
  })

  it("applies files in name order whatever order the directory lists them", () => {
    write("0002_second.sql", "INSERT INTO first VALUES (2);")
    write(
      "0001_first.sql",
      "CREATE TABLE first (id INTEGER PRIMARY KEY); INSERT INTO first VALUES (1);",
    )

    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
    ])
  })

  it("ignores files that are not .sql", () => {
    write("README.md", "not sql")
    write("0001_first.sql.bak", "not sql")

    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual([])
  })

  it("records the time each file was applied", () => {
    write("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);")

    applyAccountsMigrations(db, dir, { now: () => 1234 })

    expect(db.query("SELECT name, applied_at FROM schema_migrations").all()).toEqual([
      { name: "0001_first.sql", applied_at: 1234 },
    ])
  })

  it("rolls back a failing file, keeps the files before it and retries it next time", () => {
    write("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);")
    write("0002_broken.sql", "CREATE TABLE second (id INTEGER PRIMARY KEY); NOT SQL;")

    expect(() => applyAccountsMigrations(db, dir, systemClock)).toThrow()

    expect(tables()).toEqual(["first", "schema_migrations"])
    write("0002_broken.sql", "CREATE TABLE second (id INTEGER PRIMARY KEY);")
    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual(["0002_broken.sql"])
  })

  it("applies the accounts schema files of core", () => {
    expect(applyAccountsMigrations(db, coreAccountsSchemaDir(), systemClock)).toEqual([
      "0001_init.sql",
      "0002_retention_armed.sql",
      "0003_winner_count.sql",
      "0004_retention_attempts.sql",
      "0005_profile_image.sql",
      "0006_cloudflare_plan.sql",
      "0007_streamer_access.sql",
      "0008_stats.sql",
      "0009_closed_at.sql",
      "0010_overlay_theme.sql",
      "0011_moderator_links.sql",
      "0012_streamer_blocks.sql",
      "0013_public_history.sql",
      "0014_delivery_counts.sql",
      "0015_history_indexing.sql",
      "0016_kick_chat.sql",
    ])
    expect(tables()).toEqual([
      "cloudflare_plan",
      "giveaways",
      "kick_chat_subscriptions",
      "kick_chat_watches",
      "kick_webhook_messages",
      "metrics_minute",
      "moderator_links",
      "referrals",
      "schema_migrations",
      "streamer_blocks",
      "streamer_overlay",
      "streamer_tokens",
      "streamers",
    ])
  })

  it("leaves streamers that signed in before 0007 waiting for approval", () => {
    const before = join(dir, "before-0007")
    mkdirSync(before)
    for (const name of readdirSync(coreAccountsSchemaDir())) {
      if (!name.startsWith("0007"))
        copyFileSync(join(coreAccountsSchemaDir(), name), join(before, name))
    }
    applyAccountsMigrations(db, before, systemClock)
    db.run(
      "INSERT INTO streamers (id, platform, platform_user_id, login, display_name, created_at) VALUES ('s1', 'twitch', '200', 'old', 'Old', 1)",
    )

    expect(applyAccountsMigrations(db, coreAccountsSchemaDir(), systemClock)).toEqual([
      "0007_streamer_access.sql",
    ])

    expect(db.query("SELECT approved_at, approved_by FROM streamers").all()).toEqual([
      { approved_at: null, approved_by: null },
    ])
  })

  it("applies nothing for an empty directory", () => {
    expect(applyAccountsMigrations(db, dir, systemClock)).toEqual([])
    expect(tables()).toEqual(["schema_migrations"])
  })
})
