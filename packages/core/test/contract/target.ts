/** A running instance of one deployment target; the contract talks to it over HTTP and WebSocket only. */
export interface ContractTarget {
  readonly url: URL
  stop(): Promise<void>
  /** Runs the hourly streamer token validation once and returns when it has finished. */
  runValidateJob(): Promise<void>
}

/** Starts a fresh target with its own empty storage. `env` is the complete environment of the deployment. */
export type StartTarget = (env: Record<string, string>) => Promise<ContractTarget>

export interface ContractContext {
  readonly targetName: string
  readonly startTarget: StartTarget
}
