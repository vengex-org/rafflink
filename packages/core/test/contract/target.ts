/** A running instance of one deployment target; the contract talks to it over HTTP and WebSocket only. */
export interface ContractTarget {
  readonly url: URL
  stop(): Promise<void>
  /** Runs the hourly streamer token validation once and returns when it has finished. */
  runValidateJob(): Promise<void>
}

/**
 * Starts a fresh target with its own empty storage. `env` is the complete environment of the deployment;
 * `webDir` is the folder of the built web app it serves.
 */
export type StartTarget = (env: Record<string, string>, webDir: string) => Promise<ContractTarget>

/** How a target answers page requests: the server injects each giveaway's link preview, a static host serves the built page and its `_headers`. */
export type PageServing = "injected-previews" | "static"

export interface ContractContext {
  readonly targetName: string
  readonly pages: PageServing
  readonly startTarget: StartTarget
}
