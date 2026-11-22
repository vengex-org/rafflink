import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
  users,
  type Harness,
} from "../../test/app-fixture.ts"
import type { PublicHistoryJson } from "./json.ts"

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  mock.restore()
  await harness.stop()
})

const historyPath = `/api/s/twitch/${users.streamerA.login}`

async function drawnGiveaway(overrides: Record<string, unknown> = {}) {
  const created = await createGiveaway(harness, users.streamerA.id, overrides)
  for (const viewerId of [users.viewer.id, users.viewer2.id]) {
    await new Browser(harness).signInAs(
      viewerId,
      `/auth/twitch/viewer/start?giveaway=${created.code}`,
    )
  }
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })
  return created
}

function sameOriginPost(browser: Browser, path: string, body: unknown) {
  return browser.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: harness.config.publicUrl },
    body: JSON.stringify(body),
  })
}

function turnOn(browser: Browser, on = true) {
  return sameOriginPost(browser, "/api/dash/history", { on })
}

async function history(): Promise<Response> {
  return new Browser(harness).request(historyPath)
}

describe("public giveaway history", () => {
  it("shows nothing until the streamer turns it on", async () => {
    await drawnGiveaway()

    expect((await history()).status).toBe(404)
  })

  it("lists the drawn giveaways newest first with the counts their verify pages show, and no entrant's or winner's name", async () => {
    const first = await drawnGiveaway({ title: "First", prize: "Key" })
    const firstClosedAt = harness.clock.now()
    harness.clock.advance(60_000)
    const second = await drawnGiveaway({ title: null, prize: "Mouse" })
    await second.browser.postJson(`/api/dash/giveaways/${second.id}/reroll`, { n: 0 })
    await createGiveaway(harness, users.streamerA.id, { title: "Still open" })
    expect((await turnOn(first.browser)).status).toBe(200)

    const response = await history()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const text = await response.text()
    const body: PublicHistoryJson = JSON.parse(text)
    expect(body).toEqual({
      streamer: {
        platform: "twitch",
        login: users.streamerA.login,
        displayName: users.streamerA.displayName,
      },
      giveaways: [
        {
          code: second.code,
          title: null,
          prize: "Mouse",
          closedAt: firstClosedAt + 60_000,
          entrantCount: 2,
          winners: 1,
        },
        {
          code: first.code,
          title: "First",
          prize: "Key",
          closedAt: firstClosedAt,
          entrantCount: 2,
          winners: 1,
        },
      ],
    })
    for (const viewer of [users.viewer, users.viewer2]) {
      expect(text).not.toContain(viewer.login)
      expect(text).not.toContain(viewer.id)
    }
  })

  it("never lists a giveaway the streamer hid, and marks it hidden on the dashboard", async () => {
    const shown = await drawnGiveaway({ title: "Shown" })
    harness.clock.advance(1000)
    const hidden = await drawnGiveaway({ title: "Hidden" })
    await turnOn(shown.browser)

    const hide = await sameOriginPost(shown.browser, `/api/dash/giveaways/${hidden.id}/history`, {
      hidden: true,
    })
    const listed: PublicHistoryJson = await (await history()).json()
    const dashboard: { giveaways: { id: string; hiddenFromHistory: boolean }[] } = await (
      await shown.browser.request("/api/dash/giveaways")
    ).json()

    expect(hide.status).toBe(200)
    expect(await hide.json()).toEqual({ kind: "saved", hidden: true })
    expect(listed.giveaways.map((giveaway) => giveaway.code)).toEqual([shown.code])
    expect(dashboard.giveaways.map(({ id, hiddenFromHistory }) => [id, hiddenFromHistory])).toEqual(
      [
        [hidden.id, true],
        [shown.id, false],
      ],
    )
  })

  it("lets only the owner hide a giveaway, from the app's own origin, with a boolean", async () => {
    const { id, browser } = await drawnGiveaway()
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")

    const foreign = await browser.request(`/api/dash/giveaways/${id}/history`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ hidden: true }),
    })
    const notOwner = await sameOriginPost(other, `/api/dash/giveaways/${id}/history`, {
      hidden: true,
    })
    const invalid = await sameOriginPost(browser, `/api/dash/giveaways/${id}/history`, {
      hidden: "yes",
    })

    expect([foreign.status, notOwner.status, invalid.status]).toEqual([403, 404, 400])
  })

  it("shows the switch in the session and refuses a value that is no boolean", async () => {
    const { browser } = await drawnGiveaway()
    const sessionOf = async () => {
      const session: { streamer: { publicHistory: boolean } } = await (
        await browser.request("/api/session")
      ).json()
      return session.streamer.publicHistory
    }

    const before = await sessionOf()
    const invalid = await sameOriginPost(browser, "/api/dash/history", { on: 1 })
    const saved = await turnOn(browser)

    expect(before).toBe(false)
    expect(invalid.status).toBe(400)
    expect(await saved.json()).toEqual({ kind: "saved", on: true })
    expect(await sessionOf()).toBe(true)
  })

  it("is gone again after the streamer turns it off, once the cache window is over", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    expect((await history()).status).toBe(200)

    await turnOn(browser, false)
    harness.clock.advance(harness.config.publicHistoryCacheSeconds * 1000)

    expect((await history()).status).toBe(404)
  })

  it("answers a repeated view within the cache window without the account store or a room", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    const first = await (await history()).text()
    const store = spyOn(harness.deps.accounts, "findPublicHistory")
    const rooms = spyOn(harness.rooms, "get")

    const again = await history()

    expect(await again.text()).toBe(first)
    expect(store).not.toHaveBeenCalled()
    expect(rooms).not.toHaveBeenCalled()
  })

  it("finds the streamer by a login in any case, and nobody on an unknown platform or login", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)

    const upper = await new Browser(harness).request(
      `/api/s/twitch/${users.streamerA.login.toUpperCase()}`,
    )
    const platform = await new Browser(harness).request(`/api/s/kick/${users.streamerA.login}`)
    const login = await new Browser(harness).request("/api/s/twitch/not%20a%20login")

    expect(upper.status).toBe(200)
    expect([platform.status, login.status]).toEqual([404, 404])
  })
})

describe("public giveaway history size", () => {
  it("lists only the newest PUBLIC_HISTORY_MAX giveaways, one room read apiece", async () => {
    await harness.stop()
    harness = await createHarness({ env: { PUBLIC_HISTORY_MAX: "1" } })
    await drawnGiveaway({ title: "Old" })
    harness.clock.advance(1000)
    const newest = await drawnGiveaway({ title: "New" })
    await turnOn(newest.browser)
    const rooms = spyOn(harness.rooms, "get")

    const body: PublicHistoryJson = await (await history()).json()

    expect(body.giveaways.map((giveaway) => giveaway.code)).toEqual([newest.code])
    expect(rooms.mock.calls).toEqual([[newest.id]])
  })
})
