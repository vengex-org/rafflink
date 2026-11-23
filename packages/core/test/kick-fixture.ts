import { Database } from "bun:sqlite"
import { createFakeKick, type FakeKick, type FakeKickUser } from "@rafflink/fake-kick"
import { resolveConfig, type ResolvedConfig } from "../src/config.ts"
import { KickChatWatches } from "../src/kick/chat-watches.ts"
import { KickClient } from "../src/kick/kick-client.ts"
import { BunSqliteAsyncSql } from "../src/sqlite-bun.ts"
import { accountsSchema, TestClock } from "./app-fixture.ts"

export const kickStreamer: FakeKickUser = { id: "300", name: "Kick_Streamer" }
export const kickViewer: FakeKickUser = { id: "301", name: "Kick_Viewer" }

const app = { clientId: "kick-client", clientSecret: "kick-secret" } as const
const origin = "http://fake-kick.test"

/** An in-process fake Kick, a client that reaches it without a socket, and the Kick tables over an empty accounts database. */
export interface KickWorld {
  readonly fake: FakeKick
  readonly client: KickClient
  readonly watches: KickChatWatches
  readonly db: Database
  readonly clock: TestClock
  readonly config: ResolvedConfig
}

export function kickWorld(env: Readonly<Record<string, string>> = {}): KickWorld {
  const fake = createFakeKick({
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    defaultUser: kickViewer,
  })
  fake.control.addUser(kickStreamer)
  const config = resolveConfig({
    TWITCH_CLIENT_ID: "client",
    TWITCH_CLIENT_SECRET: "secret",
    TOKEN_SEAL_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
    SESSION_SECRET: "secret",
    ADMIN_TWITCH_IDS: "1",
    PUBLIC_URL: "http://localhost",
    KICK_CLIENT_ID: app.clientId,
    KICK_CLIENT_SECRET: app.clientSecret,
    KICK_ID_BASE_URL: origin,
    KICK_API_BASE_URL: origin,
    ...env,
  })
  const client = new KickClient(app, config, async (input, init) =>
    fake.app.fetch(new Request(input, init)),
  )
  const db = new Database(":memory:")
  db.exec(accountsSchema)
  return {
    fake,
    client,
    watches: new KickChatWatches(new BunSqliteAsyncSql(db)),
    db,
    clock: new TestClock(Date.now()),
    config,
  }
}

/** A user access token of `user` with `scopes`, through the fake's real authorize and token endpoints. */
export async function userTokens(
  world: KickWorld,
  user: FakeKickUser,
  scopes: readonly [string, ...string[]],
): Promise<{ readonly accessToken: string; readonly refreshToken: string }> {
  world.fake.control.signInAs(user.id)
  const verifier = "v".repeat(43)
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url")
  const redirectUri = "http://localhost/auth/kick/streamer"
  const authorize = await world.fake.app.fetch(
    new Request(
      world.client.authorizeUrl({ state: "s", scopes, redirectUri, codeChallenge: challenge }),
    ),
  )
  const code = new URL(authorize.headers.get("location") ?? "").searchParams.get("code") ?? ""
  return world.client.exchangeCode(code, redirectUri, verifier)
}
