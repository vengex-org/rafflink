import { errorClass } from "../lib/error-class.ts"
import { TwitchInvalid, TwitchRateLimited, TwitchUnavailable } from "../twitch/twitch-client.ts"
import type { StoredStreamerToken } from "./account-store.ts"
import { openStreamerAccess, type StreamerTokenDeps } from "./streamer-token.ts"

/** What one validation pass did to the stored tokens; `failed` tokens were neither confirmed nor deleted. */
export interface ValidationResult {
  readonly deleted: number
  readonly kept: number
  readonly failed: number
}

type Verdict = "valid" | "invalid" | "unavailable"

// Twitch answers a refresh token it does not know with 400 "Invalid refresh token". A wrong client id is
// also 400 ("invalid client") and a wrong secret 403: those are setup faults and must not delete tokens.
const revokedRefreshReason = "Invalid refresh token"

function isRevoked(error: TwitchInvalid): boolean {
  return error.status === 401 || (error.status === 400 && error.reason === revokedRefreshReason)
}

/**
 * Deletes the stored tokens Twitch rejects (spec AC-22). A token Twitch could not answer for (5xx,
 * 429, network) is kept; one that fails for any other reason is counted and does not stop the pass.
 */
export async function validateStreamerTokens(deps: StreamerTokenDeps): Promise<ValidationResult> {
  let deleted = 0
  let kept = 0
  let failed = 0
  for (const token of await deps.accounts.listStreamerTokens()) {
    try {
      if ((await verdictOf(deps, token)) === "invalid") {
        await deps.accounts.deleteStreamerToken(token.streamerId)
        deleted++
      } else {
        kept++
      }
    } catch (error) {
      failed++
      console.warn("streamer token check failed", {
        streamerId: token.streamerId,
        errorClass: errorClass(error),
      })
    }
  }
  return { deleted, kept, failed }
}

async function verdictOf(deps: StreamerTokenDeps, token: StoredStreamerToken): Promise<Verdict> {
  try {
    const accessToken = await openStreamerAccess(deps, token)
    return (await deps.twitch.validate(accessToken)).status
  } catch (error) {
    if (error instanceof TwitchInvalid && isRevoked(error)) return "invalid"
    if (error instanceof TwitchRateLimited || error instanceof TwitchUnavailable) {
      return "unavailable"
    }
    throw error
  }
}
