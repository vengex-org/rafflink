import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createHarness, type Harness } from "../../test/app-fixture.ts"
import { MemorySitePresence } from "../lib/memory-site-presence.ts"
import { parsePresenceKind, presenceKinds } from "../presence/site-presence.ts"

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.stop()
})

describe("presence socket route", () => {
  const upgrade = { upgrade: "websocket", connection: "Upgrade" }
  const socketRequest = (query: string, headers: Record<string, string>) =>
    harness.app.request(`/api/presence${query}`, { headers: { ...upgrade, ...headers } })

  it("admits an upgrade of every page kind from the site's own origin", async () => {
    const statuses = await Promise.all(
      presenceKinds.map(
        async (kind) =>
          (await socketRequest(`?kind=${kind}`, { origin: harness.config.publicUrl })).status,
      ),
    )

    expect(statuses).toEqual(presenceKinds.map(() => 204))
  })

  it("refuses an upgrade from another origin and one without an origin", async () => {
    const other = await socketRequest("?kind=home", { origin: "https://evil.example" })
    const missing = await socketRequest("?kind=home", {})

    expect([other.status, missing.status]).toEqual([403, 403])
  })

  it("refuses a kind outside the list and a missing kind", async () => {
    const origin = { origin: harness.config.publicUrl }
    const unknown = await socketRequest("?kind=overlay", origin)
    const missing = await socketRequest("", origin)

    expect([unknown.status, missing.status]).toEqual([400, 400])
    expect(await unknown.json()).toEqual({ error: "invalid-input", field: "kind" })
  })

  it("answers 426 to a plain request", async () => {
    const response = await harness.app.request("/api/presence?kind=home")

    expect(response.status).toBe(426)
  })
})

describe("parsePresenceKind", () => {
  it("takes the listed kinds only, in their exact spelling", () => {
    expect(parsePresenceKind("giveaway")).toBe("giveaway")
    expect(parsePresenceKind("Home")).toBeNull()
    expect(parsePresenceKind("")).toBeNull()
    expect(parsePresenceKind(undefined)).toBeNull()
  })
})

describe("MemorySitePresence", () => {
  it("counts the open sockets per kind and forgets one that closed", async () => {
    const presence = new MemorySitePresence()
    const leaveHome = presence.join("home")
    presence.join("home")
    presence.join("giveaway")

    leaveHome()

    expect(await presence.counts()).toEqual({
      total: 2,
      byKind: { home: 1, legal: 0, dashboard: 0, giveaway: 1, other: 0 },
    })
  })
})
