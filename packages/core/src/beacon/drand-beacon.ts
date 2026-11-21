import { setTimeout } from "node:timers/promises"
import type { ResolvedConfig } from "../config.ts"
import { parseBeaconRound, roundPath } from "../lib/drand.ts"
import { jitteredDelay } from "../lib/jittered-delay.ts"
import type { BeaconAnswer, Random, RandomnessBeacon } from "../ports.ts"

export type DrandConfig = Pick<
  ResolvedConfig,
  "drandUrl" | "drandRetryDelaysMs" | "drandRetryJitterPercent" | "drandTimeoutMs"
>

/** The `fetch` the beacon sends every call through; the global `fetch` fits. */
export type DrandFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

// One try: an answer, or a failure that may pass.
type Attempt = BeaconAnswer | { readonly kind: "transient" }

/** Reads rounds of the drand chain named in the config over its HTTP API (`/<chain hash>/public/<round>`). */
export class DrandBeacon implements RandomnessBeacon {
  constructor(
    private readonly config: DrandConfig,
    private readonly fetchImpl: DrandFetch,
    private readonly random: Random,
  ) {}

  /**
   * A round that is not published yet and a failure that may pass are tried again after each configured
   * delay; any other failure ends at once. `not-yet` after the last try means the round is still unpublished.
   */
  async fetchRound(chainHash: string, round: number): Promise<BeaconAnswer> {
    const delays = this.config.drandRetryDelaysMs
    for (let attempt = 0; ; attempt++) {
      const result = await this.tryOnce(chainHash, round)
      if (result.kind === "round" || result.kind === "unavailable") return result
      const delay = delays[attempt]
      if (delay === undefined) {
        console.warn("drand retries exhausted", { round, attempts: attempt + 1, last: result.kind })
        return result.kind === "not-yet" ? result : { kind: "unavailable" }
      }
      await setTimeout(jitteredDelay(this.random, this.config.drandRetryJitterPercent, delay))
    }
  }

  private async tryOnce(chainHash: string, round: number): Promise<Attempt> {
    let response: Response
    try {
      response = await this.fetchImpl(new URL(roundPath(chainHash, round), this.config.drandUrl), {
        signal: AbortSignal.timeout(this.config.drandTimeoutMs),
      })
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) return { kind: "transient" }
      throw error
    }
    // drand answers 425 for a round in the future and 404 while its node has not caught up.
    if (response.status === 404 || response.status === 425) return { kind: "not-yet" }
    if (response.status === 429 || response.status >= 500) return { kind: "transient" }
    if (!response.ok) {
      console.warn("drand refused the request", { round, status: response.status })
      return { kind: "unavailable" }
    }
    // A body that times out or breaks off is as transient as a failed connection.
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) return { kind: "transient" }
      if (!(error instanceof SyntaxError)) throw error
      body = null
    }
    const parsed = await parseBeaconRound(body, round)
    if (parsed === null) {
      console.warn("drand answered a round that does not check out", { round })
      return { kind: "unavailable" }
    }
    return { kind: "round", round: parsed }
  }
}
