import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { serializeSigned } from "hono/utils/cookie"
import { readStreamerSession, type SessionDeps } from "./session.ts"

const deps: SessionDeps = {
  config: {
    sessionSecret: "session-secret",
    sessionTtlSeconds: 60,
    viewerSessionTtlSeconds: 60,
    stateCookieTtlSeconds: 60,
    queueCodeMaxAgeSeconds: 60,
    publicUrl: "http://localhost",
  },
  clock: { now: () => 1000 },
}

async function streamerSessionOf(payload: object): Promise<unknown> {
  const app = new Hono().get("/", async (c) => c.json(await readStreamerSession(c, deps)))
  const signed = await serializeSigned(
    "rl_streamer",
    JSON.stringify({ ...payload, expiresAt: 2000 }),
    deps.config.sessionSecret,
  )
  const cookie = signed.split(";")[0] ?? ""
  return (await app.request("/", { headers: { cookie } })).json()
}

describe("readStreamerSession", () => {
  it("reads the platform and the platform user id", async () => {
    const session = { streamerId: "s1", platform: "twitch", platformUserId: "200" }

    expect(await streamerSessionOf(session)).toEqual(session)
  })

  it("reads a cookie written before the platform seam as a Twitch session", async () => {
    expect(await streamerSessionOf({ streamerId: "s1", twitchUserId: "200" })).toEqual({
      streamerId: "s1",
      platform: "twitch",
      platformUserId: "200",
    })
  })

  it("refuses a cookie with a platform but no platform user id", async () => {
    expect(await streamerSessionOf({ streamerId: "s1", platform: "twitch" })).toBeNull()
  })
})
