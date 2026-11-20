import type { SyncSql } from "../ports.ts"

/**
 * Applies the migrations after the database's `PRAGMA user_version`, each in its own transaction that
 * also advances the version, so a second call applies nothing. A script holds plain statements ended
 * by `;`: no `;` inside a literal, comment or trigger body.
 */
export function applyMigrations(sql: SyncSql, migrations: readonly string[]): void {
  const applied = readVersion(sql)
  if (applied > migrations.length) {
    throw new RangeError(`database is at version ${applied}, newer than ${migrations.length}`)
  }
  for (const [offset, script] of migrations.slice(applied).entries()) {
    sql.transaction(() => {
      for (const statement of script.split(";")) {
        if (statement.trim() !== "") sql.exec(statement, [])
      }
      sql.exec(`PRAGMA user_version = ${applied + offset + 1}`, [])
    })
  }
}

function readVersion(sql: SyncSql): number {
  const version = sql.exec("PRAGMA user_version", [])[0]?.user_version
  if (typeof version !== "number") throw new TypeError("PRAGMA user_version returned no number")
  return version
}
