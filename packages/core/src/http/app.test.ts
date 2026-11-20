import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  Browser,
  codeRandom,
  createGiveaway,
  createHarness,
  entryQuery,
  sqlRows,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"
import { codeAlphabet, codeLength } from "../lib/codes.ts"
import { openSecret } from "../lib/seal.ts"
import { RoomTransientError } from "../room/room-directory.ts"

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.stop()
})

function tokenCalls(): number {
  return harness.fake.control.calls.filter((call) => call.path === "/oauth2/token").length
}

async function viewerSignIn(userId: string, code: string, browser = new Browser(harness)) {
  const signIn = await browser.signInAs(userId, `/auth/twitch/viewer/start?giveaway=${code}`)
  return { browser, ...signIn, query: entryQuery(signIn.response) }
}

async function drawnGiveaway() {
  const created = await createGiveaway(harness)
  const winnerBrowser = new Browser(harness)
  await viewerSignIn(users.viewer.id, created.code, winnerBrowser)
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
  const draw = await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, {
    count: 1,
  })
  return { ...created, winnerBrowser, draw }
}

async function meOf(browser: Browser, code: string): Promise<unknown> {
  const response = await browser.request(`/api/g/${code}/me`)
  expect(response.headers.get("cache-control")).toBe("no-store")
  return response.json()
}

describe("streamer sign-in", () => {
  it("stores the refresh token sealed and starts a session", async () => {
    const browser = new Browser(harness)

    const signIn = await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    expect(signIn.response.headers.get("location")).toBe("/dashboard")
    const [token] = sqlRows(
      harness.accountsDb,
      "SELECT refresh_token_enc, scopes FROM streamer_tokens",
    )
    const sealed = String(token?.refresh_token_enc)
    expect(sealed.startsWith("test.")).toBe(true)
    expect(await openSecret(harness.deps.keyRing, sealed, "twitch:200")).toMatch(/^[0-9a-f-]{36}$/)
    expect(token?.scopes).toBe("openid channel:read:vips moderation:read user:read:chat")
    expect((await browser.request("/api/dash/giveaways")).status).toBe(200)
  })

  it("updates the streamer on a second sign-in instead of adding one", async () => {
    await new Browser(harness).signInAs(users.streamerA.id, "/auth/twitch/streamer/start")
    await new Browser(harness).signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    expect(sqlRows(harness.accountsDb, "SELECT id FROM streamers")).toHaveLength(1)
    expect(sqlRows(harness.accountsDb, "SELECT streamer_id FROM streamer_tokens")).toHaveLength(1)
  })

  it("refuses a dashboard request without a session", async () => {
    const response = await harness.app.request("/api/dash/giveaways")

    expect(response.status).toBe(401)
  })

  it("refuses a session cookie that was not signed by the app", async () => {
    const response = await harness.app.request("/api/dash/giveaways", {
      headers: {
        cookie: `rl_streamer=${encodeURIComponent('{"streamerId":"x","twitchUserId":"200","expiresAt":9999999999999}')}`,
      },
    })

    expect(response.status).toBe(401)
  })

  it("refuses an expired session", async () => {
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    harness.clock.advance((harness.config.sessionTtlSeconds + 1) * 1000)

    expect((await browser.request("/api/dash/giveaways")).status).toBe(401)
  })

  it("writes nothing for a forged streamer state", async () => {
    const browser = new Browser(harness)
    await browser.request("/auth/twitch/streamer/start")

    const response = await browser.request("/auth/twitch/streamer?code=abc&state=forged")

    expect(response.headers.get("location")).toBe("/?signin=invalid-state")
    expect(sqlRows(harness.accountsDb, "SELECT id FROM streamers")).toHaveLength(0)
    expect(tokenCalls()).toBe(0)
  })
})

describe("viewer sign-in start", () => {
  it("asks Twitch for the account picker only when force_verify is true", async () => {
    const { code } = await createGiveaway(harness)

    const plain = await harness.app.request(`/auth/twitch/viewer/start?giveaway=${code}`)
    const forced = await harness.app.request(
      `/auth/twitch/viewer/start?giveaway=${code}&force_verify=true`,
    )

    expect(new URL(plain.headers.get("location") ?? "").searchParams.has("force_verify")).toBe(
      false,
    )
    expect(new URL(forced.headers.get("location") ?? "").searchParams.get("force_verify")).toBe(
      "true",
    )
  })
})

describe("sign-in refused by Twitch", () => {
  it("sends a streamer who denied consent back to the home page with the error and clears the state cookie", async () => {
    const browser = new Browser(harness)
    await browser.request("/auth/twitch/streamer/start")

    const response = await browser.request(
      "/auth/twitch/streamer?error=access_denied&error_description=The+user+denied+you+access&state=s",
    )

    expect(response.headers.get("location")).toBe("/?error=access_denied")
    expect(browser.cookie("rl_oauth_streamer")).toBeUndefined()
    expect(sqlRows(harness.accountsDb, "SELECT id FROM streamers")).toHaveLength(0)
    expect(tokenCalls()).toBe(0)
  })

  it("sends a viewer who denied consent back to the giveaway page with the error and writes nothing", async () => {
    const { code, id } = await createGiveaway(harness)
    const browser = new Browser(harness)
    await browser.request(`/auth/twitch/viewer/start?giveaway=${code}`)

    const response = await browser.request("/auth/twitch/viewer?error=access_denied&state=s")

    expect(response.headers.get("location")).toBe(`/g/${code}?error=access_denied`)
    expect(browser.cookie("rl_oauth_viewer")).toBeUndefined()
    expect(browser.cookie("rl_viewer")).toBeUndefined()
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
  })

  it("sends a viewer without a state cookie to the home page and never forwards the description or an odd error", async () => {
    const response = await harness.app.request(
      "/auth/twitch/viewer?error=%3Cscript%3E&error_description=%3Cb%3Ex%3C%2Fb%3E",
    )

    expect(response.headers.get("location")).toBe("/?error=error")
  })
})

describe("creating a giveaway", () => {
  it("saves it and returns a code from the alphabet", async () => {
    const { browser, code, id } = await createGiveaway(harness)

    expect(code).toHaveLength(codeLength)
    expect([...code].every((char) => codeAlphabet.includes(char))).toBe(true)
    const list: { giveaways: { id: string; status: string }[] } = await (
      await browser.request("/api/dash/giveaways")
    ).json()
    expect(list.giveaways).toMatchObject([{ id, status: "open" }])
  })

  it("shows the public page with title, prize, streamer name, rules, status and entrant count", async () => {
    const { code } = await createGiveaway(harness)
    await viewerSignIn(users.viewer.id, code)

    const response = await harness.app.request(`/api/g/${code}`)

    expect(await response.json()).toEqual({
      code,
      title: "Giveaway",
      prize: "Prize",
      streamerName: users.streamerA.displayName,
      rules: validRules,
      status: "open",
      closesAt: null,
      claimSeconds: 300,
      entrantCount: 1,
      poll: { intervalMs: 3000, maxMs: 120_000 },
    })
  })

  it("saves a giveaway without a title and a prize as not set", async () => {
    const { browser, code } = await createGiveaway(harness, users.streamerA.id, {
      title: "  ",
      prize: undefined,
    })

    const page = await (await harness.app.request(`/api/g/${code}`)).json()
    const list: { giveaways: { title: string | null; prize: string | null }[] } = await (
      await browser.request("/api/dash/giveaways")
    ).json()

    expect(page).toMatchObject({ title: null, prize: null })
    expect(list.giveaways).toMatchObject([{ title: null, prize: null }])
    expect(sqlRows(harness.accountsDb, "SELECT title, prize FROM giveaways")).toEqual([
      { title: null, prize: null },
    ])
  })

  it("answers 404 for a code that does not exist", async () => {
    expect((await harness.app.request("/api/g/ZZZZZ")).status).toBe(404)
  })

  it("retries the short code when it is taken", async () => {
    const codes = ["AAAAA", "AAAAA", "AAAAA", "BBBBB"]
    await harness.stop()
    harness = await createHarness({ random: codeRandom(() => codes.shift() ?? "CCCCC") })
    await createGiveaway(harness)
    const insert = spyOn(harness.deps.accounts, "insertGiveaway")

    const second = await createGiveaway(harness, users.streamerB.id)

    expect(insert).toHaveBeenCalledTimes(3)
    expect(second.code).toBe("BBBBB")
  })

  it("answers 503 and creates nothing when every code is taken", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    await harness.stop()
    harness = await createHarness({ random: codeRandom(() => "AAAAA") })
    await createGiveaway(harness)
    const insert = spyOn(harness.deps.accounts, "insertGiveaway")
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const response = await browser.postJson("/api/dash/giveaways", {
      title: "T",
      prize: "P",
      rules: validRules,
    })

    expect(response.status).toBe(503)
    expect(insert).toHaveBeenCalledTimes(harness.config.codeInsertRetries + 1)
    expect(sqlRows(harness.accountsDb, "SELECT id FROM giveaways")).toHaveLength(1)
    warn.mockRestore()
  })

  it("writes the account row before it initialises the room", async () => {
    const rowSeenByInit: boolean[] = []
    harness.rooms.hooks.beforeInit = async (id) => {
      rowSeenByInit.push((await harness.deps.accounts.findGiveawayById(id)) !== null)
    }

    await createGiveaway(harness)

    expect(rowSeenByInit).toEqual([true])
  })

  it("keeps the account row when the room cannot be initialised, and the next action initialises it", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    let failures = 1
    harness.rooms.hooks.beforeInit = () => {
      if (failures-- > 0) throw new Error("room down")
    }
    const { browser, id } = await createGiveaway(harness)
    expect(sqlRows(harness.accountsDb, "SELECT id FROM giveaways")).toHaveLength(1)
    expect(() => harness.rooms.roomFor(id).summary()).toThrow("room is not initialised")

    const closed = await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    expect(closed.status).toBe(200)
    expect(harness.rooms.roomFor(id).summary().status).toBe("closed")
    warn.mockRestore()
  })

  it("answers 503 for an action while the room stays unavailable", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    harness.rooms.hooks.beforeInit = () => {
      throw new Error("room down")
    }
    const { browser, id } = await createGiveaway(harness)

    const response = await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    expect(response.status).toBe(503)
    warn.mockRestore()
  })

  it("rejects an invalid body with the offending field", async () => {
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    const response = await browser.postJson("/api/dash/giveaways", {
      title: "T",
      prize: "P",
      rules: { ...validRules, claimKeyword: "   " },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "invalid-input",
      field: "claimKeyword",
      code: "blank",
    })
  })

  it("rejects a body that is not JSON", async () => {
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    const response = await browser.request("/api/dash/giveaways", { method: "POST", body: "{" })

    expect(response.status).toBe(400)
  })

  it("refuses creation without a session", async () => {
    const response = await harness.app.request("/api/dash/giveaways", {
      method: "POST",
      body: JSON.stringify({ title: "T", prize: "P", rules: validRules }),
    })

    expect(response.status).toBe(401)
  })
})

describe("viewer entry", () => {
  it("enters an eligible viewer with the tickets of the best group", async () => {
    const { code, id } = await createGiveaway(harness)
    harness.fake.control.setFollowing(users.viewer.id, users.streamerA.id, true)

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("entered")
    expect(harness.rooms.roomFor(id).summary()).toMatchObject({ entrantCount: 1, ticketTotal: 2 })
  })

  it("weights a subscriber by the subscription tier", async () => {
    const { code, id } = await createGiveaway(harness)
    harness.fake.control.setFollowing(users.viewer.id, users.streamerA.id, true)
    harness.fake.control.setSubscription(users.viewer.id, users.streamerA.id, "2000")

    await viewerSignIn(users.viewer.id, code)

    expect(harness.rooms.roomFor(id).summary().ticketTotal).toBe(4)
  })

  it("keeps the first entry and says the viewer is in", async () => {
    const { code, id } = await createGiveaway(harness)
    const browser = new Browser(harness)
    await viewerSignIn(users.viewer.id, code, browser)

    const { query } = await viewerSignIn(users.viewer.id, code, browser)

    expect(query.get("entry")).toBe("already-in")
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(1)
  })

  it("shows the reason and writes nothing for a viewer who is not eligible", async () => {
    const { code, id } = await createGiveaway(harness, users.streamerA.id, {
      rules: { ...validRules, subsOnly: true },
    })

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("not-eligible")
    expect(query.get("reason")).toBe("subs-only")
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
  })

  it("refuses the broadcaster", async () => {
    const { code } = await createGiveaway(harness)

    const { query } = await viewerSignIn(users.streamerA.id, code)

    expect(query.get("reason")).toBe("broadcaster")
  })

  it("reports a closed giveaway", async () => {
    const { code, id, browser } = await createGiveaway(harness)
    await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("closed")
  })

  it("rejects a sign-in started for a giveaway that does not exist", async () => {
    const response = await new Browser(harness).request("/auth/twitch/viewer/start?giveaway=ZZZZZ")

    expect(response.status).toBe(404)
  })

  it("a forged state writes nothing", async () => {
    const { code, id } = await createGiveaway(harness)
    const before = tokenCalls()
    const browser = new Browser(harness)
    await browser.request(`/auth/twitch/viewer/start?giveaway=${code}`)

    const response = await browser.request("/auth/twitch/viewer?code=abc&state=forged")

    expect(entryQuery(response).get("entry")).toBe("invalid-state")
    expect(tokenCalls()).toBe(before)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
    expect(harness.queue.stats().queued).toBe(0)
    expect(browser.cookie("rl_viewer")).toBeUndefined()
  })

  it("writes nothing when the callback has no state cookie", async () => {
    const { code, id } = await createGiveaway(harness)
    const before = tokenCalls()
    harness.fake.control.signInAs(users.viewer.id)
    const start = await new Browser(harness).request(`/auth/twitch/viewer/start?giveaway=${code}`)
    const authorize = await fetch(start.headers.get("location") ?? "", { redirect: "manual" })
    const callback = new URL(authorize.headers.get("location") ?? "")

    const response = await harness.app.request(callback.pathname + callback.search)

    expect(entryQuery(response).get("entry")).toBe("invalid-state")
    expect(tokenCalls()).toBe(before)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
  })

  it("writes nothing when the id_token nonce differs from the cookie", async () => {
    const { code, id } = await createGiveaway(harness)
    const browser = new Browser(harness)
    harness.fake.control.signInAs(users.viewer.id)
    const start = await browser.request(`/auth/twitch/viewer/start?giveaway=${code}`)
    const authorizeUrl = new URL(start.headers.get("location") ?? "")
    authorizeUrl.searchParams.set("nonce", "another-nonce")
    const authorize = await fetch(authorizeUrl, { redirect: "manual" })
    const callback = new URL(authorize.headers.get("location") ?? "")

    const response = await browser.request(callback.pathname + callback.search)

    expect(entryQuery(response).get("entry")).toBe("invalid-state")
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
  })

  it("answers try-again when Helix rate limits after the code was spent", async () => {
    const { code, id } = await createGiveaway(harness)
    harness.fake.control.failNext("followed", 429, 1)

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("try-again")
    expect(harness.queue.stats().queued).toBe(0)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
  })

  it("retries the room write on overloaded and then enters", async () => {
    const { code, id } = await createGiveaway(harness)
    let calls = 0
    harness.rooms.hooks.beforeEnter = () => {
      calls++
      if (calls <= 2) throw new RoomTransientError("overloaded")
    }

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("entered")
    expect(calls).toBe(3)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(1)
  })

  it("answers try-again after the configured retries of the room write", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { code, id } = await createGiveaway(harness)
    let calls = 0
    harness.rooms.hooks.beforeEnter = () => {
      calls++
      throw new RoomTransientError("overloaded")
    }

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("try-again")
    expect(calls).toBe(harness.config.entryWriteRetryDelaysMs.length + 1)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
    warn.mockRestore()
  })

  it("fails fast on an error that is not transient", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { code } = await createGiveaway(harness)
    let calls = 0
    harness.rooms.hooks.beforeEnter = () => {
      calls++
      throw new Error("constraint failed")
    }

    const { response } = await viewerSignIn(users.viewer.id, code)

    expect(response.status).toBe(500)
    expect(calls).toBe(1)
    error.mockRestore()
  })
})

describe("token endpoint limits", () => {
  it("a token-endpoint 429 queues the code and answers pending", async () => {
    const { code, id } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)

    const { browser, query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("pending")
    const ticket = query.get("ticket") ?? ""
    expect(harness.queue.stats().queued).toBe(1)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
    const waiting = await browser.request(`/api/g/${code}/pending/${ticket}`)
    expect(await waiting.json()).toEqual({ kind: "pending", ticket })

    harness.clock.advance((harness.config.queueCooldownSeconds + 1) * 1000)
    await harness.queue.onAlarm()

    const done = await browser.request(`/api/g/${code}/pending/${ticket}`)
    expect(await done.json()).toMatchObject({
      kind: "entered",
      entry: { group: "viewer", tickets: 1 },
    })
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(1)
  })

  it("queues a 5xx from the token endpoint without starting a cooldown", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 503, 1)

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("pending")
    expect(harness.queue.stats().cooldownUntil).toBe(0)
  })

  it("queues every new code during the cooldown without calling the token endpoint", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    await viewerSignIn(users.viewer.id, code)
    const afterFirst = tokenCalls()

    const second = await viewerSignIn(users.viewer2.id, code)

    expect(second.query.get("entry")).toBe("pending")
    expect(tokenCalls()).toBe(afterFirst)
    expect(harness.queue.stats().queued).toBe(2)
  })

  it("calls the token endpoint again once the cooldown is over", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    await viewerSignIn(users.viewer.id, code)
    const afterFirst = tokenCalls()
    harness.clock.advance(harness.config.queueCooldownSeconds * 1000)

    const second = await viewerSignIn(users.viewer2.id, code)

    expect(second.query.get("entry")).toBe("entered")
    expect(tokenCalls()).toBe(afterFirst + 1)
  })

  it("starts the viewer cookie with the poll answer that settles a queued entry", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    const { browser, query } = await viewerSignIn(users.viewer.id, code)
    const ticket = query.get("ticket") ?? ""
    harness.clock.advance((harness.config.queueCooldownSeconds + 1) * 1000)

    const waiting = await browser.request(`/api/g/${code}/pending/${ticket}`)
    expect(waiting.headers.getSetCookie()).toEqual([])
    expect(await meOf(browser, code)).toEqual({ kind: "signed-out" })
    await harness.queue.onAlarm()
    const done = await browser.request(`/api/g/${code}/pending/${ticket}`)

    expect(done.headers.getSetCookie().some((cookie) => cookie.startsWith("rl_viewer="))).toBe(true)
    expect(await meOf(browser, code)).toMatchObject({
      kind: "entered",
      entry: { group: "viewer", tickets: 1 },
    })
  })

  it("starts no viewer cookie for a settled entry that has no verified user", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    const { browser, query } = await viewerSignIn(users.viewer.id, code)
    const ticket = query.get("ticket") ?? ""
    harness.queueDb.exec(
      `UPDATE token_queue SET state = 'done', result_json = '{"kind":"try-again"}', user_id = NULL
       WHERE ticket = '${ticket}'`,
    )

    const response = await browser.request(`/api/g/${code}/pending/${ticket}`)

    expect(await response.json()).toEqual({ kind: "try-again" })
    const cookies = response.headers.getSetCookie()
    expect(cookies.some((cookie) => cookie.startsWith("rl_viewer="))).toBe(false)
    expect(cookies.some((cookie) => cookie.startsWith("rl_pending=;"))).toBe(true)
  })

  it("answers 404 for the poll of a giveaway that does not exist and keeps the result", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    const { browser, query } = await viewerSignIn(users.viewer.id, code)
    const ticket = query.get("ticket") ?? ""
    harness.clock.advance((harness.config.queueCooldownSeconds + 1) * 1000)
    await harness.queue.onAlarm()

    const wrong = await browser.request(`/api/g/ZZZZZ/pending/${ticket}`)
    const right = await browser.request(`/api/g/${code}/pending/${ticket}`)

    expect(wrong.status).toBe(404)
    expect(await right.json()).toMatchObject({ kind: "entered" })
  })

  it("gives a copied pending URL neither the result nor the viewer session", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    const { browser, query } = await viewerSignIn(users.viewer.id, code)
    const ticket = query.get("ticket") ?? ""
    harness.clock.advance((harness.config.queueCooldownSeconds + 1) * 1000)
    await harness.queue.onAlarm()
    const stranger = new Browser(harness)

    const copied = await stranger.request(`/api/g/${code}/pending/${ticket}`)

    expect(await copied.json()).toEqual({ kind: "dropped" })
    expect(copied.headers.getSetCookie()).toEqual([])
    expect(await meOf(stranger, code)).toEqual({ kind: "signed-out" })
    const owner = await browser.request(`/api/g/${code}/pending/${ticket}`)
    expect(await owner.json()).toMatchObject({ kind: "entered" })
  })

  it("does not accept the pending cookie of one giveaway on another", async () => {
    const first = await createGiveaway(harness)
    const second = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    const { browser, query } = await viewerSignIn(users.viewer.id, first.code)
    const ticket = query.get("ticket") ?? ""
    harness.clock.advance((harness.config.queueCooldownSeconds + 1) * 1000)
    await harness.queue.onAlarm()

    const other = await browser.request(`/api/g/${second.code}/pending/${ticket}`)

    expect(await other.json()).toEqual({ kind: "dropped" })
    expect(other.headers.getSetCookie()).toEqual([])
  })

  it("answers dropped for a ticket the queue no longer holds", async () => {
    const { code } = await createGiveaway(harness)

    const response = await harness.app.request(`/api/g/${code}/pending/unknown`)

    expect(await response.json()).toEqual({ kind: "dropped" })
  })
})

describe("winners", () => {
  it("draws from a closed giveaway and mirrors the status", async () => {
    const { draw, id } = await drawnGiveaway()

    expect(await draw.json()).toEqual({ kind: "drawn", winners: [0] })
    expect(
      sqlRows(harness.accountsDb, "SELECT status FROM giveaways WHERE id = ?", [id])[0]?.status,
    ).toBe("drawn")
  })

  it("refuses a draw while entries are open", async () => {
    const { browser, id } = await createGiveaway(harness)

    const response = await browser.postJson(`/api/dash/giveaways/${id}/draw`, { count: 1 })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ kind: "not-closed" })
  })

  it("refuses a draw count that is not a positive integer", async () => {
    const { browser, id } = await createGiveaway(harness)
    await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    for (const count of [0, -1, 1.5, "2", null]) {
      const response = await browser.postJson(`/api/dash/giveaways/${id}/draw`, { count })
      expect(response.status).toBe(400)
    }
  })

  it("lets the winner claim once", async () => {
    const { code, id, winnerBrowser } = await drawnGiveaway()

    const claimed = await winnerBrowser.request(`/api/g/${code}/claim`, { method: "POST" })
    const again = await winnerBrowser.request(`/api/g/${code}/claim`, { method: "POST" })

    expect(await claimed.json()).toEqual({ kind: "claimed" })
    expect(again.status).toBe(409)
    expect(harness.rooms.roomFor(id).liveSnapshot().winners[0]?.claim).toEqual({
      state: "claimed",
      via: "rafflink",
    })
  })

  it("refuses a claim from a viewer who did not win", async () => {
    const { code } = await drawnGiveaway()
    const other = new Browser(harness)
    await viewerSignIn(users.viewer2.id, code, other)

    const response = await other.request(`/api/g/${code}/claim`, { method: "POST" })

    expect(response.status).toBe(403)
  })

  it("refuses a claim without a viewer session", async () => {
    const { code } = await drawnGiveaway()

    const response = await harness.app.request(`/api/g/${code}/claim`, { method: "POST" })

    expect(response.status).toBe(401)
  })

  it("lets the streamer mark a claim by hand", async () => {
    const { browser, id } = await drawnGiveaway()

    const response = await browser.postJson(`/api/dash/giveaways/${id}/claim`, { n: 0 })

    expect(await response.json()).toEqual({ kind: "claimed" })
    expect(harness.rooms.roomFor(id).liveSnapshot().winners[0]?.claim).toEqual({
      state: "claimed",
      via: "manual",
    })
  })

  it("answers 404 for a manual claim of a pick that does not exist", async () => {
    const { browser, id } = await drawnGiveaway()

    const response = await browser.postJson(`/api/dash/giveaways/${id}/claim`, { n: 7 })

    expect(response.status).toBe(404)
  })

  it("rerolls a winner and adds the next pick", async () => {
    const created = await createGiveaway(harness)
    await viewerSignIn(users.viewer.id, created.code)
    await viewerSignIn(users.viewer2.id, created.code)
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })

    const response = await created.browser.postJson(`/api/dash/giveaways/${created.id}/reroll`, {
      n: 0,
    })

    expect(await response.json()).toEqual({ kind: "rerolled", replaced: 0, n: 1 })
    expect(
      harness.rooms
        .roomFor(created.id)
        .liveSnapshot()
        .winners.map((winner) => winner.claim.state),
    ).toEqual(["rerolled", "waiting"])
  })

  it("answers 409 for a reroll when no entrant is left", async () => {
    const { browser, id } = await drawnGiveaway()

    const response = await browser.postJson(`/api/dash/giveaways/${id}/reroll`, { n: 0 })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ kind: "no-entrants-left" })
  })

  it("answers 404 for a reroll of a pick that does not exist", async () => {
    const { browser, id } = await drawnGiveaway()

    expect((await browser.postJson(`/api/dash/giveaways/${id}/reroll`, { n: 9 })).status).toBe(404)
  })
})

describe("owner scoping", () => {
  it("streamer B cannot draw streamer A's giveaway", async () => {
    const a = await createGiveaway(harness, users.streamerA.id)
    await a.browser.postJson(`/api/dash/giveaways/${a.id}/close`, {})
    const b = new Browser(harness)
    await b.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const response = await b.postJson(`/api/dash/giveaways/${a.id}/draw`, { count: 1 })

    expect(response.status).toBe(404)
    expect(harness.rooms.roomFor(a.id).summary().status).toBe("closed")
  })

  it("answers 404 to streamer B for every action on A's giveaway", async () => {
    const a = await createGiveaway(harness, users.streamerA.id)
    const b = new Browser(harness)
    await b.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    for (const action of ["close", "draw", "reroll", "claim"]) {
      const response = await b.postJson(`/api/dash/giveaways/${a.id}/${action}`, { count: 1, n: 0 })
      expect(response.status).toBe(404)
    }
    expect((await b.request(`/api/live/${a.id}`)).status).toBe(404)
    expect(harness.rooms.roomFor(a.id).summary().status).toBe("open")
  })

  it("lists only the signed-in streamer's giveaways", async () => {
    await createGiveaway(harness, users.streamerA.id)
    const b = await createGiveaway(harness, users.streamerB.id)

    const list: { giveaways: { id: string }[] } = await (
      await b.browser.request("/api/dash/giveaways")
    ).json()

    expect(list.giveaways.map((giveaway) => giveaway.id)).toEqual([b.id])
  })
})

describe("closing", () => {
  it("keeps the room closed and leaves the mirror pending when the account store is down", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { browser, id } = await createGiveaway(harness)
    spyOn(harness.deps.accounts, "setStatus").mockRejectedValue(new Error("d1 down"))

    const response = await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    expect(response.status).toBe(200)
    expect(harness.rooms.roomFor(id).summary().status).toBe("closed")
    harness.clock.advance(harness.config.mirrorRetrySeconds * 1000)
    expect(harness.rooms.roomFor(id).onAlarm().mirrorStatus).toBe("closed")
    warn.mockRestore()
  })

  it("answers 409 for a giveaway that is already closed", async () => {
    const { browser, id } = await createGiveaway(harness)
    await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    const response = await browser.postJson(`/api/dash/giveaways/${id}/close`, {})

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ kind: "not-open", status: "closed" })
  })
})

describe("viewer state", () => {
  it("keeps in the viewer cookie only the platform and the user id, signed, HttpOnly and Lax", async () => {
    const { code } = await createGiveaway(harness)

    const { response } = await viewerSignIn(users.viewer.id, code)

    const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith("rl_viewer="))
    expect(header).toContain("HttpOnly")
    expect(header).toContain("SameSite=Lax")
    expect(header).toContain(`Max-Age=${harness.config.viewerSessionTtlSeconds}`)
    const [value = ""] = (header ?? "").slice("rl_viewer=".length).split(";")
    const signed = decodeURIComponent(value)
    const payload: unknown = JSON.parse(signed.slice(0, signed.lastIndexOf("}") + 1))
    expect(payload).toEqual({
      platform: "twitch",
      userId: users.viewer.id,
      expiresAt: harness.clock.now() + harness.config.viewerSessionTtlSeconds * 1000,
    })
  })

  it("says signed-out without a viewer cookie and for a cookie that was not signed by the app", async () => {
    const { code } = await createGiveaway(harness)
    const forgedValue = `{"platform":"twitch","userId":"${users.viewer.id}","expiresAt":9999999999999}`

    const plain = await harness.app.request(`/api/g/${code}/me`)
    const forged = await harness.app.request(`/api/g/${code}/me`, {
      headers: { cookie: `rl_viewer=${encodeURIComponent(forgedValue)}` },
    })

    expect(await plain.json()).toEqual({ kind: "signed-out" })
    expect(await forged.json()).toEqual({ kind: "signed-out" })
  })

  it("answers 404 for a giveaway that does not exist", async () => {
    expect((await harness.app.request("/api/g/NOPE0/me")).status).toBe(404)
  })

  it("says not-entered to a signed-in viewer who did not enter this giveaway", async () => {
    const first = await createGiveaway(harness)
    const second = await createGiveaway(harness, users.streamerB.id)
    const viewer = new Browser(harness)
    await viewerSignIn(users.viewer.id, second.code, viewer)

    expect(await meOf(viewer, first.code)).toEqual({ kind: "not-entered" })
  })

  it("shows the tickets and the group of an entry when the page is opened again", async () => {
    const { code } = await createGiveaway(harness)
    harness.fake.control.setSubscription(users.viewer.id, users.streamerA.id, "2000")
    const viewer = new Browser(harness)
    await viewerSignIn(users.viewer.id, code, viewer)

    expect(await meOf(viewer, code)).toEqual({
      kind: "entered",
      entry: { group: "sub_t2", tickets: 4, enteredAt: harness.clock.now() },
    })
  })

  it("shows a won pick with the remaining claim time, then its claim, with the chat claim available", async () => {
    const { code, winnerBrowser } = await drawnGiveaway()
    harness.clock.advance(60_000)

    const won = await meOf(winnerBrowser, code)
    await winnerBrowser.request(`/api/g/${code}/claim`, { method: "POST" })

    expect(won).toEqual({
      kind: "won",
      n: 0,
      claimRemainingMs: 240_000,
      claim: { state: "waiting" },
      chatClaimAvailable: true,
    })
    expect(await meOf(winnerBrowser, code)).toMatchObject({
      kind: "won",
      claim: { state: "claimed", via: "rafflink" },
    })
  })

  it("says not-won to an entrant who was not drawn", async () => {
    const created = await createGiveaway(harness)
    const first = new Browser(harness)
    const second = new Browser(harness)
    await viewerSignIn(users.viewer.id, created.code, first)
    await viewerSignIn(users.viewer2.id, created.code, second)
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })

    const kinds = [await meOf(first, created.code), await meOf(second, created.code)].map(
      (state) =>
        typeof state === "object" && state !== null && "kind" in state ? state.kind : null,
    )

    expect(kinds.toSorted()).toEqual(["not-won", "won"])
  })

  it("lets a returning viewer claim with the cookie alone and refuses a cookie of another platform", async () => {
    const { code, winnerBrowser } = await drawnGiveaway()
    const cookie = winnerBrowser.cookie("rl_viewer") ?? ""

    const claim = await harness.app.request(`/api/g/${code}/claim`, {
      method: "POST",
      headers: { cookie: `rl_viewer=${cookie}` },
    })
    const otherPlatform = await harness.app.request(`/api/g/${code}/claim`, {
      method: "POST",
      headers: { cookie: `rl_viewer=${cookie.replace("twitch", "kick")}` },
    })

    expect(await claim.json()).toEqual({ kind: "claimed" })
    expect(otherPlatform.status).toBe(401)
  })

  it("forgets the viewer after the viewer cookie lifetime, which is its own setting", async () => {
    const { code } = await createGiveaway(harness)
    const viewer = new Browser(harness)
    await viewerSignIn(users.viewer.id, code, viewer)

    harness.clock.advance(harness.config.sessionTtlSeconds * 1000 + 1)
    const afterSessionTtl = await meOf(viewer, code)
    harness.clock.advance(harness.config.viewerSessionTtlSeconds * 1000)

    expect(afterSessionTtl).toMatchObject({ kind: "entered" })
    expect(await meOf(viewer, code)).toEqual({ kind: "signed-out" })
  })
})

interface EntrantsBody {
  readonly rows: readonly {
    seq: number
    login: string
    displayName: string
    tickets: number
    group: string
  }[]
  readonly more: boolean
}

async function entrantsOf(browser: Browser, id: string, query = ""): Promise<Response> {
  return browser.request(`/api/live/${id}/entrants${query}`)
}

async function giveawayWithEntrants(count: number) {
  const created = await createGiveaway(harness)
  const room = harness.rooms.roomFor(created.id)
  for (let index = 1; index <= count; index++) {
    room.enter({
      platformUserId: String(index),
      login: `login${index}`,
      displayName: `Name${index}`,
      isFollower: index === 2,
      subTier: null,
      accountAgeDays: 100,
    })
  }
  return created
}

describe("entrants of the live page", () => {
  it("lists the entrants in the order they entered, with who they are and their tickets", async () => {
    const { browser, id } = await giveawayWithEntrants(3)

    const response = await entrantsOf(browser, id)
    const body: EntrantsBody = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(body).toEqual({
      more: false,
      rows: [
        { seq: 1, login: "login1", displayName: "Name1", tickets: 1, group: "viewer" },
        { seq: 2, login: "login2", displayName: "Name2", tickets: 2, group: "follower" },
        { seq: 3, login: "login3", displayName: "Name3", tickets: 1, group: "viewer" },
      ],
    })
  })

  it("pages by sequence number and says whether another page follows", async () => {
    const { browser, id } = await giveawayWithEntrants(5)

    const first: EntrantsBody = await (await entrantsOf(browser, id, "?limit=2")).json()
    const second: EntrantsBody = await (await entrantsOf(browser, id, "?after=2&limit=2")).json()
    const last: EntrantsBody = await (await entrantsOf(browser, id, "?after=4&limit=2")).json()

    expect(first.rows.map((row) => row.seq)).toEqual([1, 2])
    expect(first.more).toBe(true)
    expect(second.rows.map((row) => row.seq)).toEqual([3, 4])
    expect(second.more).toBe(true)
    expect(last.rows.map((row) => row.seq)).toEqual([5])
    expect(last.more).toBe(false)
  })

  it("answers an empty last page after the final entrant", async () => {
    const { browser, id } = await giveawayWithEntrants(2)

    const body: EntrantsBody = await (await entrantsOf(browser, id, "?after=2")).json()

    expect(body).toEqual({ rows: [], more: false })
  })

  it("caps the page at the configured maximum whatever limit is asked for", async () => {
    await harness.stop()
    harness = await createHarness({ env: { ENTRANTS_PAGE_MAX: "2" } })
    const { browser, id } = await giveawayWithEntrants(5)

    const asked: EntrantsBody = await (await entrantsOf(browser, id, "?limit=1000")).json()
    const unasked: EntrantsBody = await (await entrantsOf(browser, id)).json()

    expect(asked.rows).toHaveLength(2)
    expect(asked.more).toBe(true)
    expect(unasked.rows).toHaveLength(2)
  })

  it("refuses a sequence number or a limit that is not a whole number in range", async () => {
    const { browser, id } = await giveawayWithEntrants(1)

    for (const [query, field] of [
      ["?after=-1", "after"],
      ["?after=1.5", "after"],
      ["?after=abc", "after"],
      ["?after=", "after"],
      ["?after=9007199254740993", "after"],
      ["?limit=0", "limit"],
      ["?limit=-5", "limit"],
      ["?limit=NaN", "limit"],
      ["?limit=Infinity", "limit"],
      ["?limit=", "limit"],
      ["?limit=constructor", "limit"],
    ] as const) {
      const response = await entrantsOf(browser, id, query)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "invalid-input", field })
    }
  })

  it("answers 404 to streamer B for the entrants of A's giveaway", async () => {
    const a = await giveawayWithEntrants(2)
    const b = new Browser(harness)
    await b.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const response = await entrantsOf(b, a.id)

    expect(response.status).toBe(404)
    expect(JSON.stringify(await response.json())).not.toContain("login1")
  })

  it("answers 401 without a session and 404 for a giveaway that does not exist", async () => {
    const { browser, id } = await giveawayWithEntrants(1)

    expect((await harness.app.request(`/api/live/${id}/entrants`)).status).toBe(401)
    expect((await entrantsOf(browser, "nope")).status).toBe(404)
  })
})

describe("overlay and admin", () => {
  it("sends the overlay token with the owner's live snapshot and not with the overlay's", async () => {
    const { browser, id, overlayToken } = await createGiveaway(harness)

    const owner = await (await browser.request(`/api/live/${id}`)).json()
    const overlay = await (await harness.app.request(`/api/overlay/${id}/${overlayToken}`)).json()

    expect(owner).toMatchObject({ overlayToken, status: "open" })
    expect(overlay).not.toHaveProperty("overlayToken")
  })

  it("shows the live view to a request with the overlay token and no session", async () => {
    const { id, overlayToken } = await createGiveaway(harness)

    const response = await harness.app.request(`/api/overlay/${id}/${overlayToken}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "open", entrantCount: 0 })
  })

  it("answers 404 for a wrong, truncated or empty overlay token", async () => {
    const { id, overlayToken } = await createGiveaway(harness)

    for (const token of [
      "wrong",
      overlayToken.slice(1),
      `${overlayToken}0`,
      overlayToken.toUpperCase(),
    ]) {
      expect((await harness.app.request(`/api/overlay/${id}/${token}`)).status).toBe(404)
    }
    expect((await harness.app.request(`/api/overlay/${id}/`)).status).toBe(404)
  })

  it("answers 404 for the overlay of a giveaway that does not exist", async () => {
    expect((await harness.app.request("/api/overlay/nope/token")).status).toBe(404)
  })

  it("shows the usage and the queue counters to an admin", async () => {
    harness.usage.usage = {
      workerRequests: { used: 10, limit: 100_000 },
      doRequests: { used: 5, limit: 100_000 },
    }
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    const response = await browser.request("/api/admin/usage")

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      usage: { workerRequests: { used: 10, limit: 100_000 } },
      queue: { queued: 0, dropped: 0 },
    })
  })

  it("shows usage as unavailable to an admin when the usage source fails", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    harness.usage.failure = new Error("Analytics answered 500")
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    const response = await browser.request("/api/admin/usage")

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ usage: "unavailable", queue: { dropped: 0 } })
  })

  it("lets a streamer listed by login open the admin page", async () => {
    spyOn(console, "info").mockImplementation(() => {})
    const byLogin = await createHarness({ env: { ADMIN_TWITCH_IDS: users.streamerB.login } })
    try {
      const browser = new Browser(byLogin)
      await browser.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")
      const other = new Browser(byLogin)
      await other.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

      expect((await browser.request("/api/admin/usage")).status).toBe(200)
      expect((await other.request("/api/admin/usage")).status).toBe(403)
    } finally {
      await byLogin.stop()
    }
  })

  it("refuses the admin page to a streamer who is not listed", async () => {
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    expect((await browser.request("/api/admin/usage")).status).toBe(403)
  })
})

describe("logs", () => {
  it("carry no personal data, codes, state, nonce or tokens", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      spyOn(console, level).mockImplementation(() => {}),
    )
    const { code, id } = await createGiveaway(harness)
    harness.fake.control.failNext("token", 429, 1)
    const first = await viewerSignIn(users.viewer.id, code)
    harness.clock.advance((harness.config.queueCodeMaxAgeSeconds + 1) * 1000)
    await harness.queue.onAlarm()
    harness.rooms.hooks.beforeEnter = () => {
      throw new Error(`boom ${users.viewer2.login} ${users.viewer2.displayName}`)
    }
    const second = await viewerSignIn(users.viewer2.id, code)
    expect(second.response.status).toBe(500)
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
    spies.forEach((spy) => spy.mockRestore())

    expect(logged).toContain(id)
    for (const secret of [
      users.viewer.login,
      users.viewer.displayName,
      users.viewer2.login,
      users.viewer2.displayName,
      first.code,
      first.state,
      first.nonce,
      second.code,
      second.state,
      second.nonce,
      harness.sealKey.slice(5),
    ]) {
      expect(logged).not.toContain(secret)
    }
  })

  it("name the error class and the request id for an unexpected error", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { code } = await createGiveaway(harness)
    harness.rooms.hooks.beforeEnter = () => {
      throw new TypeError("secret detail")
    }

    const { response } = await viewerSignIn(users.viewer.id, code)

    const body: { error: string; requestId: string } = await response.json()
    expect(body.error).toBe("internal")
    expect(error.mock.calls[0]).toEqual([
      "request failed",
      { requestId: body.requestId, errorClass: "TypeError" },
    ])
    error.mockRestore()
  })
})
