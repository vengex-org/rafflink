import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  Browser,
  fullStreamerStart,
  createHarness,
  users,
  validRules,
  type Harness,
} from "../../test/app-fixture.ts"

let harness: Harness

beforeEach(async () => {
  spyOn(console, "info").mockImplementation(() => {})
  harness = await createHarness({ env: { OPEN_SIGNUP: "false" } })
})

afterEach(async () => {
  await harness.stop()
})

async function signedIn(userId: string, target: Harness = harness): Promise<Browser> {
  const browser = new Browser(target)
  await browser.signInAs(userId, fullStreamerStart)
  return browser
}

function create(browser: Browser): Promise<Response> {
  return browser.postJson("/api/dash/giveaways", {
    title: "Giveaway",
    prize: "Prize",
    rules: validRules,
  })
}

function decide(
  browser: Browser,
  streamerId: string,
  action: "approve" | "revoke",
  headers: Record<string, string> = {},
): Promise<Response> {
  return browser.request(`/api/admin/streamers/${streamerId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: harness.config.publicUrl, ...headers },
    body: "{}",
  })
}

async function access(browser: Browser) {
  const response = await browser.request("/api/admin/streamers")
  expect(response.status).toBe(200)
  const body: {
    pending: { streamers: { id: string; login: string }[]; truncated: boolean }
    approved: { streamers: { id: string; login: string }[]; truncated: boolean }
  } = await response.json()
  return body
}

async function sessionOf(browser: Browser): Promise<unknown> {
  const body: { streamer: { canCreate: boolean } } = await (
    await browser.request("/api/session")
  ).json()
  return body.streamer.canCreate
}

describe("streamer access while signup is closed", () => {
  it("refuses an unapproved streamer a giveaway with a stable error code", async () => {
    const other = await signedIn(users.streamerB.id)

    const response = await create(other)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "streamer_not_approved" })
    expect(harness.accountsDb.query("SELECT id FROM giveaways").all()).toEqual([])
  })

  it("lets an admin create without approval", async () => {
    const admin = await signedIn(users.streamerA.id)

    expect((await create(admin)).status).toBe(201)
  })

  it("tells the admin page that signup is closed", async () => {
    const admin = await signedIn(users.streamerA.id)

    expect(await (await admin.request("/api/admin/usage")).json()).toMatchObject({
      signupOpen: false,
    })
  })

  it("lets a streamer create after approval and refuses again after revoke", async () => {
    const admin = await signedIn(users.streamerA.id)
    const other = await signedIn(users.streamerB.id)
    const { pending } = await access(admin)
    const id = pending.streamers[0]?.id ?? ""

    expect((await decide(admin, id, "approve")).status).toBe(200)
    expect((await create(other)).status).toBe(201)
    expect((await decide(admin, id, "revoke")).status).toBe(200)
    expect((await create(other)).status).toBe(403)
  })

  it("reports canCreate in the session", async () => {
    const admin = await signedIn(users.streamerA.id)
    const other = await signedIn(users.streamerB.id)
    const { pending } = await access(admin)

    expect(await sessionOf(admin)).toBe(true)
    expect(await sessionOf(other)).toBe(false)
    await decide(admin, pending.streamers[0]?.id ?? "", "approve")
    expect(await sessionOf(other)).toBe(true)
  })

  it("lists pending and approved streamers and leaves admins out", async () => {
    const admin = await signedIn(users.streamerA.id)
    await signedIn(users.streamerB.id)
    const first = await access(admin)
    await decide(admin, first.pending.streamers[0]?.id ?? "", "approve")

    const listed = await access(admin)

    expect(first.pending.streamers.map((streamer) => streamer.login)).toEqual([
      users.streamerB.login,
    ])
    expect(listed.pending.streamers).toEqual([])
    expect(listed.approved.streamers.map((streamer) => streamer.login)).toEqual([
      users.streamerB.login,
    ])
  })

  it("cuts a list to STREAMER_ACCESS_LIST_MAX, flags it and never spends a slot on an admin", async () => {
    await harness.stop()
    harness = await createHarness({
      env: { OPEN_SIGNUP: "false", STREAMER_ACCESS_LIST_MAX: "1" },
    })
    // The admin signs in last, so a list cut before the admins are removed would hold only the admin.
    await signedIn(users.streamerB.id)
    harness.clock.advance(1000)
    await signedIn(users.viewer.id)
    harness.clock.advance(1000)
    const admin = await signedIn(users.streamerA.id)

    const listed = await access(admin)

    expect(listed.pending.streamers.map((streamer) => streamer.login)).toEqual([users.viewer.login])
    expect(listed.pending.truncated).toBe(true)
    expect(listed.approved).toEqual({ streamers: [], truncated: false })
  })

  it("keeps the lists and the decisions to admins", async () => {
    const admin = await signedIn(users.streamerA.id)
    const other = await signedIn(users.streamerB.id)
    const id = (await access(admin)).pending.streamers[0]?.id ?? ""

    expect((await other.request("/api/admin/streamers")).status).toBe(403)
    expect((await decide(other, id, "approve")).status).toBe(403)
    expect((await decide(other, id, "revoke")).status).toBe(403)
    expect((await new Browser(harness).request("/api/admin/streamers")).status).toBe(401)
    expect((await create(other)).status).toBe(403)
  })

  it("refuses a decision from another origin or without a JSON body", async () => {
    const admin = await signedIn(users.streamerA.id)
    await signedIn(users.streamerB.id)
    const id = (await access(admin)).pending.streamers[0]?.id ?? ""

    const foreign = await decide(admin, id, "approve", { origin: "https://evil.example" })
    const plain = await decide(admin, id, "approve", { "content-type": "text/plain" })

    expect(foreign.status).toBe(403)
    expect(plain.status).toBe(415)
    expect((await access(admin)).approved.streamers).toEqual([])
  })

  it("answers 404 for an unknown streamer", async () => {
    const admin = await signedIn(users.streamerA.id)

    expect((await decide(admin, "missing", "approve")).status).toBe(404)
    expect((await decide(admin, "missing", "revoke")).status).toBe(404)
  })
})

describe("streamer access while signup is open", () => {
  it("lets any streamer create and tells the admin page that signup is open", async () => {
    const open = await createHarness({ env: { OPEN_SIGNUP: "true" } })
    try {
      const admin = await signedIn(users.streamerA.id, open)
      const other = await signedIn(users.streamerB.id, open)

      expect((await create(other)).status).toBe(201)
      expect(await sessionOf(other)).toBe(true)
      expect(await (await admin.request("/api/admin/usage")).json()).toMatchObject({
        signupOpen: true,
      })
    } finally {
      await open.stop()
    }
  })
})
