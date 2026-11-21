import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
import { installFakeSocket } from "./fake-socket.ts"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

let restoreSocket = () => {}
beforeEach(() => {
  restoreSocket = installFakeSocket()
})
afterEach(() => {
  cleanup()
  mock.restore()
  restoreSocket()
})

const giveawayRoute = { "GET /api/g/ABCDE": () => ok(giveaway) }
const wonRoute = (
  claimRemainingMs: number,
  claim: { state: string; via?: string },
  chatClaimAvailable = true,
) => ({
  "GET /api/g/ABCDE": () =>
    ok({
      ...giveaway,
      status: "drawn",
      me: { kind: "won", userId: "u1", n: 0, claimRemainingMs, claim, chatClaimAvailable },
    }),
})

describe("giveaway landing", () => {
  it("shows the prize as the headline with the people count and who can enter", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          entrantCount: 1204,
          rules: { ...giveaway.rules, followersOnly: true, minAccountAgeDays: 30 },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 1, name: "A gaming chair" })).toBeTruthy()
    expect(view.getByText("Streamy, Summer giveaway")).toBeTruthy()
    expect(view.getByText("1,204 people entered")).toBeTruthy()
    expect(view.getByText(/Only followers can enter\./)).toBeTruthy()
    expect(view.getByText("Entries stay open until the streamer closes them.")).toBeTruthy()
  })

  it("names the giveaway by its code when it has no title and no prize", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () => ok({ ...giveaway, title: null, prize: null }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 1, name: "Giveaway ABCDE" })).toBeTruthy()
    expect(view.queryByText(/null/)).toBeNull()
  })

  it("keeps the prize as the headline when the title is missing", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, title: null }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 1, name: "A gaming chair" })).toBeTruthy()
    expect(view.getByText("Streamy, Giveaway ABCDE")).toBeTruthy()
  })

  it("says one person entered in the singular", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, entrantCount: 1 }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("1 person entered")).toBeTruthy()
  })

  it("counts down to the end time when entries end by themselves", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () => ok({ ...giveaway, closesAt: Date.now() + 2 * 3_600_000 + 60_000 }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText(/Entries close in 2 h/)).toBeTruthy()
  })

  it("names the extra tickets of subscribers in one sentence", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          rules: {
            ...giveaway.rules,
            tickets: {
              viewer: 1,
              follower: 1,
              sub_t1: 3,
              sub_t2: 3,
              sub_t3: 3,
              vip: 1,
              moderator: 1,
            },
          },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText(/Everyone can enter\. Subscribers get 3 tickets\./)).toBeTruthy()
  })

  it("lists the tickets of every group and the claim time under the rules", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({ ...giveaway, rules: { ...giveaway.rules, minAccountAgeDays: 30 } }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Subscribers, tier 2: 4 tickets")).toBeTruthy()
    expect(view.getByText("Viewers: 1 ticket")).toBeTruthy()
    expect(view.getByText("Account at least 30 days old")).toBeTruthy()
    expect(view.getByText("Winners have 5 minutes to claim")).toBeTruthy()
    expect(view.getByText(/Some viewers get extra tickets/)).toBeTruthy()
  })

  it("explains the two steps and offers one Enter with Twitch button", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Step 1 of 2: Sign in")).toBeTruthy()
    expect(view.getByRole("list", { name: "Steps" }).textContent).toContain("Get your ticket")
    expect(view.getByRole("link", { name: "Enter with Twitch" }).getAttribute("href")).toBe(
      "/auth/twitch/viewer/start?giveaway=ABCDE",
    )
  })

  it("answers not found for an unknown code", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Giveaway not found")).toBeTruthy()
  })

  it("shows an error when the answer has an unknown status", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "paused" }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Something went wrong. Reload the page.")).toBeTruthy()
  })

  it("says the giveaway is closed and offers no sign-in", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "closed" }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByText(/giveaway closed/)).toBeTruthy()
    expect(view.getByText(/The streamer stopped taking entries/)).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("asks a viewer of a drawn giveaway to sign in to see whether they won", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "drawn" }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })
})

const meRoute = (state: unknown, status = "open") => ({
  "GET /api/g/ABCDE": () => ok({ ...giveaway, status, me: state }),
})

describe("returning viewer", () => {
  it("names the streamer above the headline", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Streamy, Summer giveaway")).toBeTruthy()
    expect(view.getByText("ST")).toBeTruthy()
  })

  it("shows You are in with the tickets and the group without a new sign-in", async () => {
    mockFetch(
      meRoute({
        kind: "entered",
        userId: "u1",
        entry: { group: "sub_t1", tickets: 3, enteredAt: 1 },
      }),
    )

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(view.getByText("Your entry: 3 tickets as a tier 1 subscriber.")).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("shows the tickets in the singular for a viewer", async () => {
    mockFetch(
      meRoute({
        kind: "entered",
        userId: "u1",
        entry: { group: "viewer", tickets: 1, enteredAt: 1 },
      }),
    )

    const view = renderApp("/ABCDE?entry=entered")

    expect(await view.findByText("Your entry: 1 ticket as a viewer.")).toBeTruthy()
  })

  it("tells an entrant who was not drawn, without a sign-in", async () => {
    mockFetch(meRoute({ kind: "not-won", userId: "u1" }, "drawn"))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("The winner was drawn. It was not you this time.")).toBeTruthy()
    expect(view.queryByRole("link", { name: "Sign in with Twitch" })).toBeNull()
  })
})

describe("entry outcomes", () => {
  it("explains why a viewer cannot enter and what would let them in", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/g/ABCDE?entry=not-eligible&reason=subs-only")

    expect(await view.findByText("This giveaway is for subscribers only.")).toBeTruthy()
    expect(
      view.getByText("Subscribe to the channel on Twitch, then open this link again."),
    ).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("greets an entered viewer with You are in and what happens next", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=entered")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(
      view.getByText("The streamer draws the winner live. Keep this page open or come back later."),
    ).toBeTruthy()
    expect(view.getByText("All 2 steps done")).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("keeps the first entry and says You are in again", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=already-in")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(view.getByText(/Your first entry is kept/)).toBeTruthy()
  })

  it("tells an entered viewer of a drawn giveaway that it was not them", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "drawn" }) })

    const view = renderApp("/ABCDE?entry=entered")

    expect(await view.findByText("The winner was drawn. It was not you this time.")).toBeTruthy()
  })

  it.each(["entry=not-eligible&reason=subs-only", "entry=closed", "entry=dropped"])(
    "hides the step count when the outcome ends the flow (%s)",
    async (query) => {
      mockFetch(giveawayRoute)

      const view = renderApp(`/ABCDE?${query}`)

      expect(await view.findByRole("heading", { level: 2 })).toBeTruthy()
      expect(view.queryByRole("list", { name: "Steps" })).toBeNull()
    },
  )

  it("offers the broadcaster another Twitch account through the account picker", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=broadcaster")

    const link = await view.findByRole("link", { name: "Use another Twitch account" })
    expect(link.getAttribute("href")).toBe(
      "/auth/twitch/viewer/start?giveaway=ABCDE&force_verify=true",
    )
  })

  it("offers no other-account button for a reason another account would not fix", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=subs-only")

    expect(await view.findByText("This giveaway is for subscribers only.")).toBeTruthy()
    expect(view.queryByRole("link", { name: "Use another Twitch account" })).toBeNull()
  })

  it("says Try again with a way to enter again", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=try-again")

    expect(await view.findByRole("heading", { name: "Try again" })).toBeTruthy()
    expect(view.getByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
  })

  it.each(["invalid-state", "dropped"])("offers Enter with Twitch again after %s", async (kind) => {
    mockFetch(giveawayRoute)

    const view = renderApp(`/ABCDE?entry=${kind}`)

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
  })

  it("replaces the address with the plain page path once the queued entry settled", async () => {
    window.history.replaceState(null, "", "/g/ABCDE?entry=pending&ticket=T1")
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () =>
        ok({ kind: "entered", entry: { group: "viewer", tickets: 1, enteredAt: 1 } }),
    })

    const view = renderApp("/g/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(window.location.pathname).toBe("/g/ABCDE")
    expect(window.location.search).toBe("")
  })

  it("replaces the address too when the poll runs past its maximum", async () => {
    window.history.replaceState(null, "", "/g/ABCDE?entry=pending&ticket=T1")
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "pending", ticket: "T1" }),
    })

    const view = renderApp("/g/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
    expect(window.location.search).toBe("")
  })

  it("keeps other query parameters when it forgets the entry", async () => {
    window.history.replaceState(null, "", "/g/ABCDE?entry=pending&ticket=T1&utm=x")
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/g/ABCDE?entry=pending&ticket=T1&utm=x")

    expect(await view.findByRole("heading", { name: "Sorry, giveaway closed." })).toBeTruthy()
    expect(window.location.search).toBe("?utm=x")
  })

  it("trusts the server state over a dropped outcome left in the address", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          me: {
            kind: "entered",
            userId: "u1",
            entry: { group: "sub_t1", tickets: 3, enteredAt: 1 },
          },
        }),
    })

    const view = renderApp("/ABCDE?entry=dropped")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(view.getByText("Your entry: 3 tickets as a tier 1 subscriber.")).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("ignores an entry outcome it does not know", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=won-the-lottery")

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
  })

  it("ignores a not-eligible outcome with an unknown reason", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=constructor")

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
    expect(view.queryByText("You cannot enter")).toBeNull()
  })

  it("turns a pending entry into entered by polling and says how long it may take", async () => {
    let polls = 0
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => {
        polls += 1
        return ok(
          polls < 3
            ? { kind: "pending", ticket: "T1" }
            : { kind: "entered", entry: { group: "viewer", tickets: 1, enteredAt: 1 } },
        )
      },
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("heading", { name: "You are being entered" })).toBeTruthy()
    expect(view.getByText("This takes up to 1 minute. Do not close this page.")).toBeTruthy()
    expect(view.getByText("Step 2 of 2: Get your ticket")).toBeTruthy()
    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(polls).toBe(3)
  })

  it("shows the tickets from the poll answer after a queued entry settles", async () => {
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () =>
        ok({ kind: "entered", entry: { group: "sub_t1", tickets: 3, enteredAt: 1 } }),
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    expect(view.getByText("Your entry: 3 tickets as a tier 1 subscriber.")).toBeTruthy()
  })

  it("offers Enter with Twitch when the poll runs past its maximum", async () => {
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "pending", ticket: "T1" }),
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("heading", { name: "You are being entered" })).toBeTruthy()
    expect(
      await view.findByRole("link", { name: "Enter with Twitch" }, { timeout: 1000 }),
    ).toBeTruthy()
    expect(view.queryByRole("heading", { name: "You are being entered" })).toBeNull()
  })
})

describe("winner claim", () => {
  it("shows the You won card with the time left and claims with one button", async () => {
    const requests = mockFetch({
      ...wonRoute(90_000, { state: "waiting" }),
      "POST /api/g/ABCDE/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { name: "You won" })).toBeTruthy()
    expect(view.getByRole("timer").textContent).toMatch(/^1:(29|30)$/)
    expect(view.getByText("left to claim")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Claim my prize" }))
    expect(await view.findByText("Claimed! The streamer will contact you.")).toBeTruthy()
    expect(view.queryByRole("button", { name: "Claim my prize" })).toBeNull()
    expect(requests.map((request) => request.route)).toContain("POST /api/g/ABCDE/claim")
  })

  it("offers the chat word as the alternative to the button", async () => {
    mockFetch({
      ...wonRoute(90_000, { state: "waiting" }),
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          status: "drawn",
          rules: { ...giveaway.rules, claimKeyword: "mine" },
          me: {
            kind: "won",
            userId: "u1",
            n: 0,
            claimRemainingMs: 90_000,
            claim: { state: "waiting" },
            chatClaimAvailable: true,
          },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("mine")).toBeTruthy()
    expect(view.getByText(/^Or type/)).toBeTruthy()
  })

  it("offers any chat message as the alternative when there is no chat word", async () => {
    mockFetch(wonRoute(90_000, { state: "waiting" }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Or write any message in the stream chat.")).toBeTruthy()
  })

  it("hides the chat hint when the chat claim is not available", async () => {
    mockFetch(wonRoute(90_000, { state: "waiting" }, false))

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("button", { name: "Claim my prize" })).toBeTruthy()
    expect(view.queryByText(/^Or write any message/)).toBeNull()
  })

  it("says what went wrong when the claim is refused", async () => {
    mockFetch({
      ...wonRoute(90_000, { state: "waiting" }),
      "POST /api/g/ABCDE/claim": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/ABCDE")
    fireEvent.click(await view.findByRole("button", { name: "Claim my prize" }))

    expect(await view.findByText(/Your claim did not go through/)).toBeTruthy()
    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()
  })

  it("tells a winner whose claim time ran out", async () => {
    mockFetch(wonRoute(0, { state: "waiting" }))

    const view = renderApp("/ABCDE")

    expect(await waitFor(() => view.getByText("The claim time ran out."))).toBeTruthy()
    expect(view.getByRole("heading", { name: "Time is up" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Claim my prize" })).toBeNull()
  })

  it("tells a winner who was replaced", async () => {
    mockFetch(wonRoute(90_000, { state: "rerolled" }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("The streamer picked another winner.")).toBeTruthy()
    expect(view.queryByRole("button", { name: "Claim my prize" })).toBeNull()
  })

  it("shows a claimed winner the contact message without a button", async () => {
    mockFetch(wonRoute(5000, { state: "claimed", via: "chat" }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Claimed! The streamer will contact you.")).toBeTruthy()
    expect(view.queryByRole("button", { name: "Claim my prize" })).toBeNull()
  })
})

async function expectOnlyScreen(path: string, heading: string) {
  const view = renderApp(path)
  await view.findByRole("heading", { level: 2, name: heading })
  expect(view.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
    heading,
  ])
  return view
}

describe("state screens", () => {
  const entered = {
    kind: "entered",
    userId: "u1",
    entry: { group: "viewer", tickets: 1, enteredAt: 1 },
  }

  it("asks a signed-out viewer to sign in to enter", async () => {
    mockFetch(giveawayRoute)

    await expectOnlyScreen("/ABCDE", "Sign in to enter")
  })

  it("invites a signed-in viewer who has not entered to enter", async () => {
    mockFetch(meRoute({ kind: "not-entered", userId: "u1" }))

    await expectOnlyScreen("/ABCDE", "Ready to enter?")
  })

  it("confirms an entry with the ticket count", async () => {
    mockFetch(meRoute({ ...entered, entry: { group: "sub_t1", tickets: 3, enteredAt: 1 } }))

    const view = await expectOnlyScreen("/ABCDE", "You are in")

    expect(view.getByText("3").textContent).toBe("3")
  })

  it("tells an entered viewer that the draw is next once entries closed", async () => {
    mockFetch(meRoute(entered, "closed"))

    const view = await expectOnlyScreen("/ABCDE", "Waiting for the draw")

    expect(view.getByText("Your entry: 1 ticket as a viewer.")).toBeTruthy()
  })

  it("shows a winner the claim screen", async () => {
    mockFetch(wonRoute(90_000, { state: "waiting" }))

    const view = await expectOnlyScreen("/ABCDE", "You won")

    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()
  })

  it("shows a winner who claimed the prize a done screen", async () => {
    mockFetch(wonRoute(5000, { state: "claimed", via: "chat" }))

    await expectOnlyScreen("/ABCDE", "Prize claimed")
  })

  it("tells an entrant that someone else won", async () => {
    mockFetch(meRoute({ kind: "not-won", userId: "u1" }, "drawn"))

    await expectOnlyScreen("/ABCDE", "Not this time")
  })

  it("tells a winner that the claim time is over", async () => {
    mockFetch(wonRoute(0, { state: "waiting" }))

    await expectOnlyScreen("/ABCDE", "Time is up")
  })

  it("says a closed giveaway is closed", async () => {
    mockFetch(meRoute({ kind: "signed-out" }, "closed"))

    await expectOnlyScreen("/ABCDE", "Sorry, giveaway closed.")
  })

  it("shows the prize, the streamer, the entrants and the rules before sign-in", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 1, name: "A gaming chair" })).toBeTruthy()
    expect(view.getByText("Streamy, Summer giveaway")).toBeTruthy()
    expect(view.getByText("42 people entered")).toBeTruthy()
    expect(view.getByText("Rules and tickets")).toBeTruthy()
    expect(view.getByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
  })
})

async function clockAt(startMs: number, laterMs: number, label: string) {
  const clock = { now: 1_000_000 }
  spyOn(Date, "now").mockImplementation(() => clock.now)
  mockFetch(wonRoute(startMs, { state: "waiting" }))
  const view = renderApp("/ABCDE")
  await view.findByText("left to claim")
  clock.now += laterMs
  expect(await view.findByText(label, {}, { timeout: 2500 })).toBeTruthy()
  return view
}

describe("claim timer tone", () => {
  it("says to hurry below 15 seconds", async () => {
    const view = await clockAt(15_500, 1000, "left, hurry up")

    expect(view.getByRole("timer").textContent).toBe("0:15")
    expect(view.container.querySelector(".claim-ring")?.getAttribute("data-tone")).toBe("warning")
  })

  it("says to claim now below 5 seconds", async () => {
    const view = await clockAt(15_500, 11_000, "left, claim now")

    expect(view.getByRole("timer").textContent).toBe("0:05")
    expect(view.container.querySelector(".claim-ring")?.getAttribute("data-tone")).toBe("danger")
  })
})

describe("viewer page frame", () => {
  const entered = {
    kind: "entered",
    userId: "u1",
    entry: { group: "sub_t1", tickets: 3, enteredAt: 1 },
  }

  it.each([
    ["open", "Entries open"],
    ["closed", "Entries closed"],
    ["drawn", "Winners drawn"],
  ])("says in the phase bar that the giveaway is %s", async (status, text) => {
    mockFetch(meRoute({ kind: "signed-out" }, status))

    const view = renderApp("/ABCDE")

    expect(await view.findByText(text)).toBeTruthy()
    expect(view.getByText("42 people entered")).toBeTruthy()
  })

  it("lists who can enter, when entries end and the code before sign-in", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Who can enter")).toBeTruthy()
    expect(view.getByText("Entries")).toBeTruthy()
    expect(view.getByText("Code")).toBeTruthy()
    expect(view.getByText("ABCDE")).toBeTruthy()
  })

  it("leaves the entries row out once entries are closed", async () => {
    mockFetch(meRoute({ kind: "signed-out" }, "closed"))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Who can enter")).toBeTruthy()
    expect(view.queryByText("Entries")).toBeNull()
  })

  it("shows a returning entrant the ticket box and a link to the stream without a step count", async () => {
    mockFetch(meRoute(entered))

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 2, name: "You are in" })).toBeTruthy()
    expect(view.getByRole("link", { name: "Watch Streamy on Twitch" }).getAttribute("href")).toBe(
      "https://www.twitch.tv/streamy",
    )
    expect(view.queryByRole("list", { name: "Steps" })).toBeNull()
  })

  it("offers no stream link when the streamer name is not a Twitch login", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () => ok({ ...giveaway, streamerName: "Streamy 配信", me: entered }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 2, name: "You are in" })).toBeTruthy()
    expect(view.queryByRole("link", { name: /Watch/ })).toBeNull()
  })

  it("offers no stream link to a viewer who has not entered", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
    expect(view.queryByRole("link", { name: /Watch/ })).toBeNull()
  })

  it("names the prize and the pool the winner was drawn from", async () => {
    mockFetch(wonRoute(90_000, { state: "waiting" }))

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { level: 2, name: "You won" })).toBeTruthy()
    expect(view.getByText("Drawn from")).toBeTruthy()
    expect(view.getByText("42 people entered")).toBeTruthy()
    expect(view.queryByText("Entries open")).toBeNull()
  })
})
