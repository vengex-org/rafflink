import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createHarness, testAddressHeader, type Harness } from "../../test/app-fixture.ts"
import { MemorySitePresence } from "../lib/memory-site-presence.ts"
import { parsePresenceKind, presenceKindHeader, presenceKinds } from "../presence/site-presence.ts"

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

  it("admits an upgrade of every page kind from the site's own origin and names the kind", async () => {
    const answers = await Promise.all(
      presenceKinds.map((kind) =>
        socketRequest(`?kind=${kind}`, { origin: harness.config.publicUrl }),
      ),
    )

    expect(answers.map((answer) => answer.status)).toEqual(presenceKinds.map(() => 204))
    expect(answers.map((answer) => answer.headers.get(presenceKindHeader))).toEqual([
      ...presenceKinds,
    ])
  })

  it("refuses an address past PRESENCE_IP_LIMIT_PER_MINUTE and admits another", async () => {
    await harness.stop()
    harness = await createHarness({ env: { PRESENCE_IP_LIMIT_PER_MINUTE: "2" } })
    const from = (address: string) =>
      socketRequest("?kind=home", {
        origin: harness.config.publicUrl,
        [testAddressHeader]: address,
      })

    const statuses = [
      (await from("203.0.113.5")).status,
      (await from("203.0.113.5")).status,
      (await from("203.0.113.5")).status,
      (await from("203.0.113.6")).status,
    ]

    expect(statuses).toEqual([204, 204, 429, 204])
  })

  it("answers 404 where the target has no presence count", async () => {
    await harness.stop()
    harness = await createHarness({ withoutPresence: true })

    const response = await socketRequest("?kind=home", { origin: harness.config.publicUrl })

    expect(response.status).toBe(404)
    expect(response.headers.get(presenceKindHeader)).toBeNull()
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
