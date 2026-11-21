import { useCallback } from "react"
import { getGiveaway, type GiveawayView } from "../api/client.ts"
import { useLoad } from "./use-load.ts"

/**
 * What the public giveaway page knows and the live snapshot does not (streamer, prize, claim time, rules).
 * `facts` is null while `pending` and when they cannot be loaded.
 */
export function useGiveawayFacts(code: string): {
  readonly facts: GiveawayView | null
  readonly pending: boolean
} {
  const load = useCallback(() => getGiveaway(code), [code])
  const { result } = useLoad(load)
  return {
    facts: result.state === "ready" ? (result.value?.giveaway ?? null) : null,
    pending: result.state === "loading",
  }
}
