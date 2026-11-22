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
 * An access token of the streamer. The process keeps one per streamer for most of its lifetime, so
 * the room's frequent calls (chat entry checks, the chat subscription) do not refresh each time. A
 * refresh trades the stored refresh token and stores the refresh token Twitch answered with, when it
 * differs; callers that overlap share one refresh. Throws a `PlatformError` for a platform answer and
 * a `SealError` for a token that does not open.
 */
export function openStreamerAccess(
  deps: StreamerTokenDeps,
  token: StoredStreamerToken,
): Promise<string> {
  const cached = cachedAccess.get(token.streamerId)
  if (
    cached !== undefined
    && cached.sealedRefreshToken === token.sealedRefreshToken
    && deps.clock.now() < cached.usableUntil
  ) {
    return Promise.resolve(cached.accessToken)
  }
  const running = refreshing.get(token.streamerId)
  if (running !== undefined) return running
  const access = refreshAccess(deps, token).finally(() => refreshing.delete(token.streamerId))
  refreshing.set(token.streamerId, access)
  return access
}

interface CachedAccess {
  /** The stored token the access token belongs to; a new sign-in stores another and misses the cache. */
  readonly sealedRefreshToken: string
  readonly accessToken: string
  readonly usableUntil: number
}

// Per process, keyed by streamer id.
const cachedAccess = new Map<string, CachedAccess>()
// A refresh can replace the stored refresh token, so a second refresh from the same row at once can fail.
const refreshing = new Map<string, Promise<string>>()

// The share of the announced lifetime a cached access token is used, so it is never sent near its end.
const accessTokenUsableShare = 0.9

async function refreshAccess(deps: StreamerTokenDeps, token: StoredStreamerToken): Promise<string> {
  const aad = streamerTokenAad(token.platform, token.platformUserId)
  const refreshToken = await openSecret(deps.keyRing, token.sealedRefreshToken, aad)
  const refreshed = await providerFor(deps.platforms, token.platform).refreshTokens(refreshToken)
  let stored = token.sealedRefreshToken
  if (refreshed.refreshToken !== refreshToken) {
    stored = await sealSecret(deps.keyRing, refreshed.refreshToken, aad, deps.random)
    await deps.accounts.replaceStreamerToken(token.streamerId, stored, deps.clock.now())
  }
  cachedAccess.set(token.streamerId, {
    sealedRefreshToken: stored,
    accessToken: refreshed.accessToken,
    usableUntil: deps.clock.now() + refreshed.expiresInSeconds * 1000 * accessTokenUsableShare,
  })
  return refreshed.accessToken
}
