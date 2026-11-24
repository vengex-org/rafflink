import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import type { Hono } from "hono"
import {
  createGiveaway,
  createHarness,
  testAddressHeader,
  users,
  type Harness,
} from "../../test/app-fixture.ts"
import { robotsMeta, spaTemplate, webBuild } from "../../test/contract/spa-fixture.ts"
import { withErrorReportingMeta } from "../lib/spa-html.ts"
import { dayMs } from "../stats/time.ts"
import { createApp } from "./create-app.ts"

let harness: Harness
let app: Hono

beforeEach(async () => {
  harness = await createHarness()
  app = createApp(harness.deps, webBuild({ "index.html": spaTemplate }))
})

afterEach(async () => {
  await harness.stop()
})

describe("page routes", () => {
  it("previews a giveaway with an escaped title, its prize and its streamer", async () => {
    const created = await createGiveaway(harness, users.streamerA.id, {
      title: `<b>"Cup"</b>`,
      prize: "A & B",
    })

    const response = await app.request(`/${created.code}`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("<title>&lt;b&gt;&quot;Cup&quot;&lt;/b&gt;</title>")
    expect(html).toContain("Win A &amp; B from ")
    expect(html).toContain(`href="http://localhost/${created.code}"`)
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  })

  it.each([
    ["the old /g/<code> link", (code: string) => `/g/${code}`, (code: string) => `/${code}`],
    ["the verify page", (code: string) => `/${code}/verify`, (code: string) => `/${code}/verify`],
  ])("previews a giveaway at %s with its canonical link", async (_, pathOf, canonicalOf) => {
    const created = await createGiveaway(harness, users.streamerA.id, { title: "Cup" })

    const html = await (await app.request(pathOf(created.code))).text()

    expect(html).toContain("<title>Cup</title>")
    expect(html).toContain(`href="http://localhost${canonicalOf(created.code)}"`)
  })

  it("names a giveaway without a title after its code", async () => {
    const created = await createGiveaway(harness, users.streamerA.id, { title: undefined })

    const html = await (await app.request(`/g/${created.code}`)).text()

    expect(html).toContain(`<title>Giveaway ${created.code}</title>`)
  })

  it.each([
    ["/en", "/"],
    ["/en/", "/"],
    ["/en/privacy", "/privacy"],
    ["/en/g/ABC?x=1", "/g/ABC?x=1"],
  ])("redirects %s to %s, the address without the English prefix", async (typed, canonical) => {
    const response = await app.request(typed)

    expect([response.status, response.headers.get("location")]).toEqual([308, canonical])
  })

  it("previews the list draw under its own title and canonical link, not indexed", async () => {
    const response = await app.request("/draw")
    const html = await response.text()

    expect(html).toContain("<title>Draw from a list</title>")
    expect(html).toContain('href="http://localhost/draw"')
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  })

  it("answers an unknown code with the plain page and not an error", async () => {
    const response = await app.request("/ZZZZZ")

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("<title>Rafflink home</title>")
  })

  it.each([
    ["/", true],
    ["/privacy", true],
    ["/de/terms", true],
    ["/dashboard", false],
    ["/verify", false],
  ])(
    "answers %s from a build without prerendered pages as the shell, indexable: %p",
    async (path, indexable) => {
      const response = await app.request(path)
      const html = await response.text()

      expect([path, response.headers.get("x-robots-tag"), html.includes(robotsMeta)]).toEqual(
        indexable ? [path, null, false] : [path, "noindex, nofollow", true],
      )
    },
  )

  it("lets a page whose build carries a Sentry DSN post to that ingest and to no other", async () => {
    const reporting = withErrorReportingMeta(spaTemplate, {
      sentryDsn: "https://public@o1.ingest.de.sentry.io/2",
      sentryEnvironment: "production",
      sentryRelease: null,
      sentrySamplePercent: 100,
    })
    const reported = createApp(harness.deps, webBuild({ "index.html": reporting }))
    const created = await createGiveaway(harness, users.streamerA.id)

    for (const path of ["/", `/${created.code}`, "/s/twitch/nobody"]) {
      const withIngest = (await reported.request(path)).headers.get("content-security-policy")
      const without = (await app.request(path)).headers.get("content-security-policy")

      expect(withIngest).toContain(" https://o1.ingest.de.sentry.io;")
      expect(without).not.toContain("sentry.io")
    }
  })

  it("keeps an unknown API path a JSON 404", async () => {
    const response = await app.request("/api/nothing")

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not-found" })
  })

  it("answers a JSON 404 for a page when no template is deployed", async () => {
    const bare = createApp(harness.deps, async () => null)

    const response = await bare.request("/")

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not-found" })
  })
})

const sources = () => harness.deps.stats.topReferrals(harness.clock.now() - dayMs, 10)

const visit = (target: Hono, path: string, address = "203.0.113.5") =>
  target.request(path, { headers: { [testAddressHeader]: address } })

describe("referral counting on the home page", () => {
  it("counts a visit of the home page by its ref label, with no cookie and no redirect", async () => {
    const response = await visit(app, "/?ref=reddit")
    await visit(app, "/?ref=reddit&utm_source=x")
    await visit(app, "/?ref=blog")

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await sources()).toEqual([
      { ref: "reddit", visits: 2 },
      { ref: "blog", visits: 1 },
    ])
  })

  it("counts nothing for a visit without a client address and logs the reason", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})

    const response = await app.request("/?ref=reddit")

    expect(response.status).toBe(200)
    expect(await sources()).toEqual([])
    expect(info).toHaveBeenCalledWith("referral visit not counted", { reason: "no-address" })
    info.mockRestore()
  })

  it("stops counting once the day's visits reached the most, serves the page and logs the reason", async () => {
    const info = spyOn(console, "info").mockImplementation(() => {})
    await harness.stop()
    harness = await createHarness({ env: { REFERRAL_VISITS_PER_DAY_MAX: "2" } })
    app = createApp(harness.deps, webBuild({ "index.html": spaTemplate }))

    const statuses = []
    for (const address of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      statuses.push((await visit(app, "/?ref=reddit", address)).status)
    }

    expect(statuses).toEqual([200, 200, 200])
    expect(await sources()).toEqual([{ ref: "reddit", visits: 2 }])
    expect(info).toHaveBeenCalledWith("referral visit not counted", { reason: "day-limit" })
    info.mockRestore()
  })

  it("stops counting an address over the entry limit, still serves the page, and keeps other addresses and entry sign-ins unaffected", async () => {
    await harness.stop()
    harness = await createHarness({ env: { ENTRY_IP_LIMIT_PER_MINUTE: "2" } })
    app = createApp(harness.deps, webBuild({ "index.html": spaTemplate }))

    const info = spyOn(console, "info").mockImplementation(() => {})
    const statuses = []
    for (let visits = 0; visits < 4; visits++) {
      statuses.push((await visit(app, "/?ref=reddit")).status)
    }
    await visit(app, "/?ref=reddit", "198.51.100.8")

    expect(statuses).toEqual([200, 200, 200, 200])
    expect(await sources()).toEqual([{ ref: "reddit", visits: 3 }])
    expect(await harness.deps.entryIpLimiter.allow("203.0.113.5")).toBe(true)
    expect(info).toHaveBeenCalledWith("referral visit not counted", { reason: "rate-limited" })
    expect(JSON.stringify(info.mock.calls)).not.toContain("203.0.113")
    info.mockRestore()
  })

  it("counts nothing for a missing, empty or malformed ref", async () => {
    for (const query of [
      "",
      "?ref=",
      "?ref=Reddit",
      "?ref=a%20b",
      `?ref=${"a".repeat(33)}`,
      "?other=x",
    ]) {
      const response = await visit(app, `/${query}`)
      expect(response.status).toBe(200)
    }

    expect(await sources()).toEqual([])
  })

  it("counts only the home page, not other pages", async () => {
    await visit(app, "/privacy?ref=reddit")
    await visit(app, "/dashboard?ref=reddit")

    expect(await sources()).toEqual([])
  })

  it("serves the page and logs when the count cannot be written", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    harness.accountsDb.run("DROP TABLE referrals")

    const response = await visit(app, "/?ref=reddit")

    expect(response.status).toBe(200)
    expect(warn).toHaveBeenCalledWith("referral count failed", { errorClass: "Error" })
    warn.mockRestore()
  })
})
