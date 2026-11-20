import type { AsyncSql, SqlRow, SqlStatement, SqlValue } from "@rafflink/core/ports"

/** {@link AsyncSql} over a D1 database; `batch` is D1's own batch, which applies all statements or none. */
export class D1AsyncSql implements AsyncSql {
  constructor(private readonly db: D1Database) {}

  async all(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]> {
    const { results } = await this.prepare(sql, params).all<SqlRow>()
    return results
  }

  async run(sql: string, params: readonly SqlValue[]): Promise<void> {
    await this.prepare(sql, params).run()
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    if (statements.length === 0) return
    await this.db.batch(statements.map(({ sql, params }) => this.prepare(sql, params)))
  }

  private prepare(sql: string, params: readonly SqlValue[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...params)
  }
}
