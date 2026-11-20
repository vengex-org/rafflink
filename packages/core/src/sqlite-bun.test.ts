import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { BunSqliteAsyncSql, BunSqliteSyncSql } from "./sqlite-bun.ts"

function openDb(): Database {
  const db = new Database(":memory:")
  db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
  return db
}

describe("BunSqliteSyncSql", () => {
  it("binds params and returns RETURNING rows", () => {
    const sql = new BunSqliteSyncSql(openDb())
    const inserted = sql.exec("INSERT INTO t (id, name) VALUES (?, ?) RETURNING id, name", [1, "a"])
    expect(inserted).toEqual([{ id: 1, name: "a" }])
    expect(sql.exec("SELECT name FROM t WHERE id = ?", [2])).toEqual([])
  })

  it("rolls back every write of a transaction that throws", () => {
    const sql = new BunSqliteSyncSql(openDb())
    expect(() =>
      sql.transaction(() => {
        sql.exec("INSERT INTO t (id, name) VALUES (?, ?)", [1, "a"])
        throw new Error("boom")
      }),
    ).toThrow("boom")
    expect(sql.exec("SELECT id FROM t", [])).toEqual([])
  })

  it("commits a transaction that returns and passes its result on", () => {
    const sql = new BunSqliteSyncSql(openDb())
    const id = sql.transaction(() => {
      sql.exec("INSERT INTO t (id, name) VALUES (?, ?)", [7, "a"])
      return 7
    })
    expect(id).toBe(7)
    expect(sql.exec("SELECT id FROM t", [])).toEqual([{ id: 7 }])
  })
})

describe("BunSqliteAsyncSql", () => {
  it("runs a write and reads it back with all", async () => {
    const sql = new BunSqliteAsyncSql(openDb())
    await sql.run("INSERT INTO t (id, name) VALUES (?, ?)", [1, "a"])
    expect(await sql.all("SELECT id, name FROM t WHERE id = ?", [1])).toEqual([
      { id: 1, name: "a" },
    ])
  })

  it("applies no statement of a batch when one fails", async () => {
    const sql = new BunSqliteAsyncSql(openDb())
    const failing = sql.batch([
      { sql: "INSERT INTO t (id, name) VALUES (?, ?)", params: [1, "a"] },
      { sql: "INSERT INTO t (id, name) VALUES (?, ?)", params: [2, null] },
    ])
    await expect(failing).rejects.toThrow()
    expect(await sql.all("SELECT id FROM t", [])).toEqual([])
  })

  it("applies every statement of a batch that succeeds", async () => {
    const sql = new BunSqliteAsyncSql(openDb())
    await sql.batch([
      { sql: "INSERT INTO t (id, name) VALUES (?, ?)", params: [1, "a"] },
      { sql: "INSERT INTO t (id, name) VALUES (?, ?)", params: [2, "b"] },
    ])
    expect(await sql.all("SELECT id FROM t ORDER BY id", [])).toEqual([{ id: 1 }, { id: 2 }])
  })
})
