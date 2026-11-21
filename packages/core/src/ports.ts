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

/** Pushes one JSON text to the pages connected to one room: the streamer's live page, the OBS overlay, and the viewers' giveaway pages. */
export interface LiveHub {
  broadcast(json: string): void
  broadcastOverlay(json: string): void
  broadcastViewers(json: string): void
}

/** What an open {@link TextSocket} reports. */
export interface SocketHandlers {
  onText(text: string): void
  /** `cause` is `undefined` when the peer or the caller closed the socket cleanly. */
  onClose(cause: unknown): void
}

/** An outbound WebSocket that carries text frames. */
export interface TextSocket {
  /** Idempotent. */
  close(): void
}

/**
 * Opens outbound WebSockets. Any implementation returns at once, delivers text frames in order, calls
 * `onClose` exactly once when the socket ended for any reason (a failed connect and a local `close()`
 * included), and calls no handler before `open` has returned.
 */
export interface SocketConnector {
  open(url: string, handlers: SocketHandlers): TextSocket
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

/** A call across an object boundary (Durable Object stub, in-process room): every method of `T` returns a Promise. */
export type Remote<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never
}

/** Requests used against a daily limit. */
export interface Quota {
  readonly used: number
  readonly limit: number
}

/** The current UTC day's use of the target's daily limits. */
export interface Usage {
  readonly workerRequests: Quota
  readonly doRequests: Quota
}

/** Reads the day's usage. Any implementation returns null when the target has no daily limit. */
export interface UsageMeter {
  today(): Promise<Usage | null>
}

/**
 * Short-lived copies of public answers, keyed by the public URL of the answer. Any implementation
 * returns null for a missing or expired key, and keeps `text` for at least `ttlSeconds` unless it is
 * evicted earlier.
 */
export interface PublicCache {
  read(key: string): Promise<string | null>
  write(key: string, text: string, ttlSeconds: number): Promise<void>
}

/**
 * Counts calls per key over a time window. Any implementation answers `true` for a call that is within
 * the limit its window allows for `key`, and `false` for each call beyond it until the window moves on.
 */
export interface RateLimiter {
  allow(key: string): Promise<boolean>
}
