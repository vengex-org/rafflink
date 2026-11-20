import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const giveawayRoute = { "GET /api/g/ABCDE": () => ok(giveaway) }

describe("giveaway page", () => {
  it("shows the reason when not eligible", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/g/ABCDE?entry=not-eligible&reason=subs-only")

    expect(await view.findByText("This giveaway is for subscribers only.")).toBeTruthy()
    expect(view.queryByText("Enter with Twitch")).toBeNull()
  })

  it("shows title, prize, rules and the entrant count with a sign-in link", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          rules: {
            ...giveaway.rules,
            followersOnly: true,
            minAccountAgeDays: 30,
            claimKeyword: "mine",
          },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Summer giveaway")).toBeTruthy()
    expect(view.getByText("A gaming chair")).toBeTruthy()
    expect(view.getByText("42 entered so far")).toBeTruthy()
    expect(view.getByText("Followers only")).toBeTruthy()
    expect(view.getByText("Account at least 30 days old")).toBeTruthy()
    expect(view.getByText("Sub tier 2: 4 tickets")).toBeTruthy()
    expect(view.getByText(/mine/)).toBeTruthy()
    expect(view.getByText("Enter with Twitch").getAttribute("href")).toBe(
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

  it("greets an entered viewer with You are in", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=entered")

    expect(await view.findByText("You are in")).toBeTruthy()
    expect(view.queryByText("Enter with Twitch")).toBeNull()
  })

  it("keeps the first entry and says You are in again", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=already-in")

    expect(await view.findByText("You are in")).toBeTruthy()
    expect(view.getByText("Your first entry is kept.")).toBeTruthy()
  })

  it("says giveaway closed and offers no sign-in", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "closed" }) })

    const view = renderApp("/ABCDE?entry=closed")

    expect(await view.findByText(/giveaway closed/)).toBeTruthy()
    expect(view.queryByText("Enter with Twitch")).toBeNull()
  })

  it.each(["try-again", "invalid-state", "dropped"])(
    "offers Enter with Twitch again after %s",
    async (kind) => {
      mockFetch(giveawayRoute)

      const view = renderApp(`/ABCDE?entry=${kind}`)

      expect(await view.findByText("Enter with Twitch")).toBeTruthy()
    },
  )

  it("ignores an entry outcome it does not know", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=won-the-lottery")

    expect(await view.findByText("Enter with Twitch")).toBeTruthy()
  })

  it("ignores a not-eligible outcome with an unknown reason", async () => {
    mockFetch(giveawayRoute)

    const view = renderApp("/ABCDE?entry=not-eligible&reason=constructor")

    expect(await view.findByText("Enter with Twitch")).toBeTruthy()
    expect(view.queryByText("You cannot enter")).toBeNull()
  })

  it("turns a pending entry into entered by polling", async () => {
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

    expect(await view.findByText("You are being entered")).toBeTruthy()
    expect(await view.findByText("You are in")).toBeTruthy()
    expect(polls).toBe(3)
  })

  it("offers Enter with Twitch when the poll runs past its maximum", async () => {
    mockFetch({
      ...giveawayRoute,
      "GET /api/g/ABCDE/pending/T1": () => ok({ kind: "pending", ticket: "T1" }),
    })

    const view = renderApp("/ABCDE?entry=pending&ticket=T1")

    expect(await view.findByText("You are being entered")).toBeTruthy()
    expect(await view.findByText("Enter with Twitch", {}, { timeout: 1000 })).toBeTruthy()
    expect(view.queryByText("You are being entered")).toBeNull()
  })

  it("shows You won, the remaining claim time and a Claim button that claims", async () => {
    const requests = mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          status: "drawn",
          win: { n: 0, claimRemainingMs: 90_000, claim: { state: "waiting" } },
        }),
      "POST /api/g/ABCDE/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("You won")).toBeTruthy()
    expect(view.getByRole("timer").textContent).toMatch(/^1:(29|30)$/)
    fireEvent.click(view.getByText("Claim"))
    expect(await view.findByText("Claimed. The streamer will contact you.")).toBeTruthy()
    expect(requests.map((request) => request.route)).toContain("POST /api/g/ABCDE/claim")
  })

  it("tells a winner whose claim time ran out", async () => {
    mockFetch({
      "GET /api/g/ABCDE": () =>
        ok({
          ...giveaway,
          status: "drawn",
          win: { n: 0, claimRemainingMs: 0, claim: { state: "waiting" } },
        }),
    })

    const view = renderApp("/ABCDE")

    expect(await waitFor(() => view.getByText("The claim time ran out."))).toBeTruthy()
    expect(view.queryByText("Claim")).toBeNull()
  })

  it("asks a viewer of a drawn giveaway to sign in to see whether they won", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "drawn" }) })

    const view = renderApp("/ABCDE")

    expect(await view.findByText("Sign in with Twitch")).toBeTruthy()
  })
})
