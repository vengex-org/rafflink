import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
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

const answers = { name: "Ann Example", address: "Main Street 1\n12345 Town" }

function sameOriginPost(browser: Browser, path: string, body: unknown = {}) {
  return browser.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: harness.config.publicUrl },
    body: JSON.stringify(body),
  })
}

function sendAnswers(browser: Browser, code: string, body: unknown = { answers }) {
  return sameOriginPost(browser, `/api/g/${code}/answers`, body)
}

async function drawnWithForm(winnerForm: readonly string[] = ["name", "address"]) {
  const created = await createGiveaway(harness, users.streamerA.id, {
    rules: { ...validRules, winnerForm },
  })
  const winner = new Browser(harness)
  await winner.signInAs(users.viewer.id, `/auth/twitch/viewer/start?giveaway=${created.code}`)
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/close`, {})
  await created.browser.postJson(`/api/dash/giveaways/${created.id}/draw`, { count: 1 })
  return { ...created, winner }
}

async function claimedWithForm(winnerForm?: readonly string[]) {
  const drawn = await drawnWithForm(winnerForm)
  const claim = await drawn.winner.request(`/api/g/${drawn.code}/claim`, { method: "POST" })
  expect(claim.status).toBe(200)
  return drawn
}

interface AnswersBody {
  readonly form: readonly string[]
  readonly picks: readonly {
    readonly n: number
    readonly answers: string
    readonly deliveredAt: number | null
    readonly values: Record<string, string> | null
  }[]
}

async function readAnswers(browser: Browser, id: string): Promise<AnswersBody> {
  const response = await browser.request(`/api/dash/giveaways/${id}/answers`)
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  return response.json()
}

describe("the winner form", () => {
  it("takes the answers of the claimed winner once, sealed at rest, and shows them to the streamer", async () => {
    const { browser, id, code, winner } = await claimedWithForm()

    const first = await sendAnswers(winner, code)
    const second = await sendAnswers(winner, code, { answers: { ...answers, name: "Other" } })

    expect([first.status, await first.json()]).toEqual([200, { kind: "saved" }])
    expect([second.status, await second.json()]).toEqual([409, { kind: "already-answered" }])
    const stored = JSON.stringify(harness.rooms.roomFor(id).winnerAnswers())
    expect(stored).not.toContain("Ann")
    expect(stored).not.toContain("Main Street")
    expect(await readAnswers(browser, id)).toEqual({
      form: ["name", "address"],
      picks: [{ n: 0, answers: "sent", deliveredAt: null, values: answers }],
    })
    const page: { me: { answers: string } } = await (await winner.request(`/api/g/${code}`)).json()
    expect(page.me.answers).toBe("sent")
  })

  it("refuses answers before the claim, from someone who did not win, signed out or invalid", async () => {
    const { code, winner } = await drawnWithForm()
    const loser = new Browser(harness)
    await loser.signInAs(users.viewer2.id, `/auth/twitch/viewer/start?giveaway=${code}`)

    const early = await sendAnswers(winner, code)
    expect([early.status, await early.json()]).toEqual([409, { kind: "not-claimed" }])
    await winner.request(`/api/g/${code}/claim`, { method: "POST" })
    const notWinner = await sendAnswers(loser, code)
    expect([notWinner.status, await notWinner.json()]).toEqual([403, { kind: "not-a-winner" }])
    expect((await sendAnswers(new Browser(harness), code)).status).toBe(401)
    const missing = await sendAnswers(winner, code, { answers: { name: "Ann" } })
    expect([missing.status, await missing.json()]).toEqual([
      400,
      { error: "invalid-input", field: "address", code: "missing" },
    ])
    const tooLong = await sendAnswers(winner, code, {
      answers: { ...answers, name: "a".repeat(harness.config.winnerAnswerMaxLength + 1) },
    })
    expect(tooLong.status).toBe(400)
    expect((await sendAnswers(winner, code)).status).toBe(200)
  })

  it("refuses answers from another origin or without a JSON body", async () => {
    const { code, winner } = await claimedWithForm()

    const crossSite = await winner.request(`/api/g/${code}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ answers }),
    })
    const form = await winner.request(`/api/g/${code}/answers`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: harness.config.publicUrl },
      body: JSON.stringify({ answers }),
    })

    expect([crossSite.status, form.status]).toEqual([403, 415])
  })

  it("closes the form in the viewer state of a winner whose pick was rerolled", async () => {
    const { browser, id, code } = await createGiveaway(harness, users.streamerA.id, {
      rules: { ...validRules, winnerForm: ["name"] },
    })
    const viewers = [new Browser(harness), new Browser(harness)]
    await viewers[0]?.signInAs(users.viewer.id, `/auth/twitch/viewer/start?giveaway=${code}`)
    await viewers[1]?.signInAs(users.viewer2.id, `/auth/twitch/viewer/start?giveaway=${code}`)
    await browser.postJson(`/api/dash/giveaways/${id}/close`, {})
    await browser.postJson(`/api/dash/giveaways/${id}/draw`, { count: 1 })

    expect((await browser.postJson(`/api/dash/giveaways/${id}/reroll`, { n: 0 })).status).toBe(200)

    const states = await Promise.all(
      viewers.map(async (viewer) => {
        const page: { me: { kind: string; n: number; answers: string } } = await (
          await viewer.request(`/api/g/${code}`)
        ).json()
        return page.me
      }),
    )
    expect(states.map((me) => [me.n, me.answers]).toSorted()).toEqual([
      [0, "closed"],
      [1, "open"],
    ])
  })

  it("answers 404 for a giveaway without a form", async () => {
    const { code, winner } = await claimedWithForm([])

    const response = await sendAnswers(winner, code)

    expect([response.status, await response.json()]).toEqual([404, { error: "no-form" }])
  })

  it("shows the answers to the giveaway's streamer only: not another streamer, nor a moderator link", async () => {
    const { browser, id, code, winner } = await claimedWithForm()
    await sendAnswers(winner, code)
    const other = new Browser(harness)
    await other.signInAs(users.streamerB.id, "/auth/twitch/streamer/start")
    const created = await sameOriginPost(browser, `/api/dash/giveaways/${id}/moderator-links`, {
      requireMod: false,
    })
    const { token }: { token: string } = await created.json()
    const moderator = new Browser(harness)
    await sameOriginPost(moderator, "/api/moderator-links/open", { token })

    expect((await other.request(`/api/dash/giveaways/${id}/answers`)).status).toBe(404)
    expect((await new Browser(harness).request(`/api/dash/giveaways/${id}/answers`)).status).toBe(
      401,
    )
    expect((await moderator.request(`/api/dash/giveaways/${id}/answers`)).status).toBe(401)
    expect((await moderator.request(`/api/mod/${id}/answers`)).status).toBe(404)
    const live = await moderator.request(`/api/mod/${id}`)
    expect(live.status).toBe(200)
    expect(await live.text()).not.toContain("Ann")
    expect(
      (await sameOriginPost(moderator, `/api/dash/giveaways/${id}/delivered`, { n: 0 })).status,
    ).toBe(401)
  })

  it("deletes the answers when the streamer marks the prize delivered, and the CSV shows the delivery", async () => {
    const { browser, id, code, winner } = await claimedWithForm()
    await sendAnswers(winner, code)

    const crossSite = await browser.request(`/api/dash/giveaways/${id}/delivered`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ n: 0 }),
    })
    const delivered = await sameOriginPost(browser, `/api/dash/giveaways/${id}/delivered`, {
      n: 0,
    })
    const again = await sameOriginPost(browser, `/api/dash/giveaways/${id}/delivered`, { n: 0 })
    const unknown = await sameOriginPost(browser, `/api/dash/giveaways/${id}/delivered`, { n: 4 })

    expect(crossSite.status).toBe(403)
    expect([delivered.status, await delivered.json()]).toEqual([200, { kind: "delivered" }])
    expect([again.status, unknown.status]).toEqual([409, 404])
    const deliveredAt = harness.clock.now()
    expect(await readAnswers(browser, id)).toEqual({
      form: ["name", "address"],
      picks: [{ n: 0, answers: "sent", deliveredAt, values: null }],
    })
    const csv = await (await browser.request(`/api/dash/giveaways/${id}/winners.csv`)).text()
    expect(csv.split("\r\n")[0]).toEndWith(',"delivered_at"')
    expect(csv.split("\r\n")[1]).toEndWith(`,"${new Date(deliveredAt).toISOString()}"`)
  })

  it("loses the answers 30 days after the claim and keeps that they were sent", async () => {
    const { id, code, winner } = await claimedWithForm()
    await sendAnswers(winner, code)

    harness.clock.advance(harness.config.winnerFormRetentionSeconds * 1000)
    harness.rooms.roomFor(id).onAlarm()
    // The first session has expired by now.
    const browser = new Browser(harness)
    await browser.signInAs(users.streamerA.id, "/auth/twitch/streamer/start")

    expect(harness.config.winnerFormRetentionSeconds).toBe(30 * 24 * 60 * 60)
    expect(harness.rooms.roomFor(id).winnerAnswers()).toEqual([])
    expect((await readAnswers(browser, id)).picks).toEqual([
      { n: 0, answers: "sent", deliveredAt: null, values: null },
    ])
  })

  it("leaves with the room when the streamer deletes the account", async () => {
    const { browser, id, code, winner } = await claimedWithForm()
    await sendAnswers(winner, code)

    expect((await sameOriginPost(browser, "/api/dash/account/delete")).status).toBe(200)

    expect(harness.rooms.deleted).toEqual([id])
  })
})
