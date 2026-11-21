import { Database } from "bun:sqlite"

/**
 * Opens (and creates) one SQLite file with write-ahead logging and enforced foreign keys.
 * `synchronous = NORMAL` skips the fsync per transaction: a power loss can drop the last few
 * committed entries, which is accepted for about 1.5x entry throughput (load test, H3).
 */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA foreign_keys = ON")
  return db
}
