import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  createFakeTwitch,
  profileImageUrlOf,
  type FakeTwitch,
  type FakeUser,
} from "@rafflink/fake-twitch"
import { resolveConfig } from "../config.ts"
import { TwitchClient } from "../twitch/twitch-client.ts"
import { AdminDirectory } from "./admin-directory.ts"

function user(id: string, login: string): FakeUser {
  return {
    id,
    login,
    displayName: login,
    createdAt: "2020-01-01T00:00:00Z",
    profileImageUrl: profileImageUrlOf(login),
  }
}

let fake: FakeTwitch
let server: ReturnType<typeof Bun.serve>

beforeEach(() => {
  fake = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: user("1", "someone"),
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  fake.control.addUser(user("200", "boss"))
  fake.control.addUser(user("300", "deputy"))
  server = Bun.serve({ port: 0, fetch: fake.app.fetch })
})

afterEach(async () => {
  await server.stop(true)
})

function directoryOf(admins: string): AdminDirectory {
  const config = resolveConfig({
    TWITCH_CLIENT_ID: "client-1",
    TWITCH_CLIENT_SECRET: "secret-1",
    TOKEN_SEAL_KEYS: "key",
    SESSION_SECRET: "session",
    ADMIN_TWITCH_IDS: admins,
    PUBLIC_URL: "http://localhost",
    TWITCH_ID_BASE_URL: server.url.origin,
    TWITCH_HELIX_BASE_URL: server.url.origin,
    TWITCH_TIMEOUT_MS: "2000",
    HELIX_RETRY_DELAY_MS: "0",
  })
  return new AdminDirectory(config, new TwitchClient(config, fetch))
}

function twitchCalls(): number {
  return fake.control.calls.length
}

describe("AdminDirectory", () => {
  it("accepts a pinned id without asking Twitch", async () => {
    const admins = directoryOf("200,https://twitch.tv/deputy")

    expect(await admins.isAdmin("200")).toBe(true)
    expect(twitchCalls()).toBe(0)
  })

  it("denies an id that is not listed, without asking Twitch when no login is configured", async () => {
    const admins = directoryOf("200")

    expect(await admins.isAdmin("300")).toBe(false)
    expect(twitchCalls()).toBe(0)
  })

  it("resolves logins and links on the first check that needs them and keeps the ids", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})
    const admins = directoryOf("Boss,https://www.twitch.tv/deputy/")

    expect(await admins.isAdmin("200")).toBe(true)
    const callsAfterFirst = twitchCalls()
    expect(await admins.isAdmin("300")).toBe(true)
    expect(await admins.isAdmin("999")).toBe(false)

    expect(twitchCalls()).toBe(callsAfterFirst)
    expect(fake.control.calls.filter((call) => call.path === "/oauth2/token")).toHaveLength(1)
    expect(fake.control.calls.find((call) => call.path === "/helix/users")?.query).toEqual({
      login: "deputy",
    })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith("admin logins resolved; pin these ids in ADMIN_TWITCH_IDS", {
      resolved: { boss: "200", deputy: "300" },
    })
    info.mockRestore()
  })

  it("denies while Twitch fails, logs the cause and resolves on the next check", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const admins = directoryOf("boss")
    fake.control.failNext("token", 503, 1)

    expect(await admins.isAdmin("200")).toBe(false)
    expect(warn).toHaveBeenCalledWith("admin login lookup failed", {
      errorClass: "TwitchUnavailable",
      endpoint: "token",
      status: 503,
    })
    expect(await admins.isAdmin("200")).toBe(true)

    info.mockRestore()
    warn.mockRestore()
  })

  it("keeps the ids of the logins that exist and warns about one without an account", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const admins = directoryOf("boss,ghost")

    expect(await admins.isAdmin("200")).toBe(true)

    expect(warn).toHaveBeenCalledWith("admin logins without a Twitch account", {
      unresolved: ["ghost"],
    })
    info.mockRestore()
    warn.mockRestore()
  })

  it("sends one lookup for checks that run at the same time", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})
    const admins = directoryOf("boss")

    const answers = await Promise.all([
      admins.isAdmin("200"),
      admins.isAdmin("201"),
      admins.isAdmin("200"),
    ])

    expect(answers).toEqual([true, false, true])
    expect(fake.control.calls.filter((call) => call.path === "/helix/users")).toHaveLength(1)
    info.mockRestore()
  })
})
