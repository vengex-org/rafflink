import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { reconnectDelayMs } from "../src/lib/use-live.ts"
import { stubClipboard } from "./clipboard.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { giveaway, liveSnapshot } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

let restoreSocket = () => {}
beforeEach(() => {
  restoreSocket = installFakeSocket()
})
afterEach(() => {
  cleanup()
  mock.restore()
  restoreSocket()
  window.localStorage.clear()
})

/** `mockFetch` plus the public giveaway and an empty entrants list, which every streamer live page asks for. */
function mockLive(routes: Readonly<Record<string, () => Reply>>) {
  return mockFetch({
    "GET /api/g/ABCDE": () => ok(giveaway),
    "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    ...routes,
  })
}

const drawn: LiveSnapshot = {
  ...liveSnapshot,
  status: "drawn",
  rerollOpen: true,
  rerollBlocked: null,
  winners: [
    {
      n: 0,
      entrySeq: 1,
      displayName: "Wanda",
      claimUntil: Date.now() + 120_000,
      claim: { state: "waiting" },
    },
    {
      n: 1,
      entrySeq: 2,
      displayName: "Bob",
      claimUntil: 1,
      claim: { state: "claimed", via: "chat" },
    },
    { n: 2, entrySeq: 3, displayName: "Eve", claimUntil: 1, claim: { state: "expired" } },
  ],
}

const windowOver: LiveSnapshot = { ...drawn, rerollOpen: false, rerollBlocked: "window-over" }
const nobodyLeft: LiveSnapshot = { ...drawn, rerollOpen: false, rerollBlocked: "nobody-left" }

const windowOverText =
  "The time to pick another winner is over. Contact the winners who have not claimed, or start a new giveaway."
const nobodyLeftText =
  "Everyone who entered has been drawn. Contact the winners who have not claimed, or start a new giveaway."

/** The pill of an earlier pick; the winner on the plate has none. */
function pickPill(view: ReturnType<typeof renderApp>, name: string): HTMLElement {
  const pills = view.getByRole("list", { name: "Earlier picks" })
  const row = within(pills).getByText(name).closest("li")
  if (row === null) throw new Error(`no pill for ${name}`)
  return row
}

const plateName = (view: ReturnType<typeof renderApp>) =>
  view.container.querySelector(".winner-plate-name")?.textContent

const enteredCount = (view: ReturnType<typeof renderApp>) =>
  view.getByText("entered").previousElementSibling?.textContent

describe("live page: collecting entries", () => {
  it("renders the snapshot with labelled numbers and then every push of the socket", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Ada")).toBeTruthy()
    expect(view.getByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
    expect(await view.findByText("Streamy gives away A gaming chair")).toBeTruthy()
    expect(enteredCount(view)).toBe("3")
    expect(view.getByText("1.5")).toBeTruthy()
    expect(view.getByText("entries per second")).toBeTruthy()
    expect(view.getByText("5 tickets")).toBeTruthy()
    expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/live/gid-1")
    act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 9, lastNames: ["Cy"] }))
    expect(await view.findByText("Cy")).toBeTruthy()
    expect(enteredCount(view)).toBe("9")
  })

  it("names the giveaway by its code when the title is missing", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, title: null }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { level: 1, name: "Giveaway ABCDE" })).toBeTruthy()
  })

  it("says nobody has entered yet when the list is empty", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, entrantCount: 0, lastNames: [] }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Nobody has entered yet.")).toBeTruthy()
  })

  it("says that entries are open with the LIVE chip and the stage title", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Entries are open" })).toBeTruthy()
    expect(view.getByText("LIVE")).toBeTruthy()
  })

  it("shows the status in words instead of the LIVE chip once entries are closed", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Entries closed")).toBeTruthy()
    expect(view.queryByText("LIVE")).toBeNull()
  })

  it("leaves out what is given away when the public giveaway cannot be loaded", async () => {
    mockFetch({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    })
    const error = spyOn(console, "error").mockImplementation(() => {})

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(view.queryByText(/gives away/)).toBeNull()
  })

  it("offers the link and a chat message to copy while entries are open", async () => {
    const copied = stubClipboard(false)
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Copy chat message" }))

    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["Enter the giveaway: http://rafflink.test/ABCDE"])
    expect(view.getByLabelText("Your link").getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
  })

  it("asks before it closes entries, and sends nothing when the streamer cancels", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/close": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Closed" }))

    expect(view.getByText("Close entries now?")).toBeTruthy()
    expect(view.getByText("Nobody new can enter after this. You cannot undo it.")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Cancel" }))
    expect(view.getByRole("button", { name: "Closed" })).toBeTruthy()
    expect(requests.map((request) => request.route)).toEqual([
      "GET /api/live/gid-1",
      "GET /api/g/ABCDE",
      "GET /api/live/gid-1/entrants?after=0",
    ])
  })

  it("closes the question without sending anything when the dialog is dismissed", async () => {
    const requests = mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Closed" }))
    const dialog = view.getByRole("dialog", { name: "Close entries now?" })
    fireEvent(dialog, new Event("cancel", { cancelable: true }))

    expect(view.queryByRole("dialog")).toBeNull()
    expect(requests.map((request) => request.route)).toEqual([
      "GET /api/live/gid-1",
      "GET /api/g/ABCDE",
      "GET /api/live/gid-1/entrants?after=0",
    ])
  })

  it("closes entries once the streamer confirms", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/close": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Closed" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, close entries" }))

    expect(await view.findByText("Entries closed.")).toBeTruthy()
    expect(requests.at(-1)?.route).toBe("POST /api/dash/giveaways/gid-1/close")
  })

  it("moves the keyboard focus between the question and the button", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Closed" }))
    expect(view.getByRole("button", { name: "Cancel" }) === document.activeElement).toBe(true)
    fireEvent.click(view.getByRole("button", { name: "Cancel" }))

    expect(view.getByRole("button", { name: "Closed" }) === document.activeElement).toBe(true)
  })

  it("shows the failure counters as plain sentences under Problems", async () => {
    mockLive({
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
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    expect(view.queryByRole("heading", { name: "Problems" })).toBeNull()
  })
})

describe("live page: drawing", () => {
  it("draws the chosen number of winners after a confirmation that names the number", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }),
      "POST /api/dash/giveaways/gid-1/draw": () => ok({ kind: "drawn", winners: [0, 1] }),
    })

    const view = renderApp("/live/gid-1")
    expect(await view.findByRole("heading", { name: "Entries are closed" })).toBeTruthy()
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
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw winners" }))

    expect(view.getByText("Draw 1 winner now?")).toBeTruthy()
  })

  it.each(["0", "-1", "1.5", ""])("disables Draw winners for %p and says why", async (count) => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("How many winners?"), { target: { value: count } })

    expect(view.getByText("Enter a whole number of winners, at least 1.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winners" }).hasAttribute("disabled")).toBe(true)
  })

  it("disables Draw winners when nobody entered and says why", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, status: "closed", entrantCount: 0, lastNames: [] }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Nobody entered, so there is nobody to draw.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winners" }).hasAttribute("disabled")).toBe(true)
  })

  it("warns, without blocking, when more winners are asked for than entered", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("How many winners?"), { target: { value: "9" } })

    expect(view.getByText("Only 3 entered, so you may get fewer winners than this.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winners" }).hasAttribute("disabled")).toBe(false)
  })
})

describe("live page: winners", () => {
  it("shows winners with how they claimed and a countdown for the one still waiting", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claimed in chat")).toBeTruthy()
    expect(view.getByRole("heading", { name: "Winner 1 of 3" })).toBeTruthy()
    expect(view.getByText("Claim time ran out")).toBeTruthy()
    expect(view.container.querySelector(".live-ring [role=timer]")?.textContent).toMatch(
      /^[12]:\d\d$/,
    )
    expect(plateName(view)).toBe("Wanda")
    expect(within(pickPill(view, "Bob")).queryByRole("timer")).toBeNull()
    expect(within(pickPill(view, "Eve")).queryByRole("timer")).toBeNull()
  })

  it("shows the claim time once for the winner on the plate and keeps it on another waiting winner", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...drawn,
          winners: [
            {
              n: 0,
              entrySeq: 1,
              displayName: "Wanda",
              claimUntil: Date.now() + 120_000,
              claim: { state: "waiting" },
            },
            {
              n: 1,
              entrySeq: 2,
              displayName: "Cy",
              claimUntil: Date.now() + 60_000,
              claim: { state: "waiting" },
            },
          ],
        }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    expect(plateName(view)).toBe("Cy")
    expect(within(pickPill(view, "Wanda")).getByRole("timer").textContent).toMatch(/^[12]:\d\d$/)
    expect(view.getAllByRole("timer")).toHaveLength(2)
  })

  it.each([
    ["whose claim the stream waits for", 0, "Waiting for Wanda to claim the prize."],
    ["who claimed", 1, "Bob claimed the prize."],
    ["that nobody claimed", 2, "Nobody has claimed the prize yet."],
  ])("says in the controls bar %s", async (_name, skip, text) => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...drawn, winners: drawn.winners.slice(skip) }),
    })

    const view = renderApp("/live/gid-1")

    const bar = await view.findByRole("toolbar", { name: "Giveaway controls" })
    expect(within(bar).getByText(text)).toBeTruthy()
  })

  it("asks before it picks another winner and names who loses the prize", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ok({ kind: "rerolled", pick: 3 }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")
    fireEvent.click(
      within(pickPill(view, "Eve")).getByRole("button", { name: "Pick another winner" }),
    )

    expect(view.getByText("Pick another winner instead of Eve?")).toBeTruthy()
    expect(view.getByText("Eve loses the prize. This cannot be undone.")).toBeTruthy()
    expect(requests.map((request) => request.route)).toEqual([
      "GET /api/live/gid-1",
      "GET /api/g/ABCDE",
      "GET /api/live/gid-1/entrants?after=0",
    ])
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("Another winner was picked.")).toBeTruthy()
    expect(requests.at(-1)).toEqual({
      route: "POST /api/dash/giveaways/gid-1/reroll",
      body: { n: 2 },
    })
  })

  it("offers Pick another winner only where it makes sense", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(view.getByRole("button", { name: "Reroll Wanda" })).toBeTruthy()
    expect(
      within(pickPill(view, "Eve")).getByRole("button", { name: "Pick another winner" }),
    ).toBeTruthy()
    expect(view.getAllByRole("button", { name: /^Reroll|^Pick another winner/ })).toHaveLength(2)
    expect(within(pickPill(view, "Bob")).queryByRole("button")).toBeNull()
  })

  it("hides Pick another winner and says the time is over once the reroll window has ended", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(windowOver) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(view.queryByRole("button", { name: /^Reroll|^Pick another winner/ })).toBeNull()
    expect(view.getByText(windowOverText)).toBeTruthy()
    expect(view.queryByText(nobodyLeftText)).toBeNull()
  })

  it("says everyone was drawn when nobody is left to pick, instead of the time being over", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(nobodyLeft) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(view.queryByRole("button", { name: /^Reroll|^Pick another winner/ })).toBeNull()
    expect(view.getByText(nobodyLeftText)).toBeTruthy()
    expect(view.queryByText(windowOverText)).toBeNull()
  })

  it("shows no reroll explanation when every winner has claimed", async () => {
    const everyoneClaimed: LiveSnapshot = {
      ...drawn,
      rerollOpen: false,
      rerollBlocked: "window-over",
      winners: [
        {
          n: 0,
          entrySeq: 2,
          displayName: "Bob",
          claimUntil: 1,
          claim: { state: "claimed", via: "chat" },
        },
      ],
    }
    mockLive({ "GET /api/live/gid-1": () => ok(everyoneClaimed) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { name: "Winner 1 of 1" })

    expect(view.queryByText(windowOverText)).toBeNull()
    expect(view.queryByText(nobodyLeftText)).toBeNull()
  })

  it("keeps the reroll buttons and shows no explanation while the reroll window is open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(view.queryByText(windowOverText)).toBeNull()
    expect(view.queryByText(nobodyLeftText)).toBeNull()
  })

  it("says when the server refuses because the reroll window is over", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ({
        status: 409,
        body: { kind: "reroll-window-over" },
      }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")
    fireEvent.click(view.getByRole("button", { name: "Reroll Wanda" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(
      await view.findByText(
        "The time to pick another winner is over. Contact the winner yourself or start a new giveaway.",
      ),
    ).toBeTruthy()
  })

  it("says when the server refuses to pick another winner", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ({
        status: 409,
        body: { kind: "no-entrants-left" },
      }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")
    fireEvent.click(view.getByRole("button", { name: "Reroll Wanda" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("No entrants are left to pick.")).toBeTruthy()
  })

  it("explains that chat watch is off and marks a claim by hand", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: true }),
      "POST /api/dash/giveaways/gid-1/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Chat watch is off" })).toBeTruthy()
    // The entrants request is issued after the page renders; click only once it is answered, or it can land after the claim request.
    await view.findByRole("heading", { name: "The list is empty" })
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
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(view.queryByRole("heading", { name: "Chat watch is off" })).toBeNull()
    expect(view.queryByRole("button", { name: /Mark as claimed/ })).toBeNull()
  })
})

// The key listener is attached by an effect that can run after the toolbar is found; a key pressed before that is lost.
const effectsRun = () => act(async () => {})

describe("live page: clean mode", () => {
  const toolbar = { name: "Giveaway controls" }

  it("hides the controls bar and keeps the stage, the code and the list", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("toolbar", toolbar)).toBeNull()
    expect(view.getByRole("button", { name: "Show controls" })).toBeTruthy()
    expect(plateName(view)).toBe("Wanda")
    expect(view.getByText("ABCDE")).toBeTruthy()
    expect(view.getByRole("heading", { name: /^Entrants/ })).toBeTruthy()
  })

  it("takes the buttons off the winners too, so nothing clickable is left on stream", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: true }) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("button", { name: /^Reroll|^Pick another winner/ })).toBeNull()
    expect(view.queryByRole("button", { name: /Mark as claimed/ })).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Show controls" }))
    expect(view.getByRole("button", { name: "Reroll Wanda" })).toBeTruthy()
    expect(view.getAllByRole("button", { name: "Pick another winner" })).toHaveLength(1)
  })

  it("brings the bar back with Show controls", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))
    fireEvent.click(view.getByRole("button", { name: "Show controls" }))

    expect(view.getByRole("toolbar", toolbar)).toBeTruthy()
    expect(view.queryByRole("button", { name: "Show controls" })).toBeNull()
  })

  it("stays on after the page is opened again", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const first = renderApp("/live/gid-1")
    fireEvent.click(await first.findByRole("button", { name: "Hide controls" }))
    cleanup()
    const again = renderApp("/live/gid-1")

    expect(await again.findByRole("button", { name: "Show controls" })).toBeTruthy()
    expect(again.queryByRole("toolbar", toolbar)).toBeNull()
  })

  it("starts with the bar when nothing was stored", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("toolbar", toolbar)).toBeTruthy()
  })

  it("toggles with the c key in both directions", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("toolbar", toolbar)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "c" })
    expect(view.queryByRole("toolbar", toolbar)).toBeNull()
    fireEvent.keyDown(document.body, { key: "c" })

    expect(view.getByRole("toolbar", toolbar)).toBeTruthy()
  })

  it("ignores the repeats of a held c key", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("toolbar", toolbar)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "c" })
    fireEvent.keyDown(document.body, { key: "c", repeat: true })

    expect(view.queryByRole("toolbar", toolbar)).toBeNull()
  })

  it("does not toggle while the streamer types in a field", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    const count = await view.findByLabelText("How many winners?")
    await effectsRun()
    fireEvent.keyDown(count, { key: "c" })
    expect(view.getByRole("toolbar", toolbar)).toBeTruthy()
    fireEvent.keyDown(view.getByLabelText("Search by name"), { key: "c" })

    expect(view.getByRole("toolbar", toolbar)).toBeTruthy()
  })

  it("ignores c with Ctrl, which copies, and while a confirmation is open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("toolbar", toolbar)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true })
    expect(view.getByRole("toolbar", toolbar)).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Closed" }))
    fireEvent.keyDown(document.body, { key: "c" })

    expect(view.getByRole("toolbar", toolbar)).toBeTruthy()
    expect(view.getByRole("dialog", { name: "Close entries now?" })).toBeTruthy()
  })
})

describe("live page: the stage", () => {
  it("shows the entry link and the code large, with the count of people, while entries are open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("LIVE")
    const code = within(view.getByRole("banner")).getByText("ABCDE")

    expect(code.parentElement?.textContent).toBe("rafflink.test/ABCDE")
    expect(enteredCount(view)).toBe("3")
  })

  it("puts the newest winner who still has a claim open on the plate with the countdown", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("left to claim")).toBeTruthy()
    expect(plateName(view)).toBe("Wanda")
    expect(view.container.querySelector(".winner-plate-name")?.className).toBe("winner-plate-name")
  })

  it("puts the last winner on the plate with how the claim ended when no claim is open", async () => {
    const settled: LiveSnapshot = { ...drawn, winners: drawn.winners.slice(1) }
    mockLive({ "GET /api/live/gid-1": () => ok(settled) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claim time ran out")).toBeTruthy()
    expect(plateName(view)).toBe("Eve")
    expect(view.queryByText("left to claim")).toBeNull()
  })

  it("shows no plate when nobody was drawn", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winners: [] }) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { name: "Winners" })

    expect(view.container.querySelector(".winner-plate")).toBeNull()
  })
})

describe("live page: winners' chat", () => {
  const chat = [
    { id: 1, name: "Wanda", text: "I am here!", at: 1 },
    { id: 2, name: "Bob", text: "me too", at: 2 },
  ]

  it("lists the messages with the winner's name, newest last, in a polite live region", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat }) })

    const view = renderApp("/live/gid-1")
    const list = await view.findByRole("list", { name: "Winner chat" })

    const [first, second] = within(list).getAllByRole("listitem")
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    expect(first?.querySelector("strong")?.textContent).toBe("Wanda")
    expect(first?.textContent).toContain("I am here!")
    expect(second?.querySelector("strong")?.textContent).toBe("Bob")
    expect(second?.textContent).toContain("me too")
    expect(list.getAttribute("aria-live")).toBe("polite")
  })

  it("is not shown while there are no messages", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed in chat")

    expect(view.queryByRole("heading", { name: "Winner chat" })).toBeNull()
    expect(view.queryByRole("list", { name: "Winner chat" })).toBeNull()
  })

  it("is hidden in clean mode and back with Show controls", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat }) })

    const view = renderApp("/live/gid-1")
    expect(await view.findByRole("list", { name: "Winner chat" })).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("list", { name: "Winner chat" })).toBeNull()
    expect(view.queryByText("I am here!")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Show controls" }))
    expect(view.getByRole("list", { name: "Winner chat" })).toBeTruthy()
  })

  it("scrolls to the newest message when one arrives", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat.slice(0, 1) }) })

    const view = renderApp("/live/gid-1")
    const list = await view.findByRole("list", { name: "Winner chat" })
    Object.defineProperty(list, "scrollHeight", { value: 480 })
    act(() => {
      list.scrollTop = 0
      FakeSocket.opened[0]?.push({ ...drawn, winnerChat: chat })
    })

    await view.findByText("me too")
    expect(list.scrollTop).toBe(480)
  })

  it("scrolls to a new message when the list is full and the oldest line dropped out at the same time", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat }) })

    const view = renderApp("/live/gid-1")
    const list = await view.findByRole("list", { name: "Winner chat" })
    Object.defineProperty(list, "scrollHeight", { value: 480 })
    act(() => {
      list.scrollTop = 0
      FakeSocket.opened[0]?.push({
        ...drawn,
        winnerChat: [
          { id: 2, name: "Bob", text: "me too", at: 2 },
          { id: 3, name: "Wanda", text: "same millisecond", at: 2 },
        ],
      })
    })

    await view.findByText("same millisecond")
    expect(list.scrollTop).toBe(480)
  })

  it("keeps the scroll when a reroll drops the newest line", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat }) })

    const view = renderApp("/live/gid-1")
    const list = await view.findByRole("list", { name: "Winner chat" })
    Object.defineProperty(list, "scrollHeight", { value: 480 })
    act(() => {
      list.scrollTop = 120
      FakeSocket.opened[0]?.push({ ...drawn, winnerChat: chat.slice(0, 1) })
    })

    await waitFor(() => expect(view.queryByText("me too")).toBeNull())
    expect(list.scrollTop).toBe(120)
  })
})

describe("live page: access and connection", () => {
  it("asks for a sign-in without a session", async () => {
    mockLive({ "GET /api/live/gid-1": () => ({ status: 401, body: { error: "unauthorized" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  it("answers not found for the giveaway of another streamer", async () => {
    mockLive({ "GET /api/live/gid-1": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Giveaway not found")).toBeTruthy()
  })

  it("reconnects after the socket drops and says so meanwhile", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")

    act(() => FakeSocket.opened[0]?.drop())

    expect(await view.findByText("Reconnecting to the live feed…")).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(0) + 200))
    expect(FakeSocket.opened.length).toBe(2)
  })

  it("ignores a push that is not a snapshot", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
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
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

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

  it("adds the chosen mode and QR code to the overlay link", async () => {
    const copied = stubClipboard(false)
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")
    fireEvent.click(view.getByRole("radio", { name: "Winner only" }))
    fireEvent.click(view.getByRole("radio", { name: "Show" }))

    const field = view.getByLabelText("Overlay link")
    expect(field instanceof HTMLInputElement && field.value).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1?mode=winner&qr=1",
    )
    fireEvent.click(view.getByRole("button", { name: "Copy overlay link" }))
    await view.findByText("Copied!")
    expect(copied).toEqual(["http://rafflink.test/overlay/gid-1/tok-1?mode=winner&qr=1"])
  })

  it("keeps the plain overlay link while the defaults are chosen", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")
    fireEvent.click(view.getByRole("radio", { name: "Corner badge" }))
    fireEvent.click(view.getByRole("radio", { name: "Automatic" }))

    const field = view.getByLabelText("Overlay link")
    expect(field instanceof HTMLInputElement && field.value).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
  })

  it("keeps the overlay link when a socket push arrives", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Ada")
    act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, lastNames: ["Cy"] }))

    expect(await view.findByText("Cy")).toBeTruthy()
    expect(view.getByLabelText("Overlay link")).toBeTruthy()
  })

  it("shows no overlay link when the answer carries no token", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    await view.findByText("Ada")
    expect(view.queryByLabelText("Overlay link")).toBeNull()
  })
})

describe("live page: its own frame", () => {
  it("renders its own top bar and a main landmark with a skip link, not the app bar", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { level: 1, name: "Summer giveaway" })

    expect(view.container.querySelector(".app-bar")).toBeNull()
    expect(view.container.querySelectorAll("main#main")).toHaveLength(1)
    expect(view.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main")
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(view.getByRole("banner").textContent).toContain("Rafflink")
  })

  it("keeps the frame when the giveaway is not found", async () => {
    mockLive({ "GET /api/live/gid-1": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Giveaway not found")).toBeTruthy()
    expect(view.container.querySelectorAll("main#main")).toHaveLength(1)
    expect(view.getByRole("banner").textContent).toContain("Rafflink")
  })

  it("shows the entry link with the code, the count and the LIVE chip in the top bar", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("LIVE")

    const bar = within(view.getByRole("banner"))
    expect(bar.getByText("Enter at")).toBeTruthy()
    expect(bar.getByText("ABCDE").tagName).toBe("EM")
    expect(bar.getByText("3").nextElementSibling?.textContent).toBe("entered")
  })
})

describe("live page: the winner on the stage", () => {
  const entrantRows = [
    { seq: 1, login: "wanda", displayName: "Wanda", tickets: 4, group: "sub_t2" },
  ]

  it("shows the tier and the tickets of the winner once the list has them", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok(drawn),
      "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: entrantRows, more: false }),
    })

    const view = renderApp("/live/gid-1")

    await waitFor(() =>
      expect(view.container.querySelector(".live-badge")?.textContent).toBe("Tier 2 sub"),
    )
    expect(view.container.querySelector(".live-stub")?.textContent).toBe("4 tickets")
    expect(view.container.querySelector(".live-who .live-avatar")?.textContent).toBe("WA")
  })

  it("shows no tier or tickets while the winner is not in the list", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    expect(view.container.querySelector(".live-badge")).toBeNull()
    expect(view.container.querySelector(".live-stub")).toBeNull()
  })

  it("draws one segment per winner still in the draw: the open claim in the accent, settled ones filled", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    const segments = within(view.getByRole("list", { name: "Winners drawn" })).getAllByRole(
      "listitem",
    )
    expect(segments.map((segment) => segment.getAttribute("data-state"))).toEqual([
      "now",
      "done",
      "done",
    ])
  })

  it("counts a replaced pick out of the winners and lists it among the earlier picks", async () => {
    const replaced: LiveSnapshot = {
      ...drawn,
      winners: [
        { n: 0, entrySeq: 3, displayName: "Eve", claimUntil: 1, claim: { state: "rerolled" } },
        {
          n: 1,
          entrySeq: 1,
          displayName: "Wanda",
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    mockLive({ "GET /api/live/gid-1": () => ok(replaced) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Winner 1 of 1" })).toBeTruthy()
    expect(within(pickPill(view, "Eve")).getByText("Did not claim, rerolled")).toBeTruthy()
  })

  it("says how many tickets the pick was made from", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, ticketTotal: 622 }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Picked from 622 tickets")).toBeTruthy()
  })

  it("shows the claim window of the giveaway under the ring", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claim window 300 s")).toBeTruthy()
  })

  it("empties the ring with the share of the claim window that is left", async () => {
    const waiting: LiveSnapshot = {
      ...drawn,
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Wanda",
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    mockLive({ "GET /api/live/gid-1": () => ok(waiting) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claim window 300 s")

    // 120 s of the 300 s window are left, so 60% of the ring is empty.
    const bar = view.container.querySelector(".live-ring-bar")
    expect(Number(bar?.getAttribute("stroke-dashoffset"))).toBeCloseTo(2 * Math.PI * 52 * 0.6, 0)
  })

  it("starts the ring full and names no claim window while the giveaway is not known", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    mockFetch({
      "GET /api/live/gid-1": () => ok(drawn),
      "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    const bar = view.container.querySelector(".live-ring-bar")
    expect(Number(bar?.getAttribute("stroke-dashoffset"))).toBe(0)
    expect(view.queryByText(/Claim window/)).toBeNull()
  })

  it("tells the urgency in words and in the ring when the claim time is nearly over", async () => {
    const hurry: LiveSnapshot = {
      ...drawn,
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Wanda",
          claimUntil: Date.now() + 10_000,
          claim: { state: "waiting" },
        },
      ],
    }
    mockLive({ "GET /api/live/gid-1": () => ok(hurry) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("left, hurry up")).toBeTruthy()
    expect(view.container.querySelector(".live-ring")?.getAttribute("data-tone")).toBe("warning")
  })

  it.each([
    [
      "any chat message when the giveaway has no claim word",
      giveaway,
      false,
      "Wanda, type anything in chat or press Claim my prize on your giveaway page.",
    ],
    [
      "the claim word when the giveaway has one",
      { ...giveaway, rules: { ...giveaway.rules, claimKeyword: "IN" } },
      false,
      "Wanda, type IN in chat or press Claim my prize on your giveaway page.",
    ],
    [
      "the giveaway page only while chat watch is off",
      giveaway,
      true,
      "Wanda, press Claim my prize on your giveaway page.",
    ],
  ])("tells the winner to claim with %s", async (_name, facts, chatOff, text) => {
    mockLive({
      "GET /api/g/ABCDE": () => ok(facts),
      "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: chatOff }),
    })

    const view = renderApp("/live/gid-1")

    await waitFor(() =>
      expect(view.container.querySelector(".live-claim-hint")?.textContent).toBe(text),
    )
  })
})

describe("live page: the controls bar", () => {
  it("opens the draw question with the d key, not while typing and not with Ctrl", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    const count = await view.findByLabelText("How many winners?")
    await effectsRun()
    fireEvent.keyDown(count, { key: "d" })
    expect(view.queryByRole("dialog")).toBeNull()
    fireEvent.keyDown(document.body, { key: "d", ctrlKey: true })
    expect(view.queryByRole("dialog")).toBeNull()
    fireEvent.keyDown(document.body, { key: "d" })

    expect(view.getByRole("dialog", { name: "Draw 1 winner now?" })).toBeTruthy()
  })

  it("does not open the draw question with d when nobody entered", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, status: "closed", entrantCount: 0, lastNames: [] }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Nobody entered, so there is nobody to draw.")
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "d" })

    expect(view.queryByRole("dialog")).toBeNull()
  })

  it("opens the reroll question for the winner on the plate with the r key", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("button", { name: "Reroll Wanda" })
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "r" })

    expect(view.getByRole("dialog", { name: "Pick another winner instead of Wanda?" })).toBeTruthy()
  })

  it("does not open the reroll question with r once the reroll window is over", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(windowOver) })

    const view = renderApp("/live/gid-1")
    await view.findByText(windowOverText)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "r" })

    expect(view.queryByRole("dialog")).toBeNull()
  })

  it("names the key on the button it works for", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    const draw = await view.findByRole("button", { name: "Draw winners" })

    expect(draw.getAttribute("aria-keyshortcuts")).toBe("d")
    expect(draw.querySelector("kbd")?.textContent).toBe("D")
  })

  it.each([
    ["open", liveSnapshot, "Open", "Closed"],
    ["closed", { ...liveSnapshot, status: "closed" }, "Closed", "Open"],
    ["drawn", drawn, "Closed", "Open"],
  ] as const)(
    "marks the %s state of the entries switch as pressed",
    async (_name, snapshot, pressed, other) => {
      mockLive({ "GET /api/live/gid-1": () => ok(snapshot) })

      const view = renderApp("/live/gid-1")
      const group = within(await view.findByRole("group", { name: "Entries" }))

      expect(group.getByRole("button", { name: pressed }).getAttribute("aria-pressed")).toBe("true")
      expect(group.getByRole("button", { name: other }).getAttribute("aria-pressed")).not.toBe(
        "true",
      )
    },
  )

  it("cannot reopen entries once they are closed", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }) })

    const view = renderApp("/live/gid-1")
    const group = within(await view.findByRole("group", { name: "Entries" }))

    expect(group.getByRole("button", { name: "Open" }).hasAttribute("disabled")).toBe(true)
    expect(group.getByRole("button", { name: "Closed" }).hasAttribute("disabled")).toBe(true)
  })
})
