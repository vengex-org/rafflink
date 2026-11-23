import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, waitFor, type RenderResult } from "@testing-library/react"
import { stubClipboard } from "./clipboard.ts"
import { installFakeSocket } from "./fake-socket.ts"
import { claimedAt, claimedAtText, giveaway, rules, supportedSession } from "./fixtures.ts"
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
  claim: { state: string; at?: number; via?: string },
  chatClaimAvailable = true,
) => ({
  "GET /api/g/ABCDE": () =>
    ok({
      ...giveaway,
      status: "drawn",
      me: {
        kind: "won",
        userId: "u1",
        n: 0,
        entry: { tickets: 3, group: "follower" },
        claimRemainingMs,
        claim,
        chatClaimAvailable,
        answers: null,
      },
    }),
})

it("never offers the support page to a viewer, even after a draw", async () => {
  const requests = mockFetch({
    ...wonRoute(60_000, { state: "claimed", at: claimedAt, via: "chat" }),
    "GET /api/session": () => ok(supportedSession),
  })

  const view = renderApp("/ABCDE")

  await view.findByRole("heading", { level: 1 })
  expect(view.queryByRole("link", { name: /Support/ })).toBeNull()
  expect(requests.some((request) => request.route === "GET /api/session")).toBe(false)
})

describe("run-your-own invitation", () => {
  it("invites a viewer to the home page of the same instance with the referral marker", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    const link = await view.findByRole("link", { name: "Run your own giveaway with Rafflink" })
    expect(link.getAttribute("href")).toBe("/?ref=giveaway")
    expect(link.getAttribute("target")).toBeNull()
  })
})

describe("organizer line", () => {
  it("names the streamer as the organizer in the rules and says Rafflink is not", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, streamerName: "Ada" }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Organized by Ada. Rafflink is not the organizer.")).toBeTruthy()
  })
})

const withRules = (changes: Partial<typeof rules>) => ({
  "GET /api/g/ABCDE": () => ok({ ...giveaway, rules: { ...rules, ...changes } }),
})

describe("official rules", () => {
  it("builds the rules from the giveaway settings with the streamer as organizer", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    for (const line of [
      "Organized by Streamy. Rafflink is not the organizer.",
      "Twitch does not sponsor, endorse or run this giveaway and is not connected to it.",
      "Prize: A gaming chair",
      "To enter, sign in with Twitch on this page.",
      "Entering is free. You do not have to buy anything to enter or to win.",
      "Everyone can enter.",
      "A moderator has 7x the chance of a viewer.",
      "Accounts Streamy has blocked cannot enter.",
      "Streamy cannot enter their own giveaway.",
      "Entries end when Streamy closes them.",
      "Winners are drawn at random, weighted by tickets, from a public random number (drand) that nobody here controls.",
      "Anyone can check the draw at http://rafflink.test/ABCDE/verify",
      "Until the winner claims the prize, Streamy can replace them with a new draw.",
      "Streamy hands over the prize. Rafflink does not hold or send prizes.",
      "These rules are made from the giveaway's settings. They are a template, not legal advice.",
    ]) {
      expect(await view.findByText(line)).toBeTruthy()
    }
    expect(view.queryByText(/years old/)).toBeNull()
    expect(view.queryByText(/no free way to enter/)).toBeNull()
    expect(view.queryByText(/fills a short form/)).toBeNull()
  })

  it("says the winner fills the delivery form and who reads it when the giveaway has one", async () => {
    mockFetch(withRules({ winnerForm: ["name", "address"] }))

    const view = renderApp("/ABCDE")

    expect(
      await view.findByText(
        "After claiming, the winner fills a short form on this page for the delivery (Name, Shipping address). Only Streamy sees the answers. They are deleted when the prize is delivered, at the latest 30 days after the claim.",
      ),
    ).toBeTruthy()
  })

  it("names the chat keyword as a way to enter", async () => {
    mockFetch(withRules({ chatKeyword: "!enter", pageEntry: false }))

    const view = renderApp("/ABCDE")

    expect(
      await view.findByText(
        `To enter, type "!enter" in Streamy's Twitch chat while entries are open.`,
      ),
    ).toBeTruthy()
    expect(view.queryByText("To enter, sign in with Twitch on this page.")).toBeNull()
  })

  it("names sub and points entry beside the free way, with no extra tickets for points", async () => {
    mockFetch(withRules({ subEntry: true, pointsReward: { id: "r-1", title: "Join" } }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("To enter, sign in with Twitch on this page.")).toBeTruthy()
    expect(
      view.getByText(
        "Subscribing to Streamy, resubscribing or receiving a gift sub while entries are open also enters you. You never have to subscribe to enter.",
      ),
    ).toBeTruthy()
    expect(
      view.getByText(
        'Redeeming the "Join" channel point reward while entries are open also enters you once, with no extra tickets.',
      ),
    ).toBeTruthy()
  })

  it("warns that a subscribers-only giveaway has no free way to enter, and keeps the platform line", async () => {
    mockFetch(withRules({ subsOnly: true }))

    const view = renderApp("/ABCDE")

    expect(
      await view.findByText(
        "Only subscribers can enter, so there is no free way to enter this giveaway.",
      ),
    ).toBeTruthy()
    expect(view.queryByText(/Entering is free/)).toBeNull()
    expect(
      view.getByText(
        "Twitch does not sponsor, endorse or run this giveaway and is not connected to it.",
      ),
    ).toBeTruthy()
  })

  it("warns when only subscribers get tickets although everyone may enter", async () => {
    mockFetch(
      withRules({ tickets: { ...rules.tickets, viewer: 0, follower: 0, vip: 0, moderator: 0 } }),
    )

    const view = renderApp("/ABCDE")

    expect(
      await view.findByText(
        "Only subscribers can enter, so there is no free way to enter this giveaway.",
      ),
    ).toBeTruthy()
  })

  it("says neither free entry nor subscribers only when only VIPs and moderators get tickets", async () => {
    mockFetch(withRules({ tickets: { ...rules.tickets, viewer: 0, follower: 0, vip: 6 } }))

    const view = renderApp("/ABCDE")

    await view.findByText("Organized by Streamy. Rafflink is not the organizer.")
    expect(view.queryByText(/no free way to enter/)).toBeNull()
    expect(view.queryByText(/Entering is free/)).toBeNull()
  })

  it("does not say everyone can enter when viewers get no tickets", async () => {
    mockFetch(withRules({ tickets: { ...rules.tickets, viewer: 0 } }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Only the groups that get tickets can enter.")).toBeTruthy()
    expect(view.getByText("Viewers get no tickets and cannot win.")).toBeTruthy()
    expect(view.queryByText(/Everyone can enter/)).toBeNull()
  })

  it("leaves a group the platform cannot tell out of the odds and the ticket lines", async () => {
    const copied = stubClipboard(false)
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          capabilities: { ...giveaway.capabilities, vip: false },
          rules: { ...rules, tickets: { ...rules.tickets, vip: 10 } },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("A moderator has 7x the chance of a viewer.")).toBeTruthy()
    expect(view.queryByText(/VIP/)).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Copy rules as text" }))
    await waitFor(() => expect(copied).toHaveLength(1))
    expect(copied[0]).not.toContain("VIP")
  })

  it("says entries may close before the set end time", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, closesAt: claimedAt }) })

    const view = renderApp("/ABCDE")

    expect(
      await view.findByText(`Entries end ${claimedAtText}, or earlier if Streamy closes them.`),
    ).toBeTruthy()
  })

  it("shows the minimum age, the excluded places and the extra terms as written", async () => {
    mockFetch(
      withRules({
        minAge: 18,
        excludedCountries: "Quebec, Italy.",
        extraTerms: "Ships in the EU only.",
      }),
    )

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Winners must be at least 18 years old.")).toBeTruthy()
    expect(
      view.getByText("People who live in these places cannot win: Quebec, Italy."),
    ).toBeTruthy()
    expect(
      view.getByText(
        "Rafflink cannot check age or where someone lives. Streamy may check this and withhold the prize.",
      ),
    ).toBeTruthy()
    expect(view.getByText("More terms from Streamy:")).toBeTruthy()
    expect(view.getByText("Ships in the EU only.")).toBeTruthy()
  })

  it("copies the rules as plain text", async () => {
    const copied = stubClipboard(false)
    mockFetch(withRules({ minAge: 18, extraTerms: "Ships in the EU only." }))

    const view = renderApp("/ABCDE")
    fireEvent.click(await view.findByRole("button", { name: "Copy rules as text" }))

    await waitFor(() => expect(copied).toHaveLength(1))
    const lines = copied[0]?.split("\n") ?? []
    expect(lines[0]).toBe("Giveaway rules: http://rafflink.test/ABCDE")
    expect(lines).toContain("Organized by Streamy. Rafflink is not the organizer.")
    expect(lines).toContain("Moderators: 7 tickets")
    expect(lines).toContain("Winners must be at least 18 years old.")
    expect(lines).toContain("More terms from Streamy:")
    expect(lines).toContain("Ships in the EU only.")
    expect(lines.at(-1)).toBe(
      "These rules are made from the giveaway's settings. They are a template, not legal advice.",
    )
  })

  it("say in a translation that the English rules prevail, on the page and in the copied text", async () => {
    const prevails = "Toto je preklad. Ak sa líši od anglickej verzie, platí anglická verzia."
    window.localStorage.setItem("rafflink-language", "sk")
    const copied = stubClipboard(false)
    mockFetch(giveawayRoute)
    try {
      const view = renderApp("/ABCDE")

      expect(await view.findByText(prevails)).toBeTruthy()
      fireEvent.click(view.getByRole("button", { name: "Kopírovať pravidlá ako text" }))
      await waitFor(() => expect(copied).toHaveLength(1))
      expect(copied[0]?.split("\n").at(-1)).toBe(prevails)
    } finally {
      window.localStorage.clear()
    }
  })
})

// The "Who can enter" row above the rules; the rules list repeats its sentences one by one.
async function whoRow(view: RenderResult): Promise<string> {
  const label = await view.findByText("Who can enter")
  return label.nextElementSibling?.textContent ?? ""
}

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
    expect(await whoRow(view)).toMatch(/Only followers can enter\./)
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

  it.each([
    [{ kind: "giveaways", count: 3 }, /Winners of the streamer's last 3 giveaways cannot enter\./],
    [{ kind: "giveaways", count: 1 }, /Winners of the streamer's last giveaway cannot enter\./],
    [
      { kind: "days", count: 30 },
      /Winners of the streamer's giveaways from the last 30 days cannot enter\./,
    ],
    [
      { kind: "days", count: 1 },
      /Winners of the streamer's giveaways from the last day cannot enter\./,
    ],
  ])(
    "says who is kept out as recent winners (%j) next to who can enter",
    async (rule, sentence) => {
      mockFetch({
        "GET /api/g/ABCDE": () =>
          ok({ ...giveaway, rules: { ...giveaway.rules, excludeRecentWinners: rule } }),
      })

      const view = renderApp("/ABCDE")

      expect(await whoRow(view)).toMatch(sentence)
      expect(await whoRow(view)).toMatch(/Everyone can enter\./)
    },
  )

  it("adds no recent-winners sentence when the giveaway keeps none out", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(await whoRow(view)).toMatch(/Everyone can enter\./)
    expect(view.queryByText(/Winners of the streamer/)).toBeNull()
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
    expect(view.getByText("Winners have 5 minutes to claim.")).toBeTruthy()
    expect(view.getByText(/Some viewers get extra tickets/)).toBeTruthy()
  })

  it("lists only the groups the giveaway's platform can tell", async () => {
    const capabilities = { ...giveaway.capabilities, followerCheck: false, vip: false }
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          capabilities,
          rules: { ...giveaway.rules, tickets: { ...giveaway.rules.tickets, follower: 0, vip: 0 } },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Subscribers, tier 2: 4 tickets")).toBeTruthy()
    expect(view.getByText("Moderators: 7 tickets")).toBeTruthy()
    expect(view.queryByText(/^Followers:/)).toBeNull()
    expect(view.queryByText(/^VIPs:/)).toBeNull()
  })

  it("offers one Enter with Twitch button and no step count before the sign-in starts", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    expect(
      (await view.findByRole("link", { name: "Enter with Twitch" })).getAttribute("href"),
    ).toBe("/auth/twitch/viewer/start?giveaway=ABCDE")
    expect(view.queryByRole("list", { name: "Steps" })).toBeNull()
  })

  it("signs a viewer of a Kick giveaway in with Kick", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, platform: "kick" }) })

    const view = renderApp("/ABCDE")

    expect((await view.findByRole("link", { name: "Enter with Kick" })).getAttribute("href")).toBe(
      "/auth/kick/viewer/start?giveaway=ABCDE",
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

    const view = renderApp("/ABCDE?entry=not-eligible&reason=subs-only")

    expect(await view.findByText("This giveaway is for subscribers only.")).toBeTruthy()
    expect(
      view.getByText("Subscribe to the channel on Twitch, then open this link again."),
    ).toBeTruthy()
    expect(view.queryByRole("link", { name: "Enter with Twitch" })).toBeNull()
  })

  it("tells a blocked viewer only that they cannot enter, without naming a block", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=blocked")

    expect(await view.findByText("You cannot enter this giveaway.")).toBeTruthy()
    expect(view.getByText("If you have questions, ask the streamer.")).toBeTruthy()
    // The general rule every viewer reads is the only mention of blocking.
    expect(view.queryAllByText(/block/i).map((element) => element.textContent)).toEqual([
      "Accounts Streamy has blocked cannot enter.",
    ])
    expect(view.queryByRole("link", { name: "Use another Twitch account" })).toBeNull()
  })

  it("tells a recent winner why they cannot enter and when they can again", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=recent-winner")

    expect(
      await view.findByText(
        "You won one of this streamer's recent giveaways, so you cannot enter this one.",
      ),
    ).toBeTruthy()
    expect(
      view.getByText(
        "You can enter again once your win is no longer among their recent giveaways.",
      ),
    ).toBeTruthy()
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

  it("says Too many attempts with a way to enter again", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=rate-limited")

    expect(await view.findByRole("heading", { name: "Too many attempts" })).toBeTruthy()
    expect(view.getByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
  })

  it.each(["invalid-state", "dropped"])("offers Enter with Twitch again after %s", async (kind) => {
    mockFetch(giveawayRoute)

    const view = renderApp(`/ABCDE?entry=${kind}`)

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
  })

  it("replaces the address with the plain page path once the queued entry settled", async () => {
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () =>
        ok({ kind: "entered", entry: { group: "viewer", tickets: 1, enteredAt: 1 } }),
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1")
    expect(view.address()).toBe("/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("heading", { name: "You are in" })).toBeTruthy()
    await waitFor(() => expect(view.address()).toBe("/ABCDE"))
  })

  it("replaces the address too when the poll runs past its maximum", async () => {
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "pending", ticket: "T1" }),
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByRole("link", { name: "Enter with Twitch" })).toBeTruthy()
    await waitFor(() => expect(view.address()).toBe("/ABCDE"))
  })

  it("keeps other query parameters when it forgets the entry", async () => {
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1&utm=x")

    expect(await view.findByRole("heading", { name: "Sorry, giveaway closed." })).toBeTruthy()
    await waitFor(() => expect(view.address()).toBe("/ABCDE?utm=x"))
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

const claimedWithForm = (answers: string) => ({
  "GET /api/g/ABCDE": () =>
    ok({
      ...giveaway,
      status: "drawn",
      streamerName: "Ada",
      rules: { ...giveaway.rules, winnerForm: ["name", "email"] },
      me: {
        kind: "won",
        userId: "u1",
        n: 0,
        entry: null,
        claimRemainingMs: 0,
        claim: { state: "claimed", at: claimedAt, via: "rafflink" },
        chatClaimAvailable: true,
        answers,
      },
    }),
})

describe("winner form", () => {
  it("asks a claimed winner for the fields once, names the streamer as the recipient and sends the answers", async () => {
    const requests = mockFetch({
      ...claimedWithForm("open"),
      "POST /api/g/ABCDE/answers": () => ok({ kind: "saved" }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { name: "Where should the prize go?" })).toBeTruthy()
    expect(view.getByText(/Only Ada, who runs this giveaway, sees your answers/)).toBeTruthy()
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Ann" } })
    fireEvent.change(view.getByLabelText("E-mail"), { target: { value: "ann@example.com" } })
    fireEvent.click(view.getByRole("button", { name: "Send" }))

    expect(await view.findByText("Your answers were sent to the streamer.")).toBeTruthy()
    expect(view.queryByRole("button", { name: "Send" })).toBeNull()
    expect(requests.find((request) => request.route === "POST /api/g/ABCDE/answers")?.body).toEqual(
      { answers: { name: "Ann", email: "ann@example.com" } },
    )
  })

  it("shows no form to a winner who already sent it", async () => {
    mockFetch(claimedWithForm("sent"))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Your answers were sent to the streamer.")).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Where should the prize go?" })).toBeNull()
  })
})

describe("winner claim", () => {
  it("shows the You won card with the time left and claims with one button", async () => {
    const requests = mockFetch({
      ...wonRoute(90_000, { state: "waiting" }),
      "POST /api/g/ABCDE/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/ABCDE")

    const heading = await view.findByRole("heading", { name: "You won" })
    // The page heading shows the prize; the win announcement says it for screen readers only.
    expect(heading.parentElement?.querySelector(".sr-only")?.textContent).toBe("A gaming chair")
    expect(view.getByRole("timer").textContent).toMatch(/^1:(29|30)$/)
    expect(view.getByText("left to claim")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Claim my prize" }))
    expect(await view.findByText("Claimed! The streamer will contact you.")).toBeTruthy()
    expect(view.queryByRole("button", { name: "Claim my prize" })).toBeNull()
    expect(requests.map((request) => request.route)).toContain("POST /api/g/ABCDE/claim")
  })

  it("shows the winner their own tickets and group", async () => {
    mockFetch(wonRoute(90_000, { state: "waiting" }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Your entry: 3 tickets as a follower.")).toBeTruthy()
  })

  it("shows the won screen without the ticket box once the entry was deleted", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          status: "drawn",
          me: {
            kind: "won",
            userId: "u1",
            n: 0,
            entry: null,
            claimRemainingMs: 90_000,
            claim: { state: "waiting" },
            chatClaimAvailable: true,
            answers: null,
          },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("heading", { name: "You won" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()
    expect(view.queryByText(/Your entry:/)).toBeNull()
  })

  it("shows a claimed winner their tickets and when the prize was claimed", async () => {
    mockFetch(wonRoute(0, { state: "claimed", at: claimedAt, via: "chat" }))

    const view = renderApp("/ABCDE")

    expect(await view.findByText(`Claimed on ${claimedAtText}.`)).toBeTruthy()
    expect(view.getByText("Your entry: 3 tickets as a follower.")).toBeTruthy()
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
            entry: { tickets: 3, group: "follower" },
            claimRemainingMs: 90_000,
            claim: { state: "waiting" },
            chatClaimAvailable: true,
            answers: null,
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
    mockFetch(wonRoute(5000, { state: "claimed", at: 1, via: "chat" }))

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
    mockFetch(wonRoute(5000, { state: "claimed", at: 1, via: "chat" }))

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
    const channel = view.getByRole("link", { name: "Watch Streamy on Twitch" })
    expect(channel.getAttribute("target")).toBe("_blank")
    expect(channel.getAttribute("rel")).toBe("noopener noreferrer")
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

describe("chat entry", () => {
  const chatGiveaway = { ...giveaway, rules: { ...giveaway.rules, chatKeyword: "!enter" } }

  it("shows no chat way in for a giveaway without a chat keyword", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE")

    await view.findByRole("heading", { level: 1 })
    expect(view.queryByRole("button", { name: "Am I in?" })).toBeNull()
  })

  it("tells the keyword and answers yes or no for a login", async () => {
    const requests = mockFetch({
      "GET /api/g/ABCDE": () => ok(chatGiveaway),
      "GET /api/g/ABCDE/entered?login=fan": () => ok({ entered: true }),
      "GET /api/g/ABCDE/entered?login=nobody": () => ok({ entered: false }),
    })
    const view = renderApp("/ABCDE")

    expect(await view.findByText("Or type !enter in the chat of Streamy to enter.")).toBeTruthy()
    fireEvent.change(view.getByLabelText("Your username"), { target: { value: " fan " } })
    fireEvent.click(view.getByRole("button", { name: "Am I in?" }))
    expect(await view.findByText("fan is in the giveaway.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Your username"), { target: { value: "nobody" } })
    fireEvent.click(view.getByRole("button", { name: "Am I in?" }))
    expect(await view.findByText(/^nobody is not in the giveaway yet\./)).toBeTruthy()
    expect(requests.filter((request) => request.route.includes("/entered"))).toHaveLength(2)
  })

  it("offers no sign-in on an open chat-only giveaway, only the keyword and the lookup", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({ ...chatGiveaway, rules: { ...chatGiveaway.rules, pageEntry: false } }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Or type !enter in the chat of Streamy to enter.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Am I in?" })).toBeTruthy()
    expect(view.queryByRole("link", { name: /Enter with Twitch|Sign in/ })).toBeNull()
  })

  it("hides the keyword while chat entry is off and keeps the lookup", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...chatGiveaway, chatEntryOff: true }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByRole("button", { name: "Am I in?" })).toBeTruthy()
    expect(view.queryByText("Or type !enter in the chat of Streamy to enter.")).toBeNull()
  })

  it("says the check did not work when the lookup fails", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    mockFetch({
      "GET /api/g/ABCDE": () => ok(chatGiveaway),
      "GET /api/g/ABCDE/entered?login=fan": () => ({ status: 500, body: {} }),
    })
    const view = renderApp("/ABCDE")

    fireEvent.change(await view.findByLabelText("Your username"), {
      target: { value: "fan" },
    })
    fireEvent.click(view.getByRole("button", { name: "Am I in?" }))

    expect(await view.findByText("The check did not work. Try again.")).toBeTruthy()
  })
})
