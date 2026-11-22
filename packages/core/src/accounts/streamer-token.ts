import type { Clock, Random } from "../ports.ts"
import { openSecret, sealSecret, type KeyRing } from "../lib/seal.ts"
import { providerFor, type PlatformProviders } from "../platform/provider.ts"
import type { AccountStore, StoredStreamerToken } from "./account-store.ts"

export interface StreamerTokenDeps {
  readonly clock: Clock
  readonly random: Random
  readonly platforms: PlatformProviders
  readonly accounts: AccountStore
  readonly keyRing: KeyRing
}

/** The sealed refresh token belongs to one platform user: a copy in another streamer's row fails to open. */
export function streamerTokenAad(platform: string, platformUserId: string): string {
  return `${platform}:${platformUserId}`
}

/**
 * Trades the stored refresh token for an access token and stores the refresh token Twitch answered
 * with, when it differs. Throws a `TwitchError` for a Twitch answer and a `SealError` for a token
 * that does not open.
 */
export async function openStreamerAccess(
  deps: StreamerTokenDeps,
  token: StoredStreamerToken,
): Promise<string> {
  const aad = streamerTokenAad(token.platform, token.platformUserId)
  const refreshToken = await openSecret(deps.keyRing, token.sealedRefreshToken, aad)
  const refreshed = await providerFor(deps.platforms, token.platform).refreshTokens(refreshToken)
  if (refreshed.refreshToken !== refreshToken) {
    const sealed = await sealSecret(deps.keyRing, refreshed.refreshToken, aad, deps.random)
    await deps.accounts.replaceStreamerToken(token.streamerId, sealed, deps.clock.now())
  }
  return refreshed.accessToken
}
