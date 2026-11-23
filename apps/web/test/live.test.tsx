import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import type { Entrant } from "@rafflink/core/room/rows"
import { reconnectDelayMs } from "../src/lib/use-live.ts"
import { stubClipboard } from "./clipboard.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { claimedAt, claimedAtText, donateUrl, giveaway, liveSnapshot } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { chooseLanguage, inputOf } from "./queries.ts"
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
  delete document.documentElement.dataset.theme
  document.documentElement.lang = "en"
})

/** `mockFetch` plus the public giveaway and an empty entrants list, which every streamer live page asks for. */
function mockLive(routes: Readonly<Record<string, () => Reply>>) {
  return mockFetch({
    "GET /api/g/ABCDE": () => ok(giveaway),
    "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    ...routes,
  })
}

/** The newest request to `route`. A page refetch (entrants, session) can land after the call a test asserts on, so `requests.at(-1)` is not that call. */
function lastRequest(requests: ReturnType<typeof mockLive>, route: string) {
  return requests.findLast((request) => request.route === route)
}

const drawn: LiveSnapshot = {
  ...liveSnapshot,
  status: "drawn",
  winnerChatOpen: true,
  rerollOpen: true,
  rerollBlocked: null,
  winners: [
    {
      n: 0,
      entrySeq: 1,
      displayName: "Wanda",
      profileImageUrl: null,
      claimUntil: Date.now() + 120_000,
      claim: { state: "waiting" },
    },
    {
      n: 1,
      entrySeq: 2,
      displayName: "Bob",
      profileImageUrl: null,
      claimUntil: 1,
      claim: { state: "claimed", at: claimedAt, via: "chat" },
    },
    {
      n: 2,
      entrySeq: 3,
      displayName: "Eve",
      profileImageUrl: null,
      claimUntil: 1,
      claim: { state: "expired" },
    },
  ],
}

const windowOver: LiveSnapshot = { ...drawn, rerollOpen: false, rerollBlocked: "window-over" }
const nobodyLeft: LiveSnapshot = { ...drawn, rerollOpen: false, rerollBlocked: "nobody-left" }

const windowOverText =
  "The time to pick another winner is over. Contact the winners who have not claimed, or start a new giveaway."

const entrantOf = (seq: number, displayName: string): Entrant => ({
  seq,
  login: displayName.toLowerCase(),
  displayName,
  tickets: 1,
  group: "viewer",
  profileImageUrl: null,
})

/** `mockLive` with the entrants behind the winners of `drawn`, so their rows are in the list. */
function mockDrawn(routes: Readonly<Record<string, () => Reply>>) {
  return mockLive({
    "GET /api/live/gid-1/entrants?after=0": () =>
      ok({ rows: [entrantOf(1, "Wanda"), entrantOf(2, "Bob"), entrantOf(3, "Eve")], more: false }),
    ...routes,
  })
}

/** The row of a pick in the entrants table. */
async function pickRow(view: ReturnType<typeof renderApp>, name: string): Promise<HTMLElement> {
  const table = await view.findByRole("table", { name: "People who entered, scroll to see more" })
  const row = (await within(table).findByText(name)).closest("tr")
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

const plateName = (view: ReturnType<typeof renderApp>) =>
  view.container.querySelector(".winner-plate-name")?.textContent

const entrantsHeading = (view: ReturnType<typeof renderApp>) =>
  view.getByRole("heading", { name: /^Entrants/ }).textContent

/** The words behind the LIVE chip: the page has loaded a giveaway that takes entries. */
const openStage = "Entries open"

describe("live page: collecting entries", () => {
  it("never invites the streamer to run a giveaway", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(openStage)).toBeTruthy()
    expect(view.queryByRole("link", { name: "Run your own giveaway with Rafflink" })).toBeNull()
  })

  it("renders the snapshot with labelled numbers and then every push of the socket", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(openStage)).toBeTruthy()
    expect(view.getByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
    expect(await view.findByText("Streamy gives away A gaming chair")).toBeTruthy()
    expect(entrantsHeading(view)).toBe("Entrants 3")
    const stats = within(view.getByRole("region", { name: "Stats" }))
    expect(stats.getByText("1.5")).toBeTruthy()
    expect(stats.getByText("entries per second")).toBeTruthy()
    expect(view.getByText("5 tickets")).toBeTruthy()
    expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/live/gid-1")
    act(() =>
      FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 9, entriesPerSecond: 2.5 }),
    )
    expect(await stats.findByText("2.5")).toBeTruthy()
    expect(entrantsHeading(view)).toBe("Entrants 9")
  })

  it("names an untitled giveaway by its prize, as the dashboard does", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, title: null }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { level: 1, name: "A gaming chair" })).toBeTruthy()
  })

  it("names the giveaway by its code when it has neither a title nor a prize", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, title: null }),
      "GET /api/g/ABCDE": () => ok({ ...giveaway, title: null, prize: null }),
    })

    const view = renderApp("/live/gid-1")

    await waitFor(() =>
      expect(view.getByRole("heading", { level: 1 }).textContent).toBe("Giveaway ABCDE"),
    )
  })

  it("says that entries are open with the LIVE chip in the top bar", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Entries open")).toBeTruthy()
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

  it("copies the entry link from the top bar", async () => {
    const copied = stubClipboard(false)
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("LIVE")
    fireEvent.click(within(view.getByRole("banner")).getByRole("button", { name: "Copy link" }))

    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/ABCDE"])
  })

  it("shows the whole entry link selected for Ctrl+C when the browser refuses to copy", async () => {
    stubClipboard(true)
    spyOn(console, "error").mockImplementation(() => {})
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("LIVE")
    fireEvent.click(within(view.getByRole("banner")).getByRole("button", { name: "Copy link" }))

    expect(
      await view.findByText("Could not copy. The text is selected: press Ctrl+C."),
    ).toBeTruthy()
    const field = within(view.getByRole("banner")).getByRole("textbox", { name: "Your link" })
    if (!(field instanceof HTMLInputElement)) throw new Error("the link field is not an input")
    expect(field.value).toBe("http://rafflink.test/ABCDE")
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
  })

  it("leaves the link card out of the page, since the top bar has the link", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText(openStage)

    expect(view.queryByText("Latest entrants")).toBeNull()
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
      "GET /api/live/gid-1/badges",
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
      "GET /api/live/gid-1/badges",
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
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/close")).toBeDefined()
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
    await view.findByText(openStage)

    expect(view.queryByRole("heading", { name: "Problems" })).toBeNull()
  })
})

describe("live page: drawing", () => {
  const closed: LiveSnapshot = { ...liveSnapshot, status: "closed" }
  const drawPath = "POST /api/dash/giveaways/gid-1/draw"

  it("draws the next winner on one press of Draw winner, without a question, for one winner", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(closed),
      [drawPath]: () => ok({ kind: "drawn", picks: [0] }),
    })

    const view = renderApp("/live/gid-1")
    expect(await view.findByRole("heading", { name: "Entries are closed" })).toBeTruthy()
    expect(
      await view.findByText("3 people entered. Draw the winner when you are ready."),
    ).toBeTruthy()
    fireEvent.click(await view.findByRole("button", { name: "Draw winner" }))

    await waitFor(() => expect(lastRequest(requests, drawPath)?.route).toBe(drawPath))
    await effectsRun()
    expect(view.container.querySelector(".toast")).toBeNull()
    expect(view.queryByRole("dialog")).toBeNull()
    expect(lastRequest(requests, drawPath)).toEqual({ route: drawPath, body: { count: 1 } })
  })

  it("is there while entries are open, and asks before it closes them", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      [drawPath]: () => ({ status: 202, body: { kind: "requested" } }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw winner" }))
    expect(view.getByText("Close entries and draw a winner?")).toBeTruthy()
    expect(requests.some((request) => request.route === drawPath)).toBe(false)
    fireEvent.click(view.getByRole("button", { name: "Yes, close entries and draw" }))

    expect(
      await view.findByText(
        "Entries are closed. The winner is drawn by itself when the random number is ready.",
      ),
    ).toBeTruthy()
    expect(lastRequest(requests, drawPath)).toEqual({ route: drawPath, body: { count: 1 } })
  })

  it("keeps the button for the next winner after a draw and shows the progress against the plan", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok({ ...drawn, entrantCount: 5, winnerCount: 2 }),
      [drawPath]: () => ok({ kind: "drawn", picks: [3] }),
    })

    const view = renderApp("/live/gid-1")
    expect(
      await view.findByText("Winners drawn: 3 of 2 planned. Draw as many more as you need."),
    ).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Draw next winner" }))

    await waitFor(() => expect(lastRequest(requests, drawPath)?.route).toBe(drawPath))
    await effectsRun()
    expect(view.container.querySelector(".toast")).toBeNull()
    expect(lastRequest(requests, drawPath)?.route).toBe(drawPath)
  })

  it("draws the planned winners still missing in one press of the batch button", async () => {
    const requests = mockDrawn({
      "GET /api/live/gid-1": () => ok({ ...drawn, entrantCount: 10, winnerCount: 7 }),
      [drawPath]: () => ok({ kind: "drawn", picks: [3, 4, 5, 6] }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw 4 winners" }))

    await waitFor(() =>
      expect(lastRequest(requests, drawPath)).toEqual({ route: drawPath, body: { count: 4 } }),
    )
  })

  it("draws the number of winners typed in the batch stepper, and refuses one above the batch", async () => {
    const requests = mockDrawn({
      "GET /api/live/gid-1": () => ok({ ...drawn, entrantCount: 10, winnerCount: 7 }),
      [drawPath]: () => ok({ kind: "drawn", picks: [3, 4] }),
    })

    const view = renderApp("/live/gid-1")
    const input = await view.findByLabelText("Winners at once")
    expect((input as HTMLInputElement).value).toBe("4")
    fireEvent.change(input, { target: { value: "5" } })
    const refused = view.getByRole("button", { name: "Pick 1 to 4" })
    expect((refused as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: "2" } })
    fireEvent.click(view.getByRole("button", { name: "Draw 2 winners" }))

    await waitFor(() =>
      expect(lastRequest(requests, drawPath)).toEqual({ route: drawPath, body: { count: 2 } }),
    )
  })

  it("packs the progress segments of a large batch so they share the row", async () => {
    const many = Array.from({ length: 25 }, (_, n) => ({
      n,
      entrySeq: null,
      displayName: `W${n}`,
      profileImageUrl: null,
      claimUntil: 1,
      claim: { state: "expired" as const },
    }))
    mockDrawn({ "GET /api/live/gid-1": () => ok({ ...drawn, winners: many }) })

    const view = renderApp("/live/gid-1")
    const progress = await view.findByRole("list", { name: "Winners drawn" })

    expect(progress.dataset.dense).toBe("true")
    expect(progress.children).toHaveLength(25)
  })

  it("offers no batch above the picks the room can still hold", async () => {
    mockDrawn({
      "GET /api/live/gid-1": () => ok({ ...drawn, entrantCount: 10, winnerCount: 7, picksLeft: 2 }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("button", { name: "Draw 2 winners" })).toBeTruthy()
  })

  it("offers no batch past the entrants left, and none for a single missing winner", async () => {
    mockDrawn({ "GET /api/live/gid-1": () => ok({ ...drawn, entrantCount: 5, winnerCount: 9 }) })
    const view = renderApp("/live/gid-1")
    expect(await view.findByRole("button", { name: "Draw 2 winners" })).toBeTruthy()
    view.unmount()

    mockDrawn({ "GET /api/live/gid-1": () => ok({ ...drawn, entrantCount: 9, winnerCount: 4 }) })
    const single = renderApp("/live/gid-1")
    await single.findByRole("button", { name: "Draw next winner" })
    expect(single.queryByRole("button", { name: /Draw \d+ winners/ })).toBeNull()
  })

  it("draws with the d key and shows the key on the button", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(closed),
      [drawPath]: () => ok({ kind: "drawn", picks: [0] }),
    })

    const view = renderApp("/live/gid-1")
    const draw = await view.findByRole("button", { name: "Draw winner" })
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "d" })

    expect(draw.getAttribute("aria-keyshortcuts")).toBe("d")
    expect(draw.querySelector("kbd")?.textContent).toBe("D")
    await waitFor(() => expect(lastRequest(requests, drawPath)?.route).toBe(drawPath))
    await effectsRun()
    expect(view.container.querySelector(".toast")).toBeNull()
    expect(lastRequest(requests, drawPath)?.route).toBe(drawPath)
  })

  it.each([
    [
      "round-pending",
      409,
      "The random number is not published yet. The winner is drawn by itself as soon as it is.",
    ],
    [
      "beacon-unavailable",
      503,
      "Could not reach the random source (drand). Nothing was drawn. Try again.",
    ],
    ["no-entrants-left", 409, "Everyone who entered has been drawn."],
    [
      "pick-limit",
      409,
      "This giveaway cannot hold that many more winners. Draw fewer, or none if it is full.",
    ],
    ["try-again", 409, "Another draw happened at the same moment. Press Draw winner again."],
  ])("tells the streamer what happened when the answer is %s", async (kind, status, message) => {
    mockLive({
      "GET /api/live/gid-1": () => ok(closed),
      [drawPath]: () => ({
        status,
        body: { kind, availableAt: Date.now() + 60_000, now: Date.now() },
      }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw winner" }))

    expect(await view.findByText(message)).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winner" })).toBeTruthy()
  })

  it("saves the planned winner count while entries are open and after they closed", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/winners": () => ok({ kind: "set" }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("Planned winners"), { target: { value: "4" } })
    fireEvent.click(view.getByRole("button", { name: "Save" }))

    expect(await view.findByText("Winner count saved.")).toBeTruthy()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/winners")?.body).toEqual({
      count: 4,
    })
  })

  it.each([
    ["closed", closed],
    ["drawn", drawn],
  ] as const)("offers the planned winner count in the %s step too", async (_name, snapshot) => {
    mockLive({ "GET /api/live/gid-1": () => ok(snapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByLabelText("Planned winners")).toBeTruthy()
  })

  it("steps the planned winner count with the buttons, never below 1, and saves it", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok(liveSnapshot),
      "POST /api/dash/giveaways/gid-1/winners": () => ok({ kind: "set" }),
    })

    const view = renderApp("/live/gid-1")
    const count = inputOf(await view.findByLabelText("Planned winners"))
    const fewer = view.getByRole("button", { name: "Fewer winners" })
    expect(fewer.hasAttribute("disabled")).toBe(true)
    expect(view.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)

    fireEvent.click(view.getByRole("button", { name: "More winners" }))
    fireEvent.click(view.getByRole("button", { name: "More winners" }))
    fireEvent.click(fewer)
    expect(count.value).toBe("2")
    fireEvent.click(view.getByRole("button", { name: "Save" }))

    expect(await view.findByText("Winner count saved.")).toBeTruthy()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/winners")?.body).toEqual({
      count: 2,
    })
    fewer.focus()
    fireEvent.click(fewer)
    expect(count.value).toBe("1")
    expect(document.activeElement === count).toBe(true)
  })

  it.each(["0", "-1", "1.5", ""])("does not save %p as the winner count", async (count) => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.change(await view.findByLabelText("Planned winners"), { target: { value: count } })

    expect(view.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
  })

  it.each([
    ["open", liveSnapshot],
    ["closed", closed],
  ] as const)("disables Draw winner when nobody entered, %s, and says why", async (_name, base) => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...base, entrantCount: 0, lastNames: [] }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(/Nobody entered, so there is nobody to draw./)).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winner" }).hasAttribute("disabled")).toBe(true)
  })

  it("disables Draw next winner once every entrant has been drawn", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("All entrants drawn.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw next winner" }).hasAttribute("disabled")).toBe(
      true,
    )
  })

  it("disables the button and says the winner comes by itself once the draw was requested", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...closed, drawRequested: true }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findAllByText("Drawing the winner…")).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw winner" }).hasAttribute("disabled")).toBe(true)
  })
})

const drawsIn = (clock: string) => new RegExp(`drawn by itself in ${clock}[.]`)

describe("live page: waiting for the drand round", () => {
  const now = Date.UTC(2026, 10, 21, 12)

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it("counts down to the committed round, then waits for the room to draw by itself", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...liveSnapshot,
          status: "closed",
          now,
          drawAvailableAt: now + 20_000,
          drawRequested: true,
        }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findAllByText(drawsIn("0:20"))).not.toHaveLength(0)
    expect(view.getByRole("button", { name: "Draw winner" }).hasAttribute("disabled")).toBe(true)
    act(() => jest.advanceTimersByTime(19_000))
    expect(await view.findAllByText(drawsIn("0:01"))).not.toHaveLength(0)
    act(() => jest.advanceTimersByTime(1000))
    expect(await view.findAllByText("Drawing the winner…")).toBeTruthy()
    expect(view.queryByText(/drawn by itself in/)).toBeNull()
  })

  it("shows the first winner when the room's push arrives after the countdown", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...liveSnapshot,
          status: "closed",
          now,
          drawAvailableAt: now + 5000,
          drawRequested: true,
        }),
    })

    const view = renderApp("/live/gid-1")
    await view.findAllByText(drawsIn("0:05"))
    act(() => jest.advanceTimersByTime(5000))
    act(() => FakeSocket.opened[0]?.push({ ...drawn, entrantCount: 5, now: now + 5000 }))

    expect(await view.findByRole("heading", { name: "Winner 1 of 3" })).toBeTruthy()
    expect(view.getByRole("button", { name: "Draw next winner" })).toBeTruthy()
  })

  it("starts the countdown from availableAt when a draw answers round-pending", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }),
      "POST /api/dash/giveaways/gid-1/draw": () => ({
        status: 409,
        body: { kind: "round-pending", availableAt: now + 12_000, now },
      }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw winner" }))

    expect(await view.findAllByText(drawsIn("0:12"))).not.toHaveLength(0)
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/draw")).toBeDefined()
  })

  it("counts from the server clock when the browser clock is behind", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...liveSnapshot,
          status: "closed",
          now: now + 3_600_000,
          drawAvailableAt: now + 3_600_000 + 20_000,
        }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findAllByText(drawsIn("0:20"))).not.toHaveLength(0)
  })

  it("says the round is on its way when a draw answers round-pending with its time already reached", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }),
      "POST /api/dash/giveaways/gid-1/draw": () => ({
        status: 409,
        body: { kind: "round-pending", availableAt: now, now },
      }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Draw winner" }))

    expect(
      await view.findByText(
        "The random number is on its way. The winner is drawn by itself in a moment.",
      ),
    ).toBeTruthy()
  })
})

describe("live page: winners", () => {
  it("shows the winner on the plate with a countdown and the earlier winners only in the entrants table", async () => {
    mockDrawn({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claimed")).toBeTruthy()
    expect(view.getByRole("heading", { name: "Winner 1 of 3" })).toBeTruthy()
    expect(view.container.querySelector(".live-ring [role=timer]")?.textContent).toMatch(
      /^[12]:\d\d$/,
    )
    expect(plateName(view)).toBe("Wanda")
    expect(within(await pickRow(view, "Bob")).getByText("Claimed")).toBeTruthy()
    expect(within(await pickRow(view, "Eve")).getByText("Did not claim")).toBeTruthy()
    expect(view.queryByRole("list", { name: "Earlier picks" })).toBeNull()
    expect(view.queryByText(`Claimed in chat on ${claimedAtText}`)).toBeNull()
  })

  it("says how a settled winner on the plate claimed in a short chip with the date beside it, and drops the ring", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...drawn,
          winners: [
            {
              n: 0,
              entrySeq: 1,
              displayName: "Wanda",
              profileImageUrl: null,
              claimUntil: 1,
              claim: { state: "claimed", at: claimedAt, via: "manual" },
            },
          ],
        }),
    })

    const view = renderApp("/live/gid-1")

    const chip = (await view.findByText("Claimed by hand")).closest(".status-chip")
    expect(chip?.textContent).toBe("Claimed by hand")
    expect(view.getByText(claimedAtText).closest(".status-chip")).toBeNull()
    expect(view.container.querySelector(".live-ring")).toBeNull()
    expect(view.container.querySelector(".live-timer")).toBeNull()
    expect(view.queryByText(/write anything in chat|Claim time/)).toBeNull()
  })

  it("shows the claim time only for the winner on the plate, not for another waiting winner", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...drawn,
          winners: [
            {
              n: 0,
              entrySeq: 1,
              displayName: "Wanda",
              profileImageUrl: null,
              claimUntil: Date.now() + 120_000,
              claim: { state: "waiting" },
            },
            {
              n: 1,
              entrySeq: 2,
              displayName: "Cy",
              profileImageUrl: null,
              claimUntil: Date.now() + 60_000,
              claim: { state: "waiting" },
            },
          ],
        }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    expect(plateName(view)).toBe("Cy")
    expect(view.getAllByRole("timer")).toHaveLength(1)
  })

  it.each([
    ["whose claim the stream waits for", 0, "Waiting for Wanda to claim the prize."],
    ["who claimed", 1, "Bob claimed the prize."],
    ["that nobody claimed", 2, "Nobody has claimed the prize yet."],
  ])("says to screen readers in the sidebar %s", async (_name, skip, text) => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...drawn, winners: drawn.winners.slice(skip) }),
    })

    const view = renderApp("/live/gid-1")

    const side = await view.findByRole("complementary", { name: "Stats and settings" })
    expect(within(side).getByText(text).className).toBe("sr-only")
  })

  it("keeps only Draw next winner in the toolbar once the winner on the plate claimed", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({ ...drawn, entrantCount: 9, winners: drawn.winners.slice(1, 2) }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Bob claimed the prize.")).toBeTruthy()
    const toolbar = within(view.getByRole("toolbar", { name: "Giveaway controls" }))
    expect(toolbar.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Draw next winnerD",
    ])
  })

  it("asks before it picks another winner and names who loses the prize", async () => {
    const requests = mockDrawn({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/reroll": () => ok({ kind: "rerolled", pick: 3 }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed")
    fireEvent.click(within(await pickRow(view, "Eve")).getByRole("button", { name: "Reroll Eve" }))

    expect(view.getByText("Pick another winner instead of Eve?")).toBeTruthy()
    expect(view.getByText("Eve loses the prize. This cannot be undone.")).toBeTruthy()
    expect(requests.map((request) => request.route)).toEqual([
      "GET /api/live/gid-1",
      "GET /api/live/gid-1/badges",
      "GET /api/g/ABCDE",
      "GET /api/live/gid-1/entrants?after=0",
    ])
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("Another winner was picked.")).toBeTruthy()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/reroll")).toEqual({
      route: "POST /api/dash/giveaways/gid-1/reroll",
      body: { n: 2 },
    })
  })

  it("offers Pick another winner for the winner on the plate and for unsettled winners in the table only", async () => {
    mockDrawn({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed")

    const toolbarButton = view.getByRole("button", { name: "Reroll Wanda" })
    expect(toolbarButton.querySelector("span[aria-hidden]")?.textContent).toBe("Reroll")
    expect(
      within(await pickRow(view, "Eve")).getByRole("button", { name: "Reroll Eve" }),
    ).toBeTruthy()
    expect(view.getAllByRole("button", { name: /^Reroll/ })).toHaveLength(2)
    expect(within(await pickRow(view, "Wanda")).queryByRole("button")).toBeNull()
    expect(within(await pickRow(view, "Bob")).queryByRole("button")).toBeNull()
  })

  it("gives an older expired pick its buttons in the table", async () => {
    const [wanda, , eve] = drawn.winners
    mockDrawn({
      "GET /api/live/gid-1": () =>
        ok({
          ...drawn,
          winners: [
            { ...eve!, n: 0 },
            { ...wanda!, n: 1 },
          ],
        }),
    })

    const view = renderApp("/live/gid-1")

    const row = await pickRow(view, "Eve")
    expect(within(row).getByRole("button", { name: "Reroll Eve" })).toBeTruthy()
    expect(within(row).getByRole("button", { name: "Mark as claimed for Eve" })).toBeTruthy()
  })

  it("has no actions column while the only unsettled pick is the one on the plate", async () => {
    mockDrawn({
      "GET /api/live/gid-1": () => ok({ ...drawn, winners: drawn.winners.slice(0, 2) }),
    })

    const view = renderApp("/live/gid-1")

    await pickRow(view, "Bob")
    expect(view.container.querySelector(".entrants-col-actions")).toBeNull()
    expect(view.container.querySelector(".entrants-act")).toBeNull()
  })

  it("has no actions column for an unsettled pick whose entrant row is not in the list", async () => {
    const [wanda, , eve] = drawn.winners
    mockDrawn({
      "GET /api/live/gid-1": () =>
        ok({
          ...drawn,
          winners: [
            { ...eve!, n: 0, entrySeq: 99 },
            { ...wanda!, n: 1 },
          ],
        }),
    })

    const view = renderApp("/live/gid-1")

    await pickRow(view, "Wanda")
    expect(view.container.querySelector(".entrants-col-actions")).toBeNull()
  })

  it("rerolls an older winner whose claim is still waiting from the table", async () => {
    const waiting: LiveSnapshot = {
      ...drawn,
      winners: [
        { ...drawn.winners[0]!, n: 0, entrySeq: 1 },
        { ...drawn.winners[0]!, n: 1, entrySeq: 2, displayName: "Bob" },
      ],
    }
    const requests = mockDrawn({
      "GET /api/live/gid-1": () => ok(waiting),
      "POST /api/dash/giveaways/gid-1/reroll": () => ok({ kind: "rerolled", pick: 2 }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { name: "Winner 2 of 2" })
    fireEvent.click(
      await within(await pickRow(view, "Wanda")).findByRole("button", { name: "Reroll Wanda" }),
    )
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("Another winner was picked.")).toBeTruthy()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/reroll")).toEqual({
      route: "POST /api/dash/giveaways/gid-1/reroll",
      body: { n: 0 },
    })
  })

  it("hides Pick another winner and says the time is over once the reroll window has ended", async () => {
    mockDrawn({ "GET /api/live/gid-1": () => ok(windowOver) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed")

    expect(view.queryByRole("button", { name: /^Reroll|^Pick another winner/ })).toBeNull()
    expect(view.getByText(windowOverText)).toBeTruthy()
  })

  it("says only beside the draw button that everyone was drawn when nobody is left to pick", async () => {
    mockDrawn({ "GET /api/live/gid-1": () => ok(nobodyLeft) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed")

    expect(view.queryByRole("button", { name: /^Reroll|^Pick another winner/ })).toBeNull()
    expect(view.getAllByText("All entrants drawn.")).toHaveLength(1)
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
          profileImageUrl: null,
          claimUntil: 1,
          claim: { state: "claimed", at: 1, via: "chat" },
        },
      ],
    }
    mockLive({ "GET /api/live/gid-1": () => ok(everyoneClaimed) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { name: "Winner 1 of 1" })

    expect(view.queryByText(windowOverText)).toBeNull()
  })

  it("keeps the reroll buttons and shows no explanation while the reroll window is open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { name: "Winner 1 of 3" })

    expect(view.queryByText(windowOverText)).toBeNull()
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
    await view.findByRole("heading", { name: "Winner 1 of 3" })
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
    await view.findByRole("heading", { name: "Winner 1 of 3" })
    fireEvent.click(view.getByRole("button", { name: "Reroll Wanda" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))

    expect(await view.findByText("No entrants are left to pick.")).toBeTruthy()
  })

  it("says chat entry is off, not the claim text, while entries are open", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, chatClaimUnavailable: true, chatEntryOff: true }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Chat watch is off" })).toBeTruthy()
    expect(view.getByText(/Chat entry is off/)).toBeTruthy()
    expect(view.queryByText(/Chat claim unavailable/)).toBeNull()
  })

  it("says sub and points entry is off while entries are open to them", async () => {
    mockLive({
      "GET /api/live/gid-1": () =>
        ok({
          ...liveSnapshot,
          chatClaimUnavailable: true,
          subEntryOff: true,
          pointsEntryOff: true,
        }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Chat watch is off" })).toBeTruthy()
    expect(view.getByText(/Sub and channel point entry is off/)).toBeTruthy()
    expect(view.queryByText(/Chat claim unavailable/)).toBeNull()
  })

  it("says only sub entry is off while the chat watch still runs", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, subEntryOff: true }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Entry is partly off" })).toBeTruthy()
    expect(view.getByText(/Sub entry is off/)).toBeTruthy()
    expect(view.queryByText(/Channel point entry is off/)).toBeNull()
    expect(view.queryByRole("heading", { name: "Chat watch is off" })).toBeNull()
  })

  it("says only channel point entry is off while the chat watch still runs", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, pointsEntryOff: true }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(/Channel point entry is off/)).toBeTruthy()
    expect(view.queryByText(/Sub entry is off/)).toBeNull()
  })

  it("explains that chat watch is off and marks a claim by hand", async () => {
    const requests = mockDrawn({
      "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: true }),
      "POST /api/dash/giveaways/gid-1/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Chat watch is off" })).toBeTruthy()
    // The entrants request is issued after the page renders; click only once it is answered, or it can land after the claim request.
    await view.findByText("Claimed")
    expect(view.getByText(/Chat claim unavailable/)).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Mark as claimed for Wanda" }))
    expect(await view.findByText("Marked as claimed.")).toBeTruthy()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/claim")).toEqual({
      route: "POST /api/dash/giveaways/gid-1/claim",
      body: { n: 0 },
    })
    expect(view.getAllByRole("button", { name: /Mark as claimed/ })).toHaveLength(2)
  })

  it("offers a manual claim for every unclaimed pick while chat watch works", async () => {
    const requests = mockDrawn({
      "GET /api/live/gid-1": () => ok(drawn),
      "POST /api/dash/giveaways/gid-1/claim": () => ok({ kind: "claimed" }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed")

    expect(view.queryByRole("heading", { name: "Chat watch is off" })).toBeNull()
    expect(view.queryByRole("button", { name: "Mark as claimed for Bob" })).toBeNull()
    expect(view.getAllByRole("button", { name: /Mark as claimed/ })).toHaveLength(2)
    fireEvent.click(
      within(await pickRow(view, "Eve")).getByRole("button", { name: "Mark as claimed for Eve" }),
    )
    expect(await view.findByText("Marked as claimed.")).toBeTruthy()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/claim")).toEqual({
      route: "POST /api/dash/giveaways/gid-1/claim",
      body: { n: 2 },
    })
  })
})

// The key listener is attached by an effect that can run after the toolbar is found; a key pressed before that is lost.
const effectsRun = () => act(async () => {})

describe("live page: clean mode", () => {
  const settings = { name: "Giveaway settings" }

  it("hides the controls bar and keeps the stage, the code and the list", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("region", settings)).toBeNull()
    expect(view.getByRole("button", { name: "Show controls" })).toBeTruthy()
    expect(plateName(view)).toBe("Wanda")
    expect(view.getByText("ABCDE")).toBeTruthy()
    expect(view.getByRole("heading", { name: /^Entrants/ })).toBeTruthy()
  })

  it("takes the buttons off the winners too, so nothing clickable is left on stream", async () => {
    mockDrawn({ "GET /api/live/gid-1": () => ok({ ...drawn, chatClaimUnavailable: true }) })

    const view = renderApp("/live/gid-1")
    await view.findByText("Claimed")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("button", { name: /^Reroll|^Pick another winner/ })).toBeNull()
    expect(view.queryByRole("button", { name: /Mark as claimed/ })).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Show controls" }))
    expect(view.getByRole("button", { name: "Reroll Wanda" })).toBeTruthy()
    expect(
      within(await pickRow(view, "Eve")).getByRole("button", { name: "Reroll Eve" }),
    ).toBeTruthy()
  })

  it("brings the bar back with Show controls", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))
    fireEvent.click(view.getByRole("button", { name: "Show controls" }))

    expect(view.getByRole("region", settings)).toBeTruthy()
    expect(view.queryByRole("button", { name: "Show controls" })).toBeNull()
  })

  it("stays on after the page is opened again", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const first = renderApp("/live/gid-1")
    fireEvent.click(await first.findByRole("button", { name: "Hide controls" }))
    cleanup()
    const again = renderApp("/live/gid-1")

    expect(await again.findByRole("button", { name: "Show controls" })).toBeTruthy()
    expect(again.queryByRole("region", settings)).toBeNull()
  })

  it("opens in clean mode from ?clean=1, and flipping stores the new choice and drops the parameter", async () => {
    expect(window.localStorage.getItem("rafflink-live-clean")).toBeNull()
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1?clean=1")
    fireEvent.click(await view.findByRole("button", { name: "Show controls" }))

    expect(view.getByRole("region", settings)).toBeTruthy()
    expect(window.localStorage.getItem("rafflink-live-clean")).toBe("0")
    await waitFor(() => expect(view.address()).toBe("/live/gid-1"))
  })

  it("opens with the controls from ?clean=0 although clean mode is stored", async () => {
    window.localStorage.setItem("rafflink-live-clean", "1")
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1?clean=0")

    expect(await view.findByRole("region", settings)).toBeTruthy()
  })

  it("starts with the bar when nothing was stored", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("region", settings)).toBeTruthy()
  })

  it("toggles with the c key in both directions", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("region", settings)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "c" })
    expect(view.queryByRole("region", settings)).toBeNull()
    fireEvent.keyDown(document.body, { key: "c" })

    expect(view.getByRole("region", settings)).toBeTruthy()
  })

  it("ignores the repeats of a held c key", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("region", settings)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "c" })
    fireEvent.keyDown(document.body, { key: "c", repeat: true })

    expect(view.queryByRole("region", settings)).toBeNull()
  })

  it("does not toggle while the streamer types in a field", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    const count = await view.findByLabelText("Planned winners")
    await effectsRun()
    fireEvent.keyDown(count, { key: "c" })
    expect(view.getByRole("region", settings)).toBeTruthy()
    fireEvent.keyDown(view.getByLabelText("Search by name"), { key: "c" })

    expect(view.getByRole("region", settings)).toBeTruthy()
  })

  it("ignores c with Ctrl, which copies, and while a confirmation is open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("region", settings)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true })
    expect(view.getByRole("region", settings)).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Closed" }))
    fireEvent.keyDown(document.body, { key: "c" })

    expect(view.getByRole("region", settings)).toBeTruthy()
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
    expect(entrantsHeading(view)).toBe("Entrants 3")
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
    const list = await view.findByRole("list", { name: "Chat" })

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
    await view.findByRole("heading", { name: "Winner 1 of 3" })

    expect(view.queryByRole("heading", { name: "Chat" })).toBeNull()
    expect(view.queryByRole("list", { name: "Chat" })).toBeNull()
  })

  const anyChatHint = "The winner's chat messages show here."

  it("says what the box will show while the winner on the plate has not written, and gives way to the first line", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(anyChatHint)).toBeTruthy()
    expect(view.queryByRole("list", { name: "Chat" })).toBeNull()
    act(() => FakeSocket.opened[0]?.push({ ...drawn, winnerChat: chat }))
    expect(await view.findByRole("list", { name: "Chat" })).toBeTruthy()
    expect(view.queryByText(anyChatHint)).toBeNull()
  })

  it("leaves the claim word to the winner instruction and does not repeat it in the chat hint", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ok(drawn),
      "GET /api/g/ABCDE": () =>
        ok({ ...giveaway, rules: { ...giveaway.rules, claimKeyword: "mine" } }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText(anyChatHint)).toBeTruthy()
    await view.findByText("mine")
    expect(view.container.querySelector(".live-claim-hint strong + strong")?.textContent).toBe(
      "mine",
    )
    expect(view.container.querySelector(".winner-chat-hint")?.textContent).toBe(anyChatHint)
  })

  it("keeps the chat box in a settled state: a hint before the first line, the lines after", async () => {
    const settled: LiveSnapshot = { ...drawn, winners: drawn.winners.slice(1, 2) }
    mockLive({ "GET /api/live/gid-1": () => ok(settled) })

    const view = renderApp("/live/gid-1")

    expect(
      await view.findByText("If the winner writes in chat, you will see it here."),
    ).toBeTruthy()
    act(() => FakeSocket.opened[0]?.push({ ...settled, winnerChat: chat }))
    expect(await view.findByRole("list", { name: "Chat" })).toBeTruthy()
    expect(view.queryByText("If the winner writes in chat, you will see it here.")).toBeNull()
  })

  const claimedOnly: LiveSnapshot = { ...drawn, winners: drawn.winners.slice(1, 2) }

  it.each([
    ["chat watch is off", { ...drawn, chatClaimUnavailable: true, winnerChatOpen: false }],
    ["a waiting pick's watch is over", { ...drawn, winnerChatOpen: false }],
    [
      "every pick is claimed and the window is over",
      { ...claimedOnly, winnerChatOpen: false, rerollOpen: false, rerollBlocked: null },
    ],
  ])("shows no hint when %s", async (_name, snapshot) => {
    mockLive({ "GET /api/live/gid-1": () => ok(snapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("heading", { name: /^Winner 1 of/ })

    expect(view.container.querySelector(".winner-chat-hint")).toBeNull()
  })

  it("drops the hint when a push says the chat watch is over", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(claimedOnly) })

    const view = renderApp("/live/gid-1")
    await view.findByText("If the winner writes in chat, you will see it here.")
    act(() => FakeSocket.opened[0]?.push({ ...claimedOnly, winnerChatOpen: false }))

    await waitFor(() =>
      expect(view.queryByText("If the winner writes in chat, you will see it here.")).toBeNull(),
    )
  })

  it("shows no hint in clean mode", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")
    await view.findByText(anyChatHint)
    fireEvent.click(view.getByRole("button", { name: "Hide controls" }))

    expect(view.queryByText(anyChatHint)).toBeNull()
  })

  it("is hidden in clean mode and back with Show controls", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat }) })

    const view = renderApp("/live/gid-1")
    expect(await view.findByRole("list", { name: "Chat" })).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("list", { name: "Chat" })).toBeNull()
    expect(view.queryByText("I am here!")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Show controls" }))
    expect(view.getByRole("list", { name: "Chat" })).toBeTruthy()
  })

  it("scrolls to the newest message when one arrives", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, winnerChat: chat.slice(0, 1) }) })

    const view = renderApp("/live/gid-1")
    const list = await view.findByRole("list", { name: "Chat" })
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
    const list = await view.findByRole("list", { name: "Chat" })
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
    const list = await view.findByRole("list", { name: "Chat" })
    // The chat's first effect may still be pending here; it would scroll to the bottom after the 120 below.
    await act(async () => {})
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
    mockLive({
      "GET /api/live/gid-1": () => ({ status: 401, body: { error: "unauthorized" } }),
      "GET /api/session": () =>
        ok({ streamer: null, signInPlatforms: ["twitch"], donateUrl: null, operator: null }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  it("offers a sign-in for every platform the install signs in with", async () => {
    mockLive({
      "GET /api/live/gid-1": () => ({ status: 401, body: { error: "unauthorized" } }),
      "GET /api/session": () =>
        ok({
          streamer: null,
          signInPlatforms: ["twitch", "kick", "youtube"],
          donateUrl: null,
          operator: null,
        }),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("link", { name: "Sign in with Kick" })).toBeTruthy()
    expect(view.getByRole("link", { name: "Sign in with YouTube" })).toBeTruthy()
    expect(view.getByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  it("answers not found for the giveaway of another streamer", async () => {
    mockLive({ "GET /api/live/gid-1": () => ({ status: 404, body: { error: "not-found" } }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Live page not found")).toBeTruthy()
  })

  it("reconnects after the socket drops and says so meanwhile", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText(openStage)

    act(() => FakeSocket.opened[0]?.drop())

    expect(await view.findByText("Reconnecting to the live feed…")).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(0) + 200))
    expect(FakeSocket.opened.length).toBe(2)
  })

  it("ignores a push that is not a snapshot", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })
    const view = renderApp("/live/gid-1")
    await view.findByText(openStage)

    act(() => FakeSocket.opened[0]?.push({ nonsense: true }))

    expect(view.getByText(openStage)).toBeTruthy()
  })
})

describe("reconnect delay", () => {
  it("doubles from one second and stops at the cap", () => {
    expect([0, 1, 2, 5, 6, 50].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 30_000, 30_000, 30_000,
    ])
  })
})

describe("live page: support link", () => {
  it("links the configured support page in the settings panel, opening in a new tab", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, donateUrl }) })

    const view = renderApp("/live/gid-1")

    const settings = within(await view.findByRole("region", { name: "Giveaway settings" }))
    const link = settings.getByRole("link", { name: "Support" })
    expect(link.getAttribute("href")).toBe(donateUrl)
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener nofollow")
  })

  it("hides the support link with the controls", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, donateUrl }) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("link", { name: "Support" })
    fireEvent.click(view.getByRole("button", { name: "Hide controls" }))

    expect(view.queryByRole("link", { name: "Support" })).toBeNull()
  })

  it("shows no support link when no page is configured", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, donateUrl: null }) })

    const view = renderApp("/live/gid-1")

    await view.findByRole("region", { name: "Giveaway settings" })
    expect(view.queryByRole("link", { name: "Support" })).toBeNull()
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
    const field = view.getByRole("textbox", { name: "Overlay link" })
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
    await view.findByText(openStage)
    fireEvent.click(view.getByRole("radio", { name: "Winner only" }))
    fireEvent.click(view.getByRole("radio", { name: "Show" }))

    const field = view.getByRole("textbox", { name: "Overlay link" })
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
    await view.findByText(openStage)
    fireEvent.click(view.getByRole("radio", { name: "Corner badge" }))
    fireEvent.click(view.getByRole("radio", { name: "Automatic" }))

    const field = view.getByRole("textbox", { name: "Overlay link" })
    expect(field instanceof HTMLInputElement && field.value).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
  })

  it("keeps the overlay link when a socket push arrives", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }) })

    const view = renderApp("/live/gid-1")
    await view.findByText(openStage)
    act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 9 }))

    await waitFor(() => expect(entrantsHeading(view)).toBe("Entrants 9"))
    expect(view.getByRole("textbox", { name: "Overlay link" })).toBeTruthy()
  })

  it("shows no overlay link when the answer carries no token", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")

    await view.findByText(openStage)
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

    expect(await view.findByText("Live page not found")).toBeTruthy()
    expect(view.container.querySelectorAll("main#main")).toHaveLength(1)
    expect(view.getByRole("banner").textContent).toContain("Rafflink")
    // The app frame's text column belongs to the app layout, not to the live page's own grid.
    expect(view.container.querySelector(".page")).toBeNull()
  })

  it("shows the entry link with the code and the LIVE chip in the top bar, and leaves the count to the list", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("LIVE")

    const bar = within(view.getByRole("banner"))
    expect(bar.queryByText("Enter at")).toBeNull()
    expect(bar.getByText("ABCDE").tagName).toBe("EM")
    expect(bar.queryByText("3")).toBeNull()
  })

  it("switches the theme and the language from the top bar", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByText("LIVE")
    const bar = within(view.getByRole("banner"))
    fireEvent.click(bar.getByRole("button", { name: "Display settings" }))
    fireEvent.click(bar.getByRole("radio", { name: "Dark" }))
    chooseLanguage(view.getByRole("banner"), "Čeština")

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(await view.findByText("Přihlašování je otevřené")).toBeTruthy()
  })

  it("takes the copy button and the settings out of the top bar in clean mode", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Hide controls" }))

    const bar = within(view.getByRole("banner"))
    expect(bar.queryByRole("button", { name: "Copy link" })).toBeNull()
    expect(bar.queryByRole("button", { name: "Display settings" })).toBeNull()
    expect(bar.getByText("ABCDE")).toBeTruthy()
  })
})

describe("live page: the winner on the stage", () => {
  const entrantRows = [
    {
      seq: 1,
      login: "wanda",
      displayName: "Wanda",
      tickets: 4,
      group: "sub_t2",
      profileImageUrl: null,
    },
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

  it("shows the current winner's profile picture on the stage", async () => {
    const picture = "https://static-cdn.jtvnw.net/jtv_user_pictures/wanda.png"
    const withPicture: LiveSnapshot = {
      ...drawn,
      winners: drawn.winners.map((winner) =>
        winner.displayName === "Wanda" ? { ...winner, profileImageUrl: picture } : winner,
      ),
    }
    mockLive({ "GET /api/live/gid-1": () => ok(withPicture) })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    expect(view.container.querySelector(".live-who .live-avatar img")?.getAttribute("src")).toBe(
      picture,
    )
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

  it("counts a replaced pick out of the winners and shows it as rerolled in the entrants table", async () => {
    const replaced: LiveSnapshot = {
      ...drawn,
      winners: [
        {
          n: 0,
          entrySeq: 3,
          displayName: "Eve",
          profileImageUrl: null,
          claimUntil: 1,
          claim: { state: "rerolled" },
        },
        {
          n: 1,
          entrySeq: 1,
          displayName: "Wanda",
          profileImageUrl: null,
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    mockDrawn({ "GET /api/live/gid-1": () => ok(replaced) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Winner 1 of 1" })).toBeTruthy()
    expect(await within(await pickRow(view, "Eve")).findByText("Rerolled")).toBeTruthy()
    expect(within(await pickRow(view, "Eve")).queryByRole("button")).toBeNull()
  })

  it("says how many tickets the pick was made from", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok({ ...drawn, ticketTotal: 622 }) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Picked from 622 tickets")).toBeTruthy()
  })

  it("empties the ring with the share of the claim window that is left", async () => {
    const waiting: LiveSnapshot = {
      ...drawn,
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Wanda",
          profileImageUrl: null,
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    mockLive({ "GET /api/live/gid-1": () => ok(waiting) })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    // 120 s of the 300 s window are left, so 60% of the ring is empty.
    await waitFor(() => {
      const bar = view.container.querySelector(".live-ring-bar")
      expect(Number(bar?.getAttribute("stroke-dashoffset"))).toBeCloseTo(2 * Math.PI * 52 * 0.6, 0)
    })
  })

  it("starts the ring full while the giveaway is not known", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    mockFetch({
      "GET /api/live/gid-1": () => ok(drawn),
      "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText("left to claim")

    const bar = view.container.querySelector(".live-ring-bar")
    expect(Number(bar?.getAttribute("stroke-dashoffset"))).toBe(0)
  })

  it("tells the urgency in words and in the ring when the claim time is nearly over", async () => {
    const hurry: LiveSnapshot = {
      ...drawn,
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Wanda",
          profileImageUrl: null,
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
  it("draws with the d key, not while typing and not with Ctrl", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () => ok({ ...liveSnapshot, status: "closed" }),
      "POST /api/dash/giveaways/gid-1/draw": () => ok({ kind: "drawn", picks: [0] }),
    })
    const drawRequests = () => requests.filter((request) => request.route.startsWith("POST"))

    const view = renderApp("/live/gid-1")
    const search = await view.findByLabelText("Search by name")
    await effectsRun()
    fireEvent.keyDown(search, { key: "d" })
    fireEvent.keyDown(document.body, { key: "d", ctrlKey: true })
    expect(drawRequests()).toHaveLength(0)
    fireEvent.keyDown(document.body, { key: "d" })

    await waitFor(() => expect(drawRequests()).toHaveLength(1))
    await effectsRun()
    expect(view.container.querySelector(".toast")).toBeNull()
    expect(drawRequests()).toHaveLength(1)
  })

  it("opens the close-entries question with the d key while entries are open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("button", { name: "Draw winner" })
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "d" })

    expect(view.getByRole("dialog", { name: "Close entries and draw a winner?" })).toBeTruthy()
  })

  it("does not draw with d when nobody entered", async () => {
    const requests = mockLive({
      "GET /api/live/gid-1": () =>
        ok({ ...liveSnapshot, status: "closed", entrantCount: 0, lastNames: [] }),
    })

    const view = renderApp("/live/gid-1")
    await view.findByText(/Nobody entered, so there is nobody to draw./)
    await effectsRun()
    fireEvent.keyDown(document.body, { key: "d" })

    expect(requests.some((request) => request.route.startsWith("POST"))).toBe(false)
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

  it("marks Open as pressed in the entries switch while entries are open", async () => {
    mockLive({ "GET /api/live/gid-1": () => ok(liveSnapshot) })

    const view = renderApp("/live/gid-1")
    const group = within(await view.findByRole("group", { name: "Entries" }))

    expect(group.getByRole("button", { name: "Open" }).getAttribute("aria-pressed")).toBe("true")
    expect(group.getByRole("button", { name: "Closed" }).getAttribute("aria-pressed")).toBeNull()
  })

  it.each([
    ["closed", { ...liveSnapshot, status: "closed" }],
    ["drawn", drawn],
  ] as const)("leaves the entries switch out once entries are %s", async (_name, snapshot) => {
    mockLive({ "GET /api/live/gid-1": () => ok(snapshot) })

    const view = renderApp("/live/gid-1")
    await view.findByRole("region", { name: "Giveaway settings" })

    expect(view.queryByRole("group", { name: "Entries" })).toBeNull()
  })
})

describe("live page: winner form answers", () => {
  const withForm = { ...giveaway, rules: { ...giveaway.rules, winnerForm: ["name", "address"] } }
  const answers = {
    form: ["name", "address"],
    picks: [
      {
        n: 1,
        answers: "sent",
        deliveredAt: null,
        values: { name: "Bob Smith", address: "Main Street 1\n12345 Town" },
      },
    ],
  }

  it("shows the claimed winners' answers to the streamer and deletes them when the prize is marked delivered", async () => {
    let delivered = false
    const requests = mockDrawn({
      "GET /api/g/ABCDE": () => ok(withForm),
      "GET /api/live/gid-1": () => ok(drawn),
      "GET /api/dash/giveaways/gid-1/answers": () =>
        ok(
          delivered
            ? {
                form: answers.form,
                picks: [{ ...answers.picks[0], values: null, deliveredAt: claimedAt }],
              }
            : answers,
        ),
      "POST /api/dash/giveaways/gid-1/delivered": () => {
        delivered = true
        return ok({ kind: "delivered" })
      },
    })

    const view = renderApp("/live/gid-1")
    const panel = within(
      (await view.findByRole("heading", { name: "Winner answers" })).closest("section")
        ?? document.body,
    )

    expect(await panel.findByText("Bob Smith")).toBeTruthy()
    expect(panel.getByRole("heading", { name: "Winner 2: Bob" })).toBeTruthy()
    fireEvent.click(panel.getByRole("button", { name: "Mark delivered" }))
    expect(await panel.findByText(`Delivered on ${claimedAtText}.`)).toBeTruthy()
    expect(panel.queryByText("Bob Smith")).toBeNull()
    expect(lastRequest(requests, "POST /api/dash/giveaways/gid-1/delivered")?.body).toEqual({
      n: 1,
    })
  })

  it("asks for no answers when the giveaway has no winner form", async () => {
    const requests = mockDrawn({ "GET /api/live/gid-1": () => ok(drawn) })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Claimed")).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Winner answers" })).toBeNull()
    expect(requests.some((request) => request.route.endsWith("/answers"))).toBe(false)
  })
})
