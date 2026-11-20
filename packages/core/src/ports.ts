/** Epoch milliseconds, UTC. */
export type Instant = number

/** A value SQLite can bind or return. */
export type SqlValue = string | number | bigint | null | Uint8Array

/** A result row as the driver returns it: unconstrained, so the caller parses it at its repository edge. */
export type SqlRow = Readonly<Record<string, SqlValue>>

export interface SqlStatement {
  readonly sql: string
  readonly params: readonly SqlValue[]
}

/** Source of the current instant. Any implementation returns the real time, or a test-controlled one. */
export interface Clock {
  now(): Instant
}

/** Source of randomness. Any implementation returns exactly `length` cryptographically secure random bytes. */
export interface Random {
  bytes(length: number): Uint8Array
}

/** The single wake-up timer of one room. Any implementation keeps at most one pending alarm: `set` replaces it, `clear` cancels it. */
export interface Alarm {
  set(at: Instant): void
  clear(): void
}

/** Pushes one JSON text to every live page connected to one room. */
export interface LiveHub {
  broadcast(json: string): void
}

/**
 * Synchronous SQL over one SQLite database (Durable Object storage, bun:sqlite). Any implementation
 * binds `params` positionally, returns the rows of a statement (empty for a write, or the `RETURNING`
 * rows), and `transaction` commits when `fn` returns and rolls back everything when it throws.
 */
export interface SyncSql {
  exec(sql: string, params: readonly SqlValue[]): SqlRow[]
  transaction<T>(fn: () => T): T
}

/**
 * Asynchronous SQL over one SQLite database (D1, bun:sqlite). Any implementation binds `params`
 * positionally and runs `batch` as one atomic unit: all statements apply or none does.
 */
export interface AsyncSql {
  all(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]>
  run(sql: string, params: readonly SqlValue[]): Promise<void>
  batch(statements: readonly SqlStatement[]): Promise<void>
}
