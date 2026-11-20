import type { SqlRow, SqlValue, SyncSql } from "@rafflink/core/ports"

const userVersionKey = "user_version"
const userVersionStatement = /^\s*PRAGMA\s+user_version\s*(?:=\s*(\d+))?\s*$/i

/**
 * {@link SyncSql} over the SQLite storage of one Durable Object. Durable Object SQLite refuses
 * `PRAGMA user_version`, so the adapter answers that statement from the object's key-value storage,
 * which `transaction` commits and rolls back together with the SQL writes.
 */
export class DurableObjectSyncSql implements SyncSql {
  constructor(private readonly storage: DurableObjectStorage) {}

  exec(sql: string, params: readonly SqlValue[]): SqlRow[] {
    const userVersion = userVersionStatement.exec(sql)
    if (userVersion !== null) return this.execUserVersion(userVersion[1])
    return this.storage.sql
      .exec(sql, ...params)
      .toArray()
      .map(toSqlRow)
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn)
  }

  private execUserVersion(assigned: string | undefined): SqlRow[] {
    if (assigned !== undefined) {
      this.storage.kv.put(userVersionKey, Number(assigned))
      return []
    }
    const stored = this.storage.kv.get(userVersionKey)
    return [{ user_version: typeof stored === "number" ? stored : 0 }]
  }
}

function toSqlRow(row: Record<string, SqlStorageValue>): SqlRow {
  const converted: Record<string, SqlValue> = {}
  for (const [column, value] of Object.entries(row)) {
    converted[column] = value instanceof ArrayBuffer ? new Uint8Array(value) : value
  }
  return converted
}
