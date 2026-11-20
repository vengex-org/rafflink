import type { Database } from "bun:sqlite"
import type { AsyncSql, SqlRow, SqlStatement, SqlValue, SyncSql } from "./ports.ts"

/** {@link SyncSql} over a bun:sqlite database. */
export class BunSqliteSyncSql implements SyncSql {
  constructor(private readonly db: Database) {}

  exec(sql: string, params: readonly SqlValue[]): SqlRow[] {
    return this.db.query<SqlRow, SqlValue[]>(sql).all(...params)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
}

/** {@link AsyncSql} over a bun:sqlite database. */
export class BunSqliteAsyncSql implements AsyncSql {
  constructor(private readonly db: Database) {}

  async all(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    return this.db.query<SqlRow, SqlValue[]>(sql).all(...params)
  }

  async run(sql: string, params: readonly SqlValue[]): Promise<void> {
    this.db.query<SqlRow, SqlValue[]>(sql).run(...params)
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    this.db.transaction(() => {
      for (const { sql, params } of statements) {
        this.db.query<SqlRow, SqlValue[]>(sql).run(...params)
      }
    })()
  }
}
