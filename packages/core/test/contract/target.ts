/** A running instance of one deployment target; the contract talks to it over HTTP and WebSocket only. */
export interface ContractTarget {
  readonly url: URL
  /**
   * Whether a client may keep a connection open for its next request. A connection Miniflare's assets router closed
   * is reused by `fetch` and fails with ECONNRESET; a new connection per request leaves a socket in TIME_WAIT for two
   * minutes, enough of them in parallel test runs to use up the local ports.
   */
  readonly reusesConnections: boolean
  stop(): Promise<void>
  /** Runs the hourly streamer token validation once and returns when it has finished. */
  runValidateJob(): Promise<void>
}

/**
 * Starts a fresh target with its own empty storage. `env` is the complete environment of the deployment;
 * `webDir` is the folder of the built web app it serves.
 */
export type StartTarget = (env: Record<string, string>, webDir: string) => Promise<ContractTarget>

/**
 * How a target answers page requests: the server injects each giveaway's link preview, a static host serves
 * the built page and its `_headers`. Both write PUBLIC_URL into the indexable pages.
 */
export type PageServing = "injected-previews" | "static"

/** Whether the target runs on a Cloudflare plan the admin page switches (`switchable`) or has none (`none`). */
export type PlanSwitching = "switchable" | "none"

export interface ContractContext {
  readonly targetName: string
  readonly pages: PageServing
  readonly plans: PlanSwitching
  readonly startTarget: StartTarget
}
