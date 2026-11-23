/** Epoch milliseconds, UTC. */
export type Instant = number

/** A value SQLite can bind or return. */
export type SqlValue = string | number | bigint | null | Uint8Array

/** The smallest bound-parameter limit among the targets (D1). */
export const maxBoundParameters = 100

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

/** One published round of a public randomness beacon. `randomness` is the 32-byte seed the round yields. */
export interface BeaconRound {
  readonly round: number
  readonly randomness: Uint8Array<ArrayBuffer>
  /** Lower-case hex of the beacon's signature over the round. */
  readonly signature: string
}

/** Why a round could not be read: `not-yet` it is not published, `unavailable` the beacon failed or answered nonsense. */
export type BeaconAnswer =
  | { readonly kind: "round"; readonly round: BeaconRound }
  | { readonly kind: "not-yet" }
  | { readonly kind: "unavailable" }

/**
 * Reads rounds of a public randomness beacon (drand) so the draw seed is a value nobody here chose. Any
 * implementation retries transient failures itself and never invents a round: it answers `not-yet` or
 * `unavailable` instead.
 */
export interface RandomnessBeacon {
  fetchRound(chainHash: string, round: number): Promise<BeaconAnswer>
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

/** Requests counted in the current UTC day. */
export interface DayRequests {
  readonly workerRequests: number
  readonly doRequests: number
}

/** Reads the day's requests. Any implementation returns null when the target counts none (no daily limit). */
export interface UsageMeter {
  today(): Promise<DayRequests | null>
}

/**
 * Short-lived copies of public answers, keyed by the public URL of the answer. Any implementation
 * returns null for a missing or expired key, and keeps `text` for at least `ttlSeconds` unless it is
 * evicted earlier.
 */
export interface PublicCache {
  read(key: string): Promise<string | null>
  write(key: string, text: string, ttlSeconds: number): Promise<void>
  /** Drops the entry where this instance can reach it; another cache of the same deployment may keep its copy until it expires. */
  delete(key: string): Promise<void>
}

/**
 * Counts calls per key over a time window. Any implementation answers `true` for a call that is within
 * the limit its window allows for `key`, and `false` for each call beyond it until the window moves on.
 */
export interface RateLimiter {
  allow(key: string): Promise<boolean>
}

/**
 * Sends an error that a caller caught and handled to the deployment's error reporter; without one it does nothing.
 * `context` holds ids such as a request id or a giveaway id, never personal data.
 */
export type ReportError = (error: unknown, context: Readonly<Record<string, string>>) => void
