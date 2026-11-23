import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
  sqlRows,
  testAddressHeader,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"
import { moderatorActor } from "../domain/actor.ts"
import type { ActionActors } from "../room/giveaway-room.ts"
import { moderatorLinkHeader } from "./moderator-routes.ts"

let harness: Harness

beforeEach(async () => {
  spyOn(console, "info").mockImplementation(() => {})
  harness = await createHarness()
})

afterEach(async () => {
  mock.restore()
  await harness.stop()
})

function sameOriginPost(browser: Browser, path: string, body: unknown = {}) {
  return browser.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: harness.config.publicUrl },
    body: JSON.stringify(body),
  })
}

interface CreatedLink {
  readonly link: { readonly id: string; readonly requireMod: boolean; readonly createdAt: number }
  readonly token: string
}

async function giveawayWithLink(requireMod = false) {
  const created = await createGiveaway(harness)
  const response = await sameOriginPost(
    created.browser,
    `/api/dash/giveaways/${created.id}/moderator-links`,
    { requireMod },
  )
  expect(response.status).toBe(201)
  const body: CreatedLink = await response.json()
  return { ...created, ...body }
}

async function openLink(token: unknown, browser = new Browser(harness)) {
  const response = await sameOriginPost(browser, "/api/moderator-links/open", { token })
  return { browser, response }
}

async function enter(code: string, userId: string) {
  await new Browser(harness).signInAs(userId, `/auth/twitch/viewer/start?giveaway=${code}`)
}

function actorsOf(id: string): ActionActors {
  return harness.rooms.roomFor(id).liveSnapshot().actors
}

describe("moderator links of the streamer", () => {
  it("makes a link whose token is shown once and lists it without the token", async () => {
    const { browser, id, link, token } = await giveawayWithLink(true)

    expect(token).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{32}$/)
    expect(token.startsWith(`${link.id}.`)).toBe(true)
    const listed = await browser.request(`/api/dash/giveaways/${id}/moderator-links`)
    expect(await listed.json()).toEqual({
      links: [{ id: link.id, requireMod: true, createdAt: harness.clock.now() }],
    })
    const stored = sqlRows(harness.accountsDb, "SELECT token_hash FROM moderator_links")
    expect(JSON.stringify(stored)).not.toContain(token.slice(33))
  })

  it("answers 404 for another streamer's giveaway and 401 without a session", async () => {
    const { id } = await giveawayWithLink()
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const foreign = await sameOriginPost(other, `/api/dash/giveaways/${id}/moderator-links`, {
      requireMod: false,
    })
    expect(foreign.status).toBe(404)
    expect((await other.request(`/api/dash/giveaways/${id}/moderator-links`)).status).toBe(404)
    const anonymous = await sameOriginPost(
      new Browser(harness),
      `/api/dash/giveaways/${id}/moderator-links`,
      { requireMod: false },
    )
    expect(anonymous.status).toBe(401)
  })

  it("refuses a link made from another origin or without a yes-or-no require-mod choice", async () => {
    const { browser, id } = await createGiveaway(harness)

    const crossSite = await browser.request(`/api/dash/giveaways/${id}/moderator-links`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ requireMod: false }),
    })
    expect(crossSite.status).toBe(403)
    for (const body of [{}, { requireMod: "yes" }, { requireMod: null }]) {
      const response = await sameOriginPost(
        browser,
        `/api/dash/giveaways/${id}/moderator-links`,
        body,
      )
      expect(response.status).toBe(400)
    }
  })

  it("refuses a mods-only link where the platform does not tell who moderates the channel", async () => {
    await harness.stop()
    harness = await createHarness({ capabilities: { moderatorRole: false } })
    // A moderator ticket count is refused where the platform cannot tell moderators.
    const tickets = { ...validRules.tickets, moderator: 0 }
    const { browser, id } = await createGiveaway(harness, undefined, {
      rules: { ...validRules, tickets },
    })
    const path = `/api/dash/giveaways/${id}/moderator-links`

    const modsOnly = await sameOriginPost(browser, path, { requireMod: true })
    const anyone = await sameOriginPost(browser, path, { requireMod: false })

    expect(modsOnly.status).toBe(400)
    expect(await modsOnly.json()).toEqual({ error: "invalid-input", field: "requireMod" })
    expect(anyone.status).toBe(201)
  })
})

describe("a moderator link", () => {
  it("closes entries, draws, rerolls and marks a claim, and the room names the link as the actor", async () => {
    const { id, code, link, token } = await giveawayWithLink()
    await enter(code, users.viewer.id)
    await enter(code, users.viewer2.id)
    const { browser, response } = await openLink(token)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ giveawayId: id })

    expect((await sameOriginPost(browser, `/api/mod/${id}/close`)).status).toBe(200)
    expect((await sameOriginPost(browser, `/api/mod/${id}/draw`, { count: 1 })).status).toBe(200)
    expect((await sameOriginPost(browser, `/api/mod/${id}/reroll`, { n: 0 })).status).toBe(200)
    expect((await sameOriginPost(browser, `/api/mod/${id}/claim`, { n: 1 })).status).toBe(200)

    const actor = moderatorActor(link.id)
    expect(actorsOf(id)).toEqual({
      closedBy: actor,
      picks: [
        { n: 0, drawnBy: actor, rerolledBy: actor, claimMarkedBy: null },
        { n: 1, drawnBy: actor, rerolledBy: null, claimMarkedBy: actor },
      ],
    })
  })

  it("draws a batch of winners in one press, all named after the link, and refuses a count it may not draw", async () => {
    const { id, code, link, token } = await giveawayWithLink()
    for (const user of [users.viewer, users.viewer2, users.viewer3]) await enter(code, user.id)
    const { browser } = await openLink(token)
    await sameOriginPost(browser, `/api/mod/${id}/close`)

    const tooMany = await sameOriginPost(browser, `/api/mod/${id}/draw`, {
      count: harness.config.drawMaxWinners + 1,
    })
    const missing = await sameOriginPost(browser, `/api/mod/${id}/draw`, {})
    const batch = await sameOriginPost(browser, `/api/mod/${id}/draw`, { count: 2 })

    expect(tooMany.status).toBe(400)
    expect(missing.status).toBe(400)
    expect(await batch.json()).toEqual({ kind: "drawn", picks: [0, 1] })
    const actor = moderatorActor(link.id)
    expect(actorsOf(id).picks).toEqual([
      { n: 0, drawnBy: actor, rerolledBy: null, claimMarkedBy: null },
      { n: 1, drawnBy: actor, rerolledBy: null, claimMarkedBy: null },
    ])
  })

  it("records the streamer as the actor of the streamer's own buttons", async () => {
    const { browser, id, code } = await createGiveaway(harness)
    await enter(code, users.viewer.id)

    await browser.postJson(`/api/dash/giveaways/${id}/close`, {})
    await browser.postJson(`/api/dash/giveaways/${id}/draw`, { count: 1 })

    expect(actorsOf(id)).toEqual({
      closedBy: "streamer",
      picks: [{ n: 0, drawnBy: "streamer", rerolledBy: null, claimMarkedBy: null }],
    })
  })

  it("loads the live snapshot and the entrants without the overlay token", async () => {
    const { id, code, link, token } = await giveawayWithLink()
    await enter(code, users.viewer.id)
    const { browser } = await openLink(token)

    const live = await browser.request(`/api/mod/${id}`)
    expect(live.status).toBe(200)
    expect(live.headers.get(moderatorLinkHeader)).toBe(link.id)
    const snapshot: Record<string, unknown> = await live.json()
    expect(snapshot.code).toBe(code)
    expect(Object.hasOwn(snapshot, "overlayToken")).toBe(false)
    const entrants = await browser.request(`/api/mod/${id}/entrants`)
    expect(await entrants.json()).toMatchObject({ rows: [{ login: users.viewer.login }] })
  })

  it("cannot delete the giveaway, change its winner count, read the streamer's pages or delete the account", async () => {
    const { id, token } = await giveawayWithLink()
    const { browser } = await openLink(token)

    expect((await sameOriginPost(browser, `/api/dash/giveaways/${id}/delete`)).status).toBe(401)
    expect(
      (await sameOriginPost(browser, `/api/dash/giveaways/${id}/winners`, { count: 3 })).status,
    ).toBe(401)
    expect((await sameOriginPost(browser, `/api/mod/${id}/winners`, { count: 3 })).status).toBe(404)
    expect((await sameOriginPost(browser, `/api/mod/${id}/delete`)).status).toBe(404)
    expect((await sameOriginPost(browser, "/api/dash/account/delete")).status).toBe(401)
    expect((await browser.request(`/api/live/${id}`)).status).toBe(401)
    expect((await browser.request(`/api/dash/giveaways/${id}/winners.csv`)).status).toBe(401)
    expect((await browser.request(`/api/dash/giveaways/${id}/moderator-links`)).status).toBe(401)
    expect(await (await browser.request("/api/session")).json()).toMatchObject({ streamer: null })
    expect(sqlRows(harness.accountsDb, "SELECT id FROM giveaways WHERE id = ?", [id])).toHaveLength(
      1,
    )
    expect(harness.rooms.roomFor(id).liveSnapshot().winnerCount).toBe(1)
  })

  it("acts on its own giveaway only", async () => {
    const { token } = await giveawayWithLink()
    const other = await createGiveaway(harness)
    const { browser } = await openLink(token)

    expect((await browser.request(`/api/mod/${other.id}`)).status).toBe(403)
    expect((await sameOriginPost(browser, `/api/mod/${other.id}/close`)).status).toBe(403)
  })

  it("refuses an action from another origin or without one", async () => {
    const { id, token } = await giveawayWithLink()
    const { browser } = await openLink(token)

    const crossSite = await browser.request(`/api/mod/${id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    })
    const noOrigin = await browser.postJson(`/api/mod/${id}/close`, {})

    expect(crossSite.status).toBe(403)
    expect(noOrigin.status).toBe(403)
    expect(harness.rooms.roomFor(id).summary().status).toBe("open")
  })

  it("refuses a socket upgrade from another origin and names the link for one from the site", async () => {
    const { id, link, token } = await giveawayWithLink()
    const { browser } = await openLink(token)
    const upgrade = { upgrade: "websocket", connection: "Upgrade" }

    const foreign = await browser.request(`/api/mod/${id}`, {
      headers: { ...upgrade, origin: "https://evil.example" },
    })
    const own = await browser.request(`/api/mod/${id}`, {
      headers: { ...upgrade, origin: harness.config.publicUrl },
    })

    expect(foreign.status).toBe(403)
    expect(own.status).toBe(200)
    expect(own.headers.get(moderatorLinkHeader)).toBe(link.id)
  })

  it("refuses a wrong secret, a malformed token and an open from another origin", async () => {
    const { link, token } = await giveawayWithLink()

    for (const bad of [`${link.id}.${"0".repeat(32)}`, token.toUpperCase(), "", 42, null]) {
      expect((await openLink(bad)).response.status).toBe(403)
    }
    const crossSite = await new Browser(harness).request("/api/moderator-links/open", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ token }),
    })
    expect(crossSite.status).toBe(403)
  })

  it("limits how many links one address opens per minute", async () => {
    await harness.stop()
    harness = await createHarness({ env: { MODERATOR_IP_LIMIT_PER_MINUTE: "1" } })
    const { token } = await giveawayWithLink()
    const fromAddress = (browser: Browser) =>
      browser.request("/api/moderator-links/open", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: harness.config.publicUrl,
          [testAddressHeader]: "203.0.113.7",
        },
        body: JSON.stringify({ token }),
      })

    expect((await fromAddress(new Browser(harness))).status).toBe(200)
    expect((await fromAddress(new Browser(harness))).status).toBe(429)
  })
})

describe("a revoked moderator link", () => {
  it("answers 403 to its open cookie and to a new open, and closes its live sockets", async () => {
    const { browser: streamer, id, link, token } = await giveawayWithLink()
    const { browser } = await openLink(token)

    const revoke = await sameOriginPost(
      streamer,
      `/api/dash/giveaways/${id}/moderator-links/${link.id}/revoke`,
    )

    expect(revoke.status).toBe(200)
    expect(harness.rooms.closedModeratorSockets).toEqual([{ giveawayId: id, linkId: link.id }])
    expect((await browser.request(`/api/mod/${id}`)).status).toBe(403)
    expect((await sameOriginPost(browser, `/api/mod/${id}/close`)).status).toBe(403)
    expect((await openLink(token)).response.status).toBe(403)
    expect(harness.rooms.roomFor(id).summary().status).toBe("open")
    const listed = await streamer.request(`/api/dash/giveaways/${id}/moderator-links`)
    expect(await listed.json()).toEqual({ links: [] })
  })

  it("stays revoked when the room cannot close its sockets, and a repeat closes them", async () => {
    const { browser: streamer, id, link, token } = await giveawayWithLink()
    spyOn(console, "warn").mockImplementation(() => {})
    spyOn(harness.rooms, "closeModeratorSockets").mockRejectedValueOnce(new Error("room down"))
    const path = `/api/dash/giveaways/${id}/moderator-links/${link.id}/revoke`

    expect((await sameOriginPost(streamer, path)).status).toBe(503)
    expect((await openLink(token)).response.status).toBe(403)
    expect((await sameOriginPost(streamer, path)).status).toBe(200)
  })

  it("can be revoked by its own streamer only", async () => {
    const { id, link, token } = await giveawayWithLink()
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const revoke = await sameOriginPost(
      other,
      `/api/dash/giveaways/${id}/moderator-links/${link.id}/revoke`,
    )

    expect(revoke.status).toBe(404)
    expect((await openLink(token)).response.status).toBe(200)
  })
})

/** Opens a link that requires a moderator while signed out, then runs the moderator's Twitch sign-in as `userId`. */
async function signInThroughLink(token: string, userId: string) {
  const { browser, response } = await openLink(token)
  expect(response.status).toBe(401)
  const signIn = await browser.signInAs(userId, "/auth/twitch/moderator/start")
  return { browser, ...signIn, location: signIn.response.headers.get("location") }
}

describe("a moderator link that requires a moderator", () => {
  it("answers a signed-out opener with sign-in-required and a pending cookie that holds no secret", async () => {
    const { link, token } = await giveawayWithLink(true)

    const { browser, response } = await openLink(token)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "sign-in-required" })
    expect(browser.cookieNames()).toEqual(["rl_mod_pending"])
    const pending = decodeURIComponent(browser.cookie("rl_mod_pending") ?? "")
    expect(pending).toContain(link.id)
    expect(pending).not.toContain(token.slice(33))
  })

  it("signs a moderator in with openid only on the viewer callback, without an account row or a token", async () => {
    const { id, token } = await giveawayWithLink(true)
    harness.fake.control.setRole(users.streamerA.id, users.viewer.id, "moderator", true)
    const streamersBefore = sqlRows(harness.accountsDb, "SELECT id FROM streamers")

    const { browser, location } = await signInThroughLink(token, users.viewer.id)

    expect(location).toBe(`/mod/${id}`)
    expect((await browser.request(`/api/mod/${id}`)).status).toBe(200)
    expect(sqlRows(harness.accountsDb, "SELECT id FROM streamers")).toEqual(streamersBefore)
    expect(sqlRows(harness.accountsDb, "SELECT streamer_id FROM streamer_tokens")).toHaveLength(1)
    const authorize = harness.fake.control.calls.findLast(
      (call) => call.path === "/oauth2/authorize",
    )
    expect(authorize?.query.scope).toBe("openid")
    expect(authorize?.query.redirect_uri).toBe(`${harness.config.publicUrl}/auth/twitch/viewer`)
    expect(browser.cookieNames().filter((name) => name.startsWith("rl_mod_pending"))).toEqual([])
  })

  it("sends a signed-in account that does not moderate the channel back with not-a-moderator", async () => {
    const { id, token } = await giveawayWithLink(true)

    const { browser, location } = await signInThroughLink(token, users.viewer.id)

    expect(location).toBe("/mod?moderator=not-a-moderator")
    expect((await browser.request(`/api/mod/${id}`)).status).toBe(403)
  })

  it("refuses a link revoked while its opener signed in, and a start without a pending link", async () => {
    const { browser: streamer, id, link, token } = await giveawayWithLink(true)
    harness.fake.control.setRole(users.streamerA.id, users.viewer.id, "moderator", true)
    const { browser } = await openLink(token)
    await sameOriginPost(streamer, `/api/dash/giveaways/${id}/moderator-links/${link.id}/revoke`)

    const signIn = await browser.signInAs(users.viewer.id, "/auth/twitch/moderator/start")
    const again = await browser.request("/auth/twitch/moderator/start")

    expect(signIn.response.headers.get("location")).toBe("/mod?moderator=link-invalid")
    expect(again.headers.get("location")).toBe("/mod?moderator=invalid-state")
  })

  it("admits the broadcaster and a viewer session of a moderator without a new sign-in", async () => {
    const { browser: streamer, code, token } = await giveawayWithLink(true)
    harness.fake.control.setRole(users.streamerA.id, users.viewer.id, "moderator", true)
    const viewer = new Browser(harness)
    await viewer.signInAs(users.viewer.id, `/auth/twitch/viewer/start?giveaway=${code}`)

    expect((await openLink(token, streamer)).response.status).toBe(200)
    expect((await openLink(token, viewer)).response.status).toBe(200)
  })

  it("answers 503 when the channel's moderators cannot be read", async () => {
    const { token } = await giveawayWithLink(true)
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")
    spyOn(console, "warn").mockImplementation(() => {})
    harness.fake.control.failNext("moderators", 503, 2)

    const { response } = await openLink(token, other)

    expect(response.status).toBe(503)
  })

  it("checks a moderator again on a button press once the last yes is older than the recheck time", async () => {
    const { id, token } = await giveawayWithLink(true)
    harness.fake.control.setRole(users.streamerA.id, users.viewer.id, "moderator", true)
    const { browser } = await signInThroughLink(token, users.viewer.id)
    const checks = () =>
      harness.fake.control.calls.filter((call) => call.path === "/helix/moderation/moderators")
        .length

    expect((await sameOriginPost(browser, `/api/mod/${id}/close`)).status).toBe(200)
    const afterFirst = checks()
    harness.fake.control.setRole(users.streamerA.id, users.viewer.id, "moderator", false)
    expect((await sameOriginPost(browser, `/api/mod/${id}/draw`, { count: 1 })).status).not.toBe(
      403,
    )
    expect(checks()).toBe(afterFirst)

    harness.clock.advance(harness.config.moderatorRecheckSeconds * 1000)
    const demoted = await sameOriginPost(browser, `/api/mod/${id}/draw`, { count: 1 })
    expect(demoted.status).toBe(403)
    expect(await demoted.json()).toEqual({ error: "not-a-moderator" })
  })

  it("answers 503 to a button press when the recheck cannot reach the platform", async () => {
    const { id, token } = await giveawayWithLink(true)
    harness.fake.control.setRole(users.streamerA.id, users.viewer.id, "moderator", true)
    const { browser } = await signInThroughLink(token, users.viewer.id)
    spyOn(console, "warn").mockImplementation(() => {})
    harness.fake.control.failNext("moderators", 503, 2)

    const response = await sameOriginPost(browser, `/api/mod/${id}/close`)

    expect(response.status).toBe(503)
    expect(harness.rooms.roomFor(id).summary().status).toBe("open")
  })
})
