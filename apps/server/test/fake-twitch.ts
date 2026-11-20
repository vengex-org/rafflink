import type { AccountStore } from "@rafflink/core/accounts/account-store"
import { streamerTokenAad } from "@rafflink/core/accounts/streamer-token"
import { sealSecret, type KeyRing } from "@rafflink/core/lib/seal"
import { systemRandom } from "@rafflink/core/lib/system-ports"
import type { RunningFakeTwitch } from "@rafflink/core/test/contract"
import type { TwitchClient } from "@rafflink/core/twitch/twitch-client"

const streamerScopes = ["openid", "channel:read:vips", "moderation:read"] as const

/**
 * Signs `userId` in at the fake and stores their sealed refresh token as streamer `streamerId`, as the
 * streamer sign-in does. Returns the refresh token that was sealed.
 */
export async function seedStreamer(
  running: RunningFakeTwitch,
  twitch: TwitchClient,
  accounts: AccountStore,
  keyRing: KeyRing,
  streamerId: string,
  userId: string,
): Promise<string> {
  running.fake.control.signInAs(userId)
  const redirectUri = "http://localhost/callback"
  const authorize = await fetch(
    twitch.authorizeUrl({ state: "s", nonce: "n", scopes: streamerScopes, redirectUri }),
    { redirect: "manual" },
  )
  const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code")
  const tokens = await twitch.exchangeCode(code ?? "", redirectUri)
  await accounts.signInStreamer({
    id: streamerId,
    platform: "twitch",
    platformUserId: userId,
    login: `user_${userId}`,
    sealedRefreshToken: await sealSecret(
      keyRing,
      tokens.refreshToken,
      streamerTokenAad("twitch", userId),
      systemRandom,
    ),
    scopes: streamerScopes.join(" "),
    now: 1000,
  })
  return tokens.refreshToken
}
