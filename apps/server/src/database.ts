import { Database } from "bun:sqlite"

/** Opens (and creates) one SQLite file with write-ahead logging and enforced foreign keys. */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  return db
}
