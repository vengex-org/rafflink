import type { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Clock } from "@rafflink/core/ports"

/** The accounts schema files of core: the same files `wrangler d1 migrations` applies on Cloudflare. */
export function coreAccountsSchemaDir(): string {
  const corePackage = fileURLToPath(import.meta.resolve("@rafflink/core/package.json"))
  return join(dirname(corePackage), "schema", "accounts")
}

/**
 * Applies the `*.sql` files of `dir` in name order, each in its own transaction that also records the
 * file name, so a second call applies nothing and a new file is applied once. Returns the names applied.
 */
export function applyAccountsMigrations(db: Database, dir: string, clock: Clock): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  )
  const done = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM schema_migrations")
      .all()
      .map((row) => row.name),
  )
  const pending = readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && !done.has(name))
    .toSorted()
  for (const name of pending) {
    const script = readFileSync(join(dir, name), "utf8")
    db.transaction(() => {
      db.exec(script)
      db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        name,
        clock.now(),
      )
    })()
  }
  return pending
}
