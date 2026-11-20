import type { AccountStore } from "@rafflink/core/accounts/account-store"
import { streamerTokenAad } from "@rafflink/core/accounts/streamer-token"
import { sealSecret, type KeyRing } from "@rafflink/core/lib/seal"
import { systemRandom } from "@rafflink/core/lib/system-ports"
import type { TwitchClient } from "@rafflink/core/twitch/twitch-client"
import { createFakeTwitch, type FakeTwitch, type FakeUser } from "@rafflink/fake-twitch"

export const users = {
  streamer: user("200"),
  otherStreamer: user("201"),
  viewer: user("100"),
} as const

function user(id: string): FakeUser {
  return { id, login: `user_${id}`, displayName: `User_${id}`, createdAt: "2019-01-01T00:00:00Z" }
}

const streamerScopes = ["openid", "channel:read:vips", "moderation:read"] as const

export interface RunningFakeTwitch {
  readonly fake: FakeTwitch
  readonly origin: string
  stop(): Promise<void>
}

/** The fake Twitch on its own port, with a client id and secret that match `testConfig`. */
export function startFakeTwitch(): RunningFakeTwitch {
  const fake = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: users.viewer,
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  for (const fakeUser of Object.values(users)) fake.control.addUser(fakeUser)
  const server = Bun.serve({ port: 0, fetch: fake.app.fetch })
  return {
    fake,
    origin: server.url.origin,
    stop: async () => {
      await server.stop(true)
    },
  }
}

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
