import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  fullStreamerStart,
  createGiveaway,
  createHarness,
  users,
  type Harness,
} from "../../test/app-fixture.ts"
import { inlineScriptSource, spaTemplate } from "../../test/contract/spa-fixture.ts"
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

function allowIndexing(browser: Browser) {
  return sameOriginPost(browser, "/api/dash/history/indexing", { on: true })
}

async function historyIndexed(): Promise<boolean> {
  const body: PublicHistoryJson = await (await history()).json()
  return body.streamer.indexed
}

// The streamer renames their Twitch account and signs in again.
async function rename(login: string) {
  harness.fake.control.addUser({ ...users.streamerA, login })
  await new Browser(harness).signInAs(users.streamerA.id, fullStreamerStart)
}

function page(path: string) {
  return new Browser(harness).request(path)
}

// The page the server names in the history data, and the data.
function embeddedHistory(html: string): { path: string; data: unknown } {
  const [, path, json] =
    /<script type="application\/json" id="history-data" data-path="([^"]*)">([^<]*)<\/script>/.exec(
      html,
    ) ?? []
  if (path === undefined || json === undefined) throw new Error("the page carries no history data")
  return { path, data: JSON.parse(json) }
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
        indexed: false,
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
    await other.signInAs(users.streamerB.id, fullStreamerStart)

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

  it("drops the cached answer when the streamer turns the page off, hides or deletes a giveaway", async () => {
    const first = await drawnGiveaway({ title: "First" })
    harness.clock.advance(1000)
    const second = await drawnGiveaway({ title: "Second" })
    harness.clock.advance(1000)
    const third = await drawnGiveaway({ title: "Third" })
    await turnOn(first.browser)
    const codes = async () => {
      const body: PublicHistoryJson = await (await history()).json()
      return body.giveaways.map((giveaway) => giveaway.code)
    }
    const before = await codes()

    await sameOriginPost(first.browser, `/api/dash/giveaways/${third.id}/history`, {
      hidden: true,
    })
    const afterHide = await codes()
    await sameOriginPost(first.browser, `/api/dash/giveaways/${second.id}/delete`, {})
    const afterDelete = await codes()
    await turnOn(first.browser, false)

    expect(before).toEqual([third.code, second.code, first.code])
    expect(afterHide).toEqual([second.code, first.code])
    expect(afterDelete).toEqual([first.code])
    expect((await history()).status).toBe(404)
  })

  it("reads no room for an answer, and neither D1 nor a room for a repeated view within the cache window", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    const rooms = spyOn(harness.rooms, "get")
    const first = await (await history()).text()
    const store = spyOn(harness.deps.accounts, "findPublicHistory")

    const again = await history()

    expect(await again.text()).toBe(first)
    expect(store).not.toHaveBeenCalled()
    expect(rooms).not.toHaveBeenCalled()
  })

  it("lists by close time, latest first, whenever the giveaways were created", async () => {
    const early = await createGiveaway(harness, users.streamerA.id, { title: "Created first" })
    harness.clock.advance(1000)
    const late = await drawnGiveaway({ title: "Created second" })
    harness.clock.advance(1000)
    await new Browser(harness).signInAs(
      users.viewer.id,
      `/auth/twitch/viewer/start?giveaway=${early.code}`,
    )
    await early.browser.postJson(`/api/dash/giveaways/${early.id}/close`, {})
    await early.browser.postJson(`/api/dash/giveaways/${early.id}/draw`, { count: 1 })
    await turnOn(late.browser)

    const body: PublicHistoryJson = await (await history()).json()

    expect(body.giveaways.map((giveaway) => giveaway.code)).toEqual([early.code, late.code])
  })

  it("counts winners drawn later in a drawn giveaway, and keeps the count across a reroll", async () => {
    const created = await createGiveaway(harness, users.streamerA.id)
    for (const viewer of [users.viewer, users.viewer2, users.viewer3]) {
      await new Browser(harness).signInAs(
        viewer.id,
        `/auth/twitch/viewer/start?giveaway=${created.code}`,
      )
    }
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })
    await created.browser.postJson(`/api/dash/giveaways/${created.id}/reroll`, { n: 0 })
    await turnOn(created.browser)

    const body: PublicHistoryJson = await (await history()).json()

    expect(body.giveaways).toMatchObject([{ entrantCount: 3, winners: 2 }])
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

describe("public history indexing", () => {
  it("shows the indexing switch in the session and the history, and refuses a value that is no boolean", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    const sessionOf = async () => {
      const session: { streamer: { historyIndexed: boolean } } = await (
        await browser.request("/api/session")
      ).json()
      return session.streamer.historyIndexed
    }

    const before = [await sessionOf(), await historyIndexed()]
    const invalid = await sameOriginPost(browser, "/api/dash/history/indexing", { on: "yes" })
    const saved = await allowIndexing(browser)

    expect(before).toEqual([false, false])
    expect(invalid.status).toBe(400)
    expect(await saved.json()).toEqual({ kind: "saved", on: true })
    expect([await sessionOf(), await historyIndexed()]).toEqual([true, true])
  })

  it("takes the switch only from the app's own origin", async () => {
    const { browser } = await drawnGiveaway()

    const foreign = await browser.request("/api/dash/history/indexing", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ on: true }),
    })

    expect(foreign.status).toBe(403)
  })
})

describe("public history after a rename", () => {
  it("redirects the old login's API answer to the new login, and the new login answers the history", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    await rename("streamer_new")

    const old = await history()
    const current: PublicHistoryJson = await (
      await new Browser(harness).request("/api/s/twitch/streamer_new")
    ).json()

    expect(old.status).toBe(308)
    expect(old.headers.get("location")).toBe("/api/s/twitch/streamer_new")
    expect(current.streamer.login).toBe("streamer_new")
  })

  it("drops the cached answer of the old login at the sign-in that sees the rename", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    const cached = await history()

    await rename("streamer_new")

    expect(cached.status).toBe(200)
    expect((await history()).status).toBe(308)
  })

  it("drops no cached answer at a sign-in that keeps the login", async () => {
    await rename("streamer_new")
    const deleted = spyOn(harness.deps.publicCache, "delete")

    await rename("streamer_new")

    expect(deleted).not.toHaveBeenCalled()
  })
})

describe("public history page", () => {
  beforeEach(async () => {
    await harness.stop()
    harness = await createHarness({ spaTemplate })
  })

  it("previews the streamer's history with its canonical URL, carries the API answer and stays noindex until the streamer allows indexing", async () => {
    const { browser } = await drawnGiveaway({ title: "</script><script>alert(1)</script>" })
    await turnOn(browser)
    const api = await (await history()).json()

    const hidden = await page(`/s/twitch/${users.streamerA.login.toUpperCase()}`)
    const html = await hidden.text()
    await allowIndexing(browser)
    const indexed = await page(`/s/twitch/${users.streamerA.login}`)

    expect(hidden.status).toBe(200)
    expect(hidden.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(hidden.headers.get("content-security-policy")).toContain(inlineScriptSource)
    expect(html).toContain(`<title>Giveaways of ${users.streamerA.displayName}</title>`)
    expect(html).toContain(
      `<link rel="canonical" href="http://localhost/s/twitch/${users.streamerA.login}" />`,
    )
    expect(html).toContain(
      `<meta property="og:url" content="http://localhost/s/twitch/${users.streamerA.login}" />`,
    )
    expect(html).not.toContain("</script><script>alert")
    expect(embeddedHistory(html)).toEqual({ path: `/s/twitch/${users.streamerA.login}`, data: api })
    expect(indexed.status).toBe(200)
    expect(indexed.headers.get("x-robots-tag")).toBeNull()
  })

  it("answers 404 with the plain page and no history for a streamer without the page", async () => {
    await drawnGiveaway()

    const response = await page(`/s/twitch/${users.streamerA.login}`)
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(html).toContain("<title>Rafflink home</title>")
    expect(embeddedHistory(html)).toEqual({
      path: `/s/twitch/${users.streamerA.login}`,
      data: null,
    })
  })

  it("answers 404 for an unknown platform or a login the platform does not allow", async () => {
    for (const path of [`/s/kick/${users.streamerA.login}`, "/s/twitch/not%20a%20login"]) {
      expect((await page(path)).status).toBe(404)
    }
  })

  it("redirects the login a streamer gave up to their page, keeping the query", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    await rename("streamer_new")

    const response = await page(`/s/twitch/${users.streamerA.login}?ref=panel`)

    expect(response.status).toBe(301)
    expect(response.headers.get("location")).toBe("/s/twitch/streamer_new?ref=panel")
    expect(response.headers.get("cache-control")).toBe("no-cache")
  })

  it("reads D1 once for a page and its repeated view within the cache window", async () => {
    const { browser } = await drawnGiveaway()
    await turnOn(browser)
    const store = spyOn(harness.deps.accounts, "findPublicHistory")

    await page(`/s/twitch/${users.streamerA.login}`)
    await page(`/s/twitch/${users.streamerA.login}`)
    await history()

    expect(store).toHaveBeenCalledTimes(1)
  })
})

describe("public giveaway history settings", () => {
  it("lists only the latest PUBLIC_HISTORY_MAX giveaways", async () => {
    await harness.stop()
    harness = await createHarness({ env: { PUBLIC_HISTORY_MAX: "1" } })
    await drawnGiveaway({ title: "Old" })
    harness.clock.advance(1000)
    const newest = await drawnGiveaway({ title: "New" })
    await turnOn(newest.browser)

    const body: PublicHistoryJson = await (await history()).json()

    expect(body.giveaways.map((giveaway) => giveaway.code)).toEqual([newest.code])
  })

  it("has no page for a streamer an admin has not approved while sign-up is closed", async () => {
    await harness.stop()
    harness = await createHarness({ env: { OPEN_SIGNUP: "false" } })
    const { browser } = await drawnGiveaway()
    await turnOn(browser)

    const waiting = await history()
    harness.accountsDb.run("UPDATE streamers SET approved_at = 1 WHERE platform_user_id = ?", [
      users.streamerA.id,
    ])
    const approved = await history()

    expect([waiting.status, approved.status]).toEqual([404, 200])
  })
})
