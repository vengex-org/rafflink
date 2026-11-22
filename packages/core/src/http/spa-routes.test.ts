import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { Hono } from "hono"
import { createGiveaway, createHarness, users, type Harness } from "../../test/app-fixture.ts"
import { spaTemplate } from "../../test/contract/spa-fixture.ts"
import { createApp } from "./create-app.ts"

let harness: Harness
let app: Hono

beforeEach(async () => {
  harness = await createHarness()
  app = createApp(harness.deps, async () => spaTemplate)
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

  it("names a giveaway without a title after its code", async () => {
    const created = await createGiveaway(harness, users.streamerA.id, { title: undefined })

    const html = await (await app.request(`/g/${created.code}`)).text()

    expect(html).toContain(`<title>Giveaway ${created.code}</title>`)
  })

  it("answers an unknown code with the plain page and not an error", async () => {
    const response = await app.request("/ZZZZZ")

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("<title>Rafflink home</title>")
  })

  it("leaves the home page and the legal pages indexable and every other page not", async () => {
    const home = await app.request("/")
    const privacy = await app.request("/privacy")
    const terms = await app.request("/terms")
    const dashboard = await app.request("/dashboard")
    const verify = await app.request("/verify")

    expect(home.headers.get("x-robots-tag")).toBeNull()
    expect(privacy.headers.get("x-robots-tag")).toBeNull()
    expect(terms.headers.get("x-robots-tag")).toBeNull()
    expect(dashboard.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(verify.headers.get("x-robots-tag")).toBe("noindex, nofollow")
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
