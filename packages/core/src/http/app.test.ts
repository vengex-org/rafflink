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

  it("shows the public page with title, prize, rules, status and entrant count", async () => {
    const { code } = await createGiveaway(harness)
    await viewerSignIn(users.viewer.id, code)

    const response = await harness.app.request(`/api/g/${code}`)

    expect(await response.json()).toEqual({
      code,
      title: "Giveaway",
      prize: "Prize",
      rules: validRules,
      status: "open",
      closesAt: null,
      claimSeconds: 300,
      entrantCount: 1,
      poll: { intervalMs: 3000, maxMs: 120_000 },
      win: null,
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

    const { query } = await viewerSignIn(users.viewer.id, code)

    expect(query.get("entry")).toBe("pending")
    const ticket = query.get("ticket") ?? ""
    expect(harness.queue.stats().queued).toBe(1)
    expect(harness.rooms.roomFor(id).summary().entrantCount).toBe(0)
    const waiting = await harness.app.request(`/api/g/${code}/pending/${ticket}`)
    expect(await waiting.json()).toEqual({ kind: "pending", ticket })

    harness.clock.advance((harness.config.queueCooldownSeconds + 1) * 1000)
    await harness.queue.onAlarm()

    const done = await harness.app.request(`/api/g/${code}/pending/${ticket}`)
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

  it("shows the winner that they won and lets them claim once", async () => {
    const { code, id, winnerBrowser } = await drawnGiveaway()

    const page: { win: { n: number; claim: { state: string } } } = await (
      await winnerBrowser.request(`/api/g/${code}`)
    ).json()
    const claimed = await winnerBrowser.request(`/api/g/${code}/claim`, { method: "POST" })
    const again = await winnerBrowser.request(`/api/g/${code}/claim`, { method: "POST" })

    expect(page.win).toMatchObject({ n: 0, claim: { state: "waiting" } })
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

describe("overlay and admin", () => {
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
