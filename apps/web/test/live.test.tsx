import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, within } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { reconnectDelayMs } from "../src/lib/use-live.ts"
import { stubClipboard } from "./clipboard.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { liveSnapshot } from "./fixtures.ts"
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

const drawn: LiveSnapshot = {
  ...liveSnapshot,
  status: "drawn",
  winners: [
    { n: 0, displayName: "Wanda", claimUntil: Date.now() + 120_000, claim: { state: "waiting" } },
    { n: 1, displayName: "Bob", claimUntil: 1, claim: { state: "claimed", via: "chat" } },
    { n: 2, displayName: "Eve", claimUntil: 1, claim: { state: "expired" } },
  ],
}

function winnerRow(view: ReturnType<typeof renderApp>, name: string): HTMLElement {
  const row = view.getByText(new RegExp(`^\\d+\\. ${name}$`)).closest("li")
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

describe("live page: collecting entries", () => {
  it("renders the snapshot with labelled numbers and then every push of the socket", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Ada")).toBeTruthy()
    expect(view.getByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
    expect(view.getByText(/Code ABCDE/)).toBeTruthy()
    expect(view.getByText("people entered")).toBeTruthy()
    expect(view.getByText("people entered").nextElementSibling?.textContent).toBe("3")
    expect(view.getByText("1.5")).toBeTruthy()
    expect(view.getByText("entries per second")).toBeTruthy()
    expect(view.getByText("tickets in total")).toBeTruthy()
    expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/live/gid-1")
    act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 9, lastNames: ["Cy"] }))
    expect(await view.findByText("Cy")).toBeTruthy()
    expect(view.getByText("9")).toBeTruthy()
  })

  it("names the giveaway by its code when the title is missing", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, title: null }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { level: 1, name: "Giveaway ABCDE" })).toBeTruthy()
  })

  it("says nobody has entered yet when the list is empty", async () => {
    mockFetch({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, entrantCount: 0, lastNames: [] }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Nobody has entered yet.")).toBeTruthy()
  })

  it("shows where the streamer is in three steps", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Step 1 of 3: Collect entries")).toBeTruthy()
    expect(view.getByText("Entries open")).toBeTruthy()
  })

  it("offers the link and a chat message to copy while entries are open", async () => {
    const copied = stubClipboard(false)
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Copy chat message" }))

    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["Enter the giveaway: http://rafflink.test/ABCDE"])
    expect(view.getByLabelText("Your link").getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
  })

  it("asks before it closes entries, and sends nothing when the streamer cancels", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/close": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Close entries" }))

    expect(view.getByText("Close entries now?")).toBeTruthy()
    expect(view.getByText("Nobody new can enter after this. You cannot undo it.")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Cancel" }))
    expect(view.getByRole("button", { name: "Close entries" })).toBeTruthy()
    expect(requests.map((request) => request.route)).toEqual(["GET /api/live/gid-1"])
  })

  it("closes the question without sending anything when the dialog is dismissed", async () => {
    const requests = mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Close entries" }))
    const dialog = view.getByRole("dialog", { name: "Close entries now?" })
    fireEvent(dialog, new Event("cancel", { cancelable: true }))

    expect(view.queryByRole("dialog")).toBeNull()
    expect(requests.map((request) => request.route)).toEqual(["GET /api/live/gid-1"])
  })

  it("closes entries once the streamer confirms", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/close": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Close entries" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, close entries" }))

    expect(await view.findByText("Entries closed.")).toBeTruthy()
    expect(requests.at(-1)?.route).toBe("POST /api/dash/giveaways/gid-1/close")
  })

  it("moves the keyboard focus between the question and the button", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Close entries" }))
    expect(view.getByRole("button", { name: "Cancel" }) === document.activeElement).toBe(true)
    fireEvent.click(view.getByRole("button", { name: "Cancel" }))

    expect(view.getByRole("button", { name: "Close entries" }) === document.activeElement).toBe(
      true,
    )
  })

  it("shows the failure counters as plain sentences under Problems", async () => {
    mockFetch({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, roleRefreshFailures: 4, eventSubFailures: 2 }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Problems" })).toBeTruthy()
    expect(
      view.getByText(/4 times Rafflink could not load your VIP and moderator lists/),
    ).toBeTruthy()
    expect(view.getByText(/2 times Rafflink lost the connection to your chat/)).toBeTruthy()
  })

  it("hides Problems while both counters are zero", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    expect(view.queryByRole("heading", { name: "Problems" })).toBeNull()
  })
})

describe("live page: drawing", () => {
  it("draws the chosen number of winners after a confirmation that names the number", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }),
      "POST /api/dash/giveaways/gid-1/draw": () => ok({ kind: "drawn", winners: [0, 1] }),
    })

    const view = renderApp("/live/gid-1")
    expect(await view.findByText("Step 2 of 3: Draw winners")).toBeTruthy()
    expect(
      view.getByText("3 people entered. Now choose how many winners you want and draw them."),
    ).toBeTruthy()
    fireEvent.change(view.getByLabelText("How many winners?"), { target: { value: "2" } })
    fireEvent.click(view.getByRole("button", { name: "Draw winners" }))
    expect(view.getByText("Draw 2 winners now?")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Yes, draw winners" }))

    expect(await view.findByText("Winners drawn.")).toBeTruthy()
    expect(requests.at(-1)?.body).toEqual({ count: 2 })
  })

  it("asks about one winner in the singular", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw winners" }))

    expect(view.getByText("Draw 1 winner now?")).toBeTruthy()
  })

  it.each(["0", "-1", "1.5", ""])("disables Draw winners for %p and says why", async (count) => {
    mockFetch({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("How many winners?"), { target: { value: count } })

    expect(view.getByText("Enter a whole number of winners, at least 1.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winners" }).hasAttribute("disabled")).toBe(true)
  })

  it("disables Draw winners when nobody entered and says why", async () => {
    mockFetch({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, status: "closed", entrantCount: 0, lastNames: [] }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Nobody entered, so there is nobody to draw.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winners" }).hasAttribute("disabled")).toBe(true)
  })

  it("warns, without blocking, when more winners are asked for than entered", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("How many winners?"), { target: { value: "9" } })

    expect(view.getByText("Only 3 entered, so you may get fewer winners than this.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winners" }).hasAttribute("disabled")).toBe(false)
  })
})

describe("live page: winners", () => {
  it("shows winners with how they claimed and a countdown for the one still waiting", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claimed in chat")).toBeTruthy()
    expect(view.getByText("Step 3 of 3: Winners claim")).toBeTruthy()
    expect(view.getByText("Waiting to claim")).toBeTruthy()
    expect(view.getByText("Claim time ran out")).toBeTruthy()
    expect(within(winnerRow(view, "Wanda")).getByRole("timer").textContent).toMatch(/^[12]:\d\d$/)
    expect(within(winnerRow(view, "Bob")).queryByRole("timer")).toBeNull()
  })

  it("asks before it picks another winner and names who loses the prize", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ok({ kind: "rerolled", pick: 3 }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")
    fireEvent.click(
      within(winnerRow(view, "Eve")).getByRole("button", { name: "Pick another winner" }),
    )

    expect(view.getByText("Pick another winner instead of Eve?")).toBeTruthy()
    expect(view.getByText("Eve loses the prize. This cannot be undone.")).toBeTruthy()
    expect(requests.map((request) => request.route)).toEqual(["GET /api/live/gid-1"])
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("Another winner was picked.")).toBeTruthy()
    expect(requests.at(-1)).toEqual({
      route: "POST /api/dash/giveaways/gid-1/reroll",
      body: { n: 2 },
    })
  })

  it("offers Pick another winner only where it makes sense", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(
      within(winnerRow(view, "Wanda")).getByRole("button", { name: "Pick another winner" }),
    ).toBeTruthy()
    expect(
      within(winnerRow(view, "Eve")).getByRole("button", { name: "Pick another winner" }),
    ).toBeTruthy()
    expect(within(winnerRow(view, "Bob")).queryByRole("button")).toBeNull()
  })

  it("says when the server refuses to pick another winner", async () => {
    mockFetch({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ({
        status: 409,
        body: { kind: "no-entrants-left" },
      }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")
    fireEvent.click(
      within(winnerRow(view, "Wanda")).getByRole("button", { name: "Pick another winner" }),
    )
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("No entrants are left to pick.")).toBeTruthy()
  })

  it("explains that chat watch is off and marks a claim by hand", async () => {
    const requests = mockFetch({
      "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: true }),
      "POST /api/dash/giveaways/gid-1/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Chat watch is off" })).toBeTruthy()
    expect(view.getByText(/Chat claim unavailable/)).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Mark as claimed for Wanda" }))
    expect(await view.findByText("Marked as claimed.")).toBeTruthy()
    expect(requests.at(-1)).toEqual({
      route: "POST /api/dash/giveaways/gid-1/claim",
      body: { n: 0 },
    })
    expect(view.getAllByRole("button", { name: /Mark as claimed/ })).toHaveLength(1)
  })

  it("offers no manual claim and no banner while chat watch works", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Waiting to claim")

    expect(view.queryByRole("heading", { name: "Chat watch is off" })).toBeNull()
    expect(view.queryByRole("button", { name: /Mark as claimed/ })).toBeNull()
  })
})

describe("live page: access and connection", () => {
  it("asks for a sign-in without a session", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  it("answers not found for the giveaway of another streamer", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Giveaway not found")).toBeTruthy()
  })

  it("reconnects after the socket drops and says so meanwhile", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    act(() => FakeSocket.opened[0]?.drop())

    expect(await view.findByText("Reconnecting to the live feed…")).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(0) + 200))
    expect(FakeSocket.opened.length).toBe(2)
  })

  it("ignores a push that is not a snapshot", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    act(() => FakeSocket.opened[0]?.push({ nonsense: true }))

    expect(view.getByText("Ada")).toBeTruthy()
  })
})

describe("reconnect delay", () => {
  it("doubles from one second and stops at the cap", () => {
    expect([0, 1, 2, 5, 6, 50].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 30_000, 30_000, 30_000,
    ])
  })
})

describe("live page: overlay link", () => {
  it("shows the overlay link with the OBS steps when the live answer carries the token", async () => {
    const copied = stubClipboard(false)
    mockFetch({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

    const view = renderApp("/live/gid-1")

    expect(
      await view.findByText("In OBS, find the Sources box and press the + button."),
    ).toBeTruthy()
    const field = view.getByLabelText("Overlay link")
    expect(field instanceof HTMLInputElement && field.value).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
    fireEvent.click(view.getByRole("button", { name: "Copy overlay link" }))
    await view.findByText("Copied!")
    expect(copied).toEqual(["http://rafflink.test/overlay/gid-1/tok-1"])
  })

  it("keeps the overlay link when a socket push arrives", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")
    act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, lastNames: ["Cy"] }))

    expect(await view.findByText("Cy")).toBeTruthy()
    expect(view.getByLabelText("Overlay link")).toBeTruthy()
  })

  it("shows no overlay link when the answer carries no token", async () => {
    mockFetch({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    await view.findByText("Ada")
    expect(view.queryByLabelText("Overlay link")).toBeNull()
  })
})
