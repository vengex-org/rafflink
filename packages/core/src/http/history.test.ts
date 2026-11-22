import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
  sqlRows,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"
import { deleteExpiredGiveaways } from "../room/delete-giveaway.ts"

let harness: Harness

beforeEach(async () => {
  spyOn(console, "info").mockImplementation(() => {})
  harness = await createHarness()
})

afterEach(async () => {
  mock.restore()
  await harness.stop()
})

async function drawnGiveaway(overrides: Record<string, unknown> = {}) {
  const created = await createGiveaway(harness, users.streamerA.id, overrides)
  const viewer = new Browser(harness)
  await viewer.signInAs(users.viewer.id, `/auth/twitch/viewer/start?giveaway=${created.code}`)
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })
  return { ...created, viewer }
}

function sameOriginPost(browser: Browser, path: string, origin = harness.config.publicUrl) {
  return browser.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}",
  })
}

function giveawayRows(id: string) {
  return sqlRows(harness.accountsDb, "SELECT id FROM giveaways WHERE id = ?", [id])
}

describe("winners CSV", () => {
  it("lists every pick with the prize, the draw date and the claim state, and keeps the names after the entries' retention", async () => {
    const { id, viewer, code } = await drawnGiveaway()
    const drawnAt = new Date(harness.clock.now()).toISOString()
    await viewer.request(`/api/g/${code}/claim`, { method: "POST" })
    harness.clock.advance(harness.config.entryRetentionSeconds * 1000)
    harness.rooms.roomFor(id).onAlarm()
    // The first session has expired by now.
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    const response = await browser.request(`/api/dash/giveaways/${id}/winners.csv`)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="rafflink-${code}-winners.csv"`,
    )
    expect((await response.text()).split("\r\n")).toEqual([
      '"pick","login","display_name","prize","drawn_at","claim","claimed_at"',
      `"1","viewer_one","Display_viewer_one","Prize","${drawnAt}","claimed","${drawnAt}"`,
      "",
    ])
  })

  it("keeps a spreadsheet from running a prize that starts like a formula", async () => {
    const { browser, id } = await drawnGiveaway({ prize: '=HYPERLINK("x")' })

    const text = await (await browser.request(`/api/dash/giveaways/${id}/winners.csv`)).text()

    expect(text).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it("answers 404 for another streamer's giveaway", async () => {
    const { id } = await drawnGiveaway()
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    expect((await other.request(`/api/dash/giveaways/${id}/winners.csv`)).status).toBe(404)
  })
})

describe("deleting a giveaway", () => {
  it("deletes the row and the room, so its code and pages are gone", async () => {
    const { browser, id, code } = await drawnGiveaway()

    const response = await sameOriginPost(browser, `/api/dash/giveaways/${id}/delete`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: "deleted" })
    expect(giveawayRows(id)).toEqual([])
    expect(harness.rooms.deleted).toEqual([id])
    expect((await new Browser(harness).request(`/api/g/${code}`)).status).toBe(404)
    const list: { giveaways: unknown[] } = await (
      await browser.request("/api/dash/giveaways")
    ).json()
    expect(list.giveaways).toEqual([])
  })

  it("refuses a delete from another origin and another streamer's delete, and keeps the giveaway", async () => {
    const { browser, id } = await drawnGiveaway()
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const foreign = await sameOriginPost(
      browser,
      `/api/dash/giveaways/${id}/delete`,
      "https://evil.example",
    )
    const notOwner = await sameOriginPost(other, `/api/dash/giveaways/${id}/delete`)

    expect([foreign.status, notOwner.status]).toEqual([403, 404])
    expect(giveawayRows(id)).toHaveLength(1)
    expect(harness.rooms.deleted).toEqual([])
  })

  it("keeps the row when the room could not be deleted, so the streamer can try again", async () => {
    const { browser, id } = await drawnGiveaway()
    spyOn(harness.rooms, "delete").mockRejectedValueOnce(new Error("room down"))
    spyOn(console, "error").mockImplementation(() => {})

    const response = await sameOriginPost(browser, `/api/dash/giveaways/${id}/delete`)

    expect(response.status).toBe(500)
    expect(giveawayRows(id)).toHaveLength(1)
  })
})

describe("deleting a streamer's data", () => {
  it("deletes every giveaway with its room, the token and the account, and ends the session", async () => {
    const first = await drawnGiveaway()
    const second = await first.browser.postJson("/api/dash/giveaways", {
      title: "Second",
      prize: null,
      rules: validRules,
    })
    const secondId: string = (await second.json()).giveaway.id
    const kept = await createGiveaway(harness, users.streamerB.id)

    const response = await sameOriginPost(first.browser, "/api/dash/account/delete")

    expect(response.status).toBe(200)
    expect(harness.rooms.deleted.toSorted()).toEqual([first.id, secondId].toSorted())
    expect(sqlRows(harness.accountsDb, "SELECT id FROM giveaways").map((row) => row.id)).toEqual([
      kept.id,
    ])
    expect(
      sqlRows(harness.accountsDb, "SELECT platform_user_id FROM streamers").map(
        (row) => row.platform_user_id,
      ),
    ).toEqual([users.streamerB.id])
    expect(sqlRows(harness.accountsDb, "SELECT streamer_id FROM streamer_tokens")).toHaveLength(1)
    const session: { streamer: unknown } = await (
      await first.browser.request("/api/session")
    ).json()
    expect(session.streamer).toBeNull()
  })
})

function removeName(browser: Browser, code: string, n: number) {
  return sameOriginPost(browser, `/api/admin/giveaways/${code}/winners/${n}/remove-name`)
}

describe("removing a winner's name", () => {
  it("lets an admin replace one winner's name with removed", async () => {
    const { browser, id, code } = await drawnGiveaway()

    const response = await removeName(browser, code, 0)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: "removed" })
    expect(harness.rooms.roomFor(id).picks()).toMatchObject([
      { login: "removed", displayName: "removed" },
    ])
  })

  it("answers 404 for a pick or a giveaway that does not exist, and 403 to a streamer who is no admin", async () => {
    const { code } = await drawnGiveaway()
    const streamer = new Browser(harness)
    await streamer.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")
    const admin = new Browser(harness)
    await admin.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    expect((await removeName(admin, code, 3)).status).toBe(404)
    expect((await removeName(admin, "ZZZZZ", 0)).status).toBe(404)
    expect((await removeName(streamer, code, 0)).status).toBe(403)
  })
})

describe("history retention", () => {
  const dayMs = 86_400_000

  it("deletes drawn giveaways that closed more than the given days ago, and keeps open, undrawn and recent ones", async () => {
    const old = await drawnGiveaway()
    const undrawn = await createGiveaway(harness, users.streamerB.id)
    await undrawn.browser.postJson(`/api/dash/giveaways/${undrawn.id}/close`, {})
    const stillOpen = await createGiveaway(harness, users.streamerB.id)
    harness.clock.advance(2 * dayMs + 1)
    const recent = await drawnGiveaway()

    expect(await deleteExpiredGiveaways(harness.deps, 2)).toBe(1)

    expect(giveawayRows(old.id)).toEqual([])
    expect([undrawn.id, stillOpen.id, recent.id].map(giveawayRows)).toEqual([
      [{ id: undrawn.id }],
      [{ id: stillOpen.id }],
      [{ id: recent.id }],
    ])
    expect(harness.rooms.deleted).toEqual([old.id])
  })

  it("counts the days from the close, not from the creation", async () => {
    const created = await createGiveaway(harness)
    harness.clock.advance(3 * dayMs)
    const viewer = new Browser(harness)
    await viewer.signInAs(users.viewer.id, `/auth/twitch/viewer/start?giveaway=${created.code}`)
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })
    harness.clock.advance(dayMs)

    expect(await deleteExpiredGiveaways(harness.deps, 2)).toBe(0)
    harness.clock.advance(dayMs + 1)
    expect(await deleteExpiredGiveaways(harness.deps, 2)).toBe(1)
  })

  it("goes on with the next giveaway when one room fails", async () => {
    const failing = await drawnGiveaway()
    const other = await drawnGiveaway()
    harness.clock.advance(dayMs + 1)
    const realDelete = harness.rooms.delete.bind(harness.rooms)
    spyOn(harness.rooms, "delete").mockImplementation(async (id) => {
      if (id === failing.id) throw new Error("room down")
      return realDelete(id)
    })
    const warn = spyOn(console, "warn").mockImplementation(() => {})

    expect(await deleteExpiredGiveaways(harness.deps, 1)).toBe(1)

    expect(giveawayRows(failing.id)).toHaveLength(1)
    expect(giveawayRows(other.id)).toEqual([])
    expect(warn).toHaveBeenCalledWith("history retention failed for a giveaway", {
      giveawayId: failing.id,
      errorClass: "Error",
    })
  })
})
