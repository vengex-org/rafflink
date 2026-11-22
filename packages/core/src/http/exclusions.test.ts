import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
  entryQuery,
  sqlRows,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"

let harness: Harness

beforeEach(async () => {
  spyOn(console, "info").mockImplementation(() => {})
  harness = await createHarness()
})

afterEach(async () => {
  mock.restore()
  await harness.stop()
})

async function streamer(id: string = users.streamerA.id): Promise<Browser> {
  const browser = new Browser(harness)
  await browser.signInAs(id, "/auth/twitch/streamer/start")
  return browser
}

function post(browser: Browser, path: string, body: unknown, origin = harness.config.publicUrl) {
  return browser.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  })
}

async function viewerEntry(userId: string, code: string): Promise<URLSearchParams> {
  const signIn = await new Browser(harness).signInAs(
    userId,
    `/auth/twitch/viewer/start?giveaway=${code}`,
  )
  return entryQuery(signIn.response)
}

async function drawnGiveaway(winnerId: string) {
  const created = await createGiveaway(harness)
  await viewerEntry(winnerId, created.code)
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, {})
  return created
}

describe("block list", () => {
  it("blocks a login by its account id, so the account is refused with a neutral reason in every giveaway", async () => {
    const browser = await streamer()
    const before = await createGiveaway(harness)

    const response = await post(browser, "/api/dash/blocks", { login: " @Viewer_One " })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      kind: "added",
      block: { platform: "twitch", platformUserId: users.viewer.id, login: "viewer_one" },
    })
    const after = await createGiveaway(harness)
    for (const code of [before.code, after.code]) {
      const query = await viewerEntry(users.viewer.id, code)
      expect([query.get("entry"), query.get("reason")]).toEqual(["not-eligible", "blocked"])
    }
    expect((await viewerEntry(users.viewer2.id, after.code)).get("entry")).toBe("entered")
  })

  it("keeps the block after the account is renamed", async () => {
    const browser = await streamer()
    await post(browser, "/api/dash/blocks", { login: "viewer_one" })
    harness.fake.control.addUser({ ...users.viewer, login: "new_name" })
    const { code } = await createGiveaway(harness)

    expect((await viewerEntry(users.viewer.id, code)).get("reason")).toBe("blocked")
  })

  it("does not block the account in another streamer's giveaways", async () => {
    await post(await streamer(), "/api/dash/blocks", { login: "viewer_one" })
    const { code } = await createGiveaway(harness, users.streamerB.id)

    expect((await viewerEntry(users.viewer.id, code)).get("entry")).toBe("entered")
  })

  it("lists the blocks, removes one and lets the account enter open giveaways again", async () => {
    const browser = await streamer()
    const { code } = await createGiveaway(harness)
    await post(browser, "/api/dash/blocks", { login: "viewer_one" })

    const listed = await (await browser.request("/api/dash/blocks")).json()
    expect(listed).toMatchObject({
      blocks: [{ platformUserId: users.viewer.id, login: "viewer_one" }],
      blockListMax: harness.config.blockListMax,
    })

    const removed = await post(browser, `/api/dash/blocks/${users.viewer.id}/delete`, {})
    expect(await removed.json()).toEqual({ kind: "removed" })
    expect((await viewerEntry(users.viewer.id, code)).get("entry")).toBe("entered")
  })

  it("answers a repeated block with the existing one", async () => {
    const browser = await streamer()
    await post(browser, "/api/dash/blocks", { login: "viewer_one" })

    const repeat = await post(browser, "/api/dash/blocks", { login: "viewer_one" })

    expect(repeat.status).toBe(200)
    expect(await repeat.json()).toMatchObject({ kind: "exists" })
  })

  it("answers 404 for a login without an account and 400 for a missing or blank one", async () => {
    const browser = await streamer()

    expect((await post(browser, "/api/dash/blocks", { login: "nobody_here" })).status).toBe(404)
    expect((await post(browser, "/api/dash/blocks", { login: "not a login!" })).status).toBe(404)
    for (const body of [{}, { login: "  " }, { login: 7 }]) {
      expect(await (await post(browser, "/api/dash/blocks", body)).json()).toEqual({
        error: "invalid-input",
        field: "login",
      })
    }
    expect(sqlRows(harness.accountsDb, "SELECT 1 FROM streamer_blocks")).toEqual([])
  })

  it("answers 503 when Twitch does not answer the lookup, and stores nothing", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const browser = await streamer()
    harness.fake.control.failNext("users", 503, 2)

    const response = await post(browser, "/api/dash/blocks", { login: "viewer_one" })

    expect(await response.json()).toEqual({ error: "platform-unavailable" })
    expect(response.status).toBe(503)
    expect(sqlRows(harness.accountsDb, "SELECT 1 FROM streamer_blocks")).toEqual([])
  })

  it("refuses a block beyond the most allowed", async () => {
    await harness.stop()
    harness = await createHarness({ env: { BLOCK_LIST_MAX: "1" } })
    const browser = await streamer()
    await post(browser, "/api/dash/blocks", { login: "viewer_one" })

    const response = await post(browser, "/api/dash/blocks", { login: "viewer_two" })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "block-list-full" })
  })

  it("answers 503 when an open giveaway's room cannot take the list, and a repeat sends it", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const browser = await streamer()
    const { code } = await createGiveaway(harness)
    harness.rooms.hooks.beforeExclusions = () => {
      throw new Error("room down")
    }

    const failed = await post(browser, "/api/dash/blocks", { login: "viewer_one" })
    expect([failed.status, await failed.json()]).toEqual([503, { error: "room-unavailable" }])

    harness.rooms.hooks.beforeExclusions = () => {}
    expect((await post(browser, "/api/dash/blocks", { login: "viewer_one" })).status).toBe(200)
    expect((await viewerEntry(users.viewer.id, code)).get("reason")).toBe("blocked")
  })

  it("refuses writes from another origin", async () => {
    const browser = await streamer()
    const response = await post(
      browser,
      "/api/dash/blocks",
      { login: "viewer_one" },
      "https://evil.example",
    )
    expect(response.status).toBe(403)
  })

  it("deletes the block list with the streamer account", async () => {
    const browser = await streamer()
    await post(browser, "/api/dash/blocks", { login: "viewer_one" })

    await post(browser, "/api/dash/account/delete", {})

    expect(sqlRows(harness.accountsDb, "SELECT 1 FROM streamer_blocks")).toEqual([])
  })
})

describe("recent winners", () => {
  it("keeps the winner of the streamer's last giveaway out and lets everyone else in", async () => {
    await drawnGiveaway(users.viewer.id)

    const { code } = await createGiveaway(harness, users.streamerA.id, {
      rules: { ...validRules, excludeRecentWinners: { kind: "giveaways", count: 1 } },
    })

    const query = await viewerEntry(users.viewer.id, code)
    expect([query.get("entry"), query.get("reason")]).toEqual(["not-eligible", "recent-winner"])
    expect((await viewerEntry(users.viewer2.id, code)).get("entry")).toBe("entered")
  })

  it("reads only the last N drawn giveaways", async () => {
    await drawnGiveaway(users.viewer.id)
    harness.clock.advance(1000)
    await drawnGiveaway(users.viewer2.id)

    const { code } = await createGiveaway(harness, users.streamerA.id, {
      rules: { ...validRules, excludeRecentWinners: { kind: "giveaways", count: 1 } },
    })

    expect((await viewerEntry(users.viewer.id, code)).get("entry")).toBe("entered")
    expect((await viewerEntry(users.viewer2.id, code)).get("reason")).toBe("recent-winner")
  })

  it("reads only the giveaways created in the last N days", async () => {
    await drawnGiveaway(users.viewer.id)
    harness.clock.advance(3 * 86_400_000)
    await drawnGiveaway(users.viewer2.id)

    const { code } = await createGiveaway(harness, users.streamerA.id, {
      rules: { ...validRules, excludeRecentWinners: { kind: "days", count: 2 } },
    })

    expect((await viewerEntry(users.viewer.id, code)).get("entry")).toBe("entered")
    expect((await viewerEntry(users.viewer2.id, code)).get("reason")).toBe("recent-winner")
  })

  it("lets a rerolled pick in again", async () => {
    const first = await createGiveaway(harness)
    await viewerEntry(users.viewer.id, first.code)
    await viewerEntry(users.viewer2.id, first.code)
    await first.browser.postJson(`/api/dash/giveaways/${first.id}/close`, {})
    await first.browser.postJson(`/api/dash/giveaways/${first.id}/draw`, {})
    await first.browser.postJson(`/api/dash/giveaways/${first.id}/reroll`, { n: 0 })
    const [rerolled, standing] = harness.rooms.roomFor(first.id).picks()
    expect([rerolled?.claim.state, standing?.claim.state]).toEqual(["rerolled", "waiting"])

    const { code } = await createGiveaway(harness, users.streamerA.id, {
      rules: { ...validRules, excludeRecentWinners: { kind: "giveaways", count: 1 } },
    })

    expect((await viewerEntry(rerolled?.platformUserId ?? "", code)).get("entry")).toBe("entered")
    expect((await viewerEntry(standing?.platformUserId ?? "", code)).get("reason")).toBe(
      "recent-winner",
    )
  })

  it("ignores the winners of another streamer and lets them in without the rule", async () => {
    await drawnGiveaway(users.viewer.id)
    const other = await createGiveaway(harness, users.streamerB.id, {
      rules: { ...validRules, excludeRecentWinners: { kind: "giveaways", count: 5 } },
    })
    const plain = await createGiveaway(harness)

    expect((await viewerEntry(users.viewer.id, other.code)).get("entry")).toBe("entered")
    expect((await viewerEntry(users.viewer.id, plain.code)).get("entry")).toBe("entered")
  })

  it("loads the exclusions on the next dashboard call when the room could not take them at creation", async () => {
    spyOn(console, "warn").mockImplementation(() => {})
    const browser = await streamer()
    await post(browser, "/api/dash/blocks", { login: "viewer_one" })
    harness.rooms.hooks.beforeExclusions = () => {
      throw new Error("room down")
    }
    const created = await createGiveaway(harness)
    harness.rooms.hooks.beforeExclusions = () => {}

    expect((await browser.request(`/api/live/${created.id}`)).status).toBe(200)

    expect((await viewerEntry(users.viewer.id, created.code)).get("reason")).toBe("blocked")
  })
})
