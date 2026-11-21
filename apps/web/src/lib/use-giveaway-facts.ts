import { useCallback } from "react"
import { getGiveaway, type GiveawayView } from "../api/client.ts"
import { useLoad } from "./use-load.ts"

/** What the public giveaway page knows and the live snapshot does not (streamer, prize, claim time, rules); null until it loads and when it cannot. */
export function useGiveawayFacts(code: string): GiveawayView | null {
  const load = useCallback(() => getGiveaway(code), [code])
  const { result } = useLoad(load)
  return result.state === "ready" ? (result.value?.giveaway ?? null) : null
}
