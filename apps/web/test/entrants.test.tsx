import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import type { Group } from "@rafflink/core/domain/groups"
import type { EntrantsDelta, LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import type { Entrant } from "@rafflink/core/room/rows"
import { reconnectDelayMs } from "../src/lib/use-live.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { entrantRowHeight } from "../src/components/entrants-table.tsx"
import { giveaway, liveSnapshot } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { inputOf } from "./queries.ts"
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

const entrantsPath = (after: number) => `GET /api/live/gid-1/entrants?after=${after}`

function entrant(seq: number, name: string, group: Group = "viewer", tickets = 1): Entrant {
  return { seq, login: name.toLowerCase(), displayName: name, tickets, group }
}

function numbered(from: number, to: number): Entrant[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => {
    const seq = from + offset
    return entrant(seq, `User${seq}`)
  })
}

function page(rows: readonly Entrant[], more = false): Reply {
  return ok({ rows, more })
}

function delta(fromSeq: number, rows: readonly Entrant[], truncated = false): EntrantsDelta {
  return { fromSeq, rows, truncated }
}

type Routes = Readonly<Record<string, () => Reply | Promise<Reply>>>

function mockEntrants(
  first: readonly Entrant[],
  extra: Routes = {},
  snapshot: LiveSnapshot = liveSnapshot,
) {
  return mockFetch({
    "GET /api/live/gid-1": () => ok(snapshot),
    "GET /api/g/ABCDE": () => ok(giveaway),
    [entrantsPath(0)]: () => page(first),
    ...extra,
  })
}

type View = ReturnType<typeof renderApp>

function tableRows(view: View): HTMLElement[] {
  return view.queryAllByRole("row").slice(1)
}

/** The text of each cell of a row: initials, name, status, tickets. */
function cellsOf(row: HTMLElement | undefined): (string | undefined)[] {
  return [
    row?.querySelector(".live-avatar")?.textContent,
    row?.querySelector(".entrants-primary")?.textContent,
    row?.querySelector(".entrants-status")?.textContent,
    row?.querySelector(".entrants-tickets")?.textContent,
  ]
}

function names(view: View): (string | undefined)[] {
  return tableRows(view).map((row) => row.querySelector(".entrants-primary")?.textContent)
}

function scrollerOf(view: View): HTMLElement {
  const scroller = view.container.querySelector(".entrants-scroll")
  if (!(scroller instanceof HTMLElement)) throw new Error("the entrants table is not shown")
  return scroller
}

function entrantRequests(requests: ReturnType<typeof mockFetch>): string[] {
  return requests.map((request) => request.route).filter((route) => route.includes("/entrants"))
}

async function openLive(first: readonly Entrant[], extra: Routes = {}, snapshot = liveSnapshot) {
  const requests = mockEntrants(first, extra, snapshot)
  const view = renderApp("/live/gid-1")
  await view.findByRole("heading", { name: /^Entrants/ })
  await waitFor(() => expect(requests.length).toBeGreaterThan(1))
  return { view, requests }
}

/** Opens the live page and delivers the first socket message, which is what makes the list ask for what it missed. */
async function connected(first: readonly Entrant[], extra: Routes = {}) {
  const opened = await openLive(first, {
    [entrantsPath(first.at(-1)?.seq ?? 0)]: () => page([]),
    ...extra,
  })
  await waitFor(() => expect(FakeSocket.opened.length).toBe(1))
  act(() => FakeSocket.opened[0]?.push(liveSnapshot))
  await waitFor(() => expect(entrantRequests(opened.requests).length).toBeGreaterThanOrEqual(2))
  // Lets the catch-up that the connection starts finish, so the push under test meets an idle list.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return opened
}

function pushDelta(socket: FakeSocket | undefined, entrantsAfter: EntrantsDelta) {
  act(() => socket?.push({ ...liveSnapshot, entrantCount: 9, entrantsAfter }))
}

describe("entrants table: the list", () => {
  it("lists the newest entrant first with the ticket count and the group in words", async () => {
    const { view } = await openLive([
      entrant(1, "Ada", "viewer", 1),
      entrant(2, "Bo", "sub_t2", 4),
      entrant(3, "Cy", "moderator", 7),
    ])

    await view.findByText("Cy")

    expect(names(view)).toEqual(["Cy", "Bo", "Ada"])
    expect(cellsOf(tableRows(view)[0])).toEqual(["CY", "Cy", "Mod", "7"])
    expect(cellsOf(tableRows(view)[1])).toEqual(["BO", "Bo", "Tier 2", "4"])
    expect(view.getByRole("heading", { name: "Entrants 3" })).toBeTruthy()
    expect(view.getByText("Showing 3 of 3")).toBeTruthy()
    expect(view.getByText("Winners first, then newest")).toBeTruthy()
  })

  it("counts the entrants of each tier next to what a ticket of the tier is worth", async () => {
    const { view } = await openLive([
      entrant(1, "Ada"),
      entrant(2, "Bo", "viewer"),
      entrant(3, "Cy", "sub_t2", 4),
    ])
    await view.findByText("Cy")

    const tiers = within(view.getByRole("list", { name: "Entrants per tier" }))
    expect(tiers.getByText("Viewer").nextElementSibling?.textContent).toBe("2x1")
    expect(tiers.getByText("Tier 2").nextElementSibling?.textContent).toBe("1x4")
    expect(tiers.getByText("Mod").nextElementSibling?.textContent).toBe("0x7")
  })

  it("lists only the tiers that have entrants while the rules of the giveaway are unknown", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    const { view } = await openLive([entrant(1, "Ada"), entrant(2, "Cy", "sub_t2", 4)], {
      "GET /api/g/ABCDE": () => ({ status: 500, body: { error: "unavailable" } }),
    })
    await view.findByText("Cy")

    const tiers = within(view.getByRole("list", { name: "Entrants per tier" }))
    expect(tiers.getByText("Viewer").nextElementSibling?.textContent).toBe("1")
    expect(tiers.getByText("Tier 2").nextElementSibling?.textContent).toBe("1")
    expect(tiers.queryByText("Mod")).toBeNull()
  })

  it("shows the login in small type only when it differs from the display name", async () => {
    const { view } = await openLive([
      entrant(1, "Ada"),
      { seq: 2, login: "bob_b", displayName: "Bobby", tickets: 1, group: "viewer" },
    ])

    await view.findByText("Bobby")

    expect(tableRows(view)[0]?.querySelector(".entrants-secondary")?.textContent).toBe("bob_b")
    expect(tableRows(view)[1]?.querySelector(".entrants-secondary")).toBeNull()
  })

  it("says the list is empty when nobody entered", async () => {
    const { view } = await openLive([])

    expect(await view.findByRole("heading", { name: "The list is empty" })).toBeTruthy()
    expect(view.queryByRole("table")).toBeNull()
  })

  it("shows a loading card until the first page arrives", async () => {
    const firstPage = Promise.withResolvers<Reply>()
    const requests = mockEntrants([], { [entrantsPath(0)]: () => firstPage.promise })

    const view = renderApp("/live/gid-1")

    expect(await view.findByRole("heading", { name: "Loading the list" })).toBeTruthy()
    expect(view.queryByRole("table")).toBeNull()
    firstPage.resolve(page([entrant(1, "Ada")]))
    expect(await view.findByText("Ada")).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Loading the list" })).toBeNull()
    expect(entrantRequests(requests)).toEqual([entrantsPath(0)])
  })

  it("explains a failed load and loads again on Try again", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    let calls = 0
    mockEntrants([], {
      [entrantsPath(0)]: () => {
        calls += 1
        return calls === 1
          ? { status: 500, body: { error: "room-unavailable" } }
          : page([entrant(1, "Ada")])
      },
    })

    const view = renderApp("/live/gid-1")
    const retry = await view.findByRole("button", { name: "Try again" })
    expect(view.getByText("The list did not load")).toBeTruthy()
    fireEvent.click(retry)

    expect(await view.findByText("Ada")).toBeTruthy()
    expect(view.queryByText("The list did not load")).toBeNull()
  })
})

describe("entrants table: paging and virtualization", () => {
  it("follows the pages of the server until the last one", async () => {
    const requests = mockEntrants([], {
      [entrantsPath(0)]: () => page(numbered(1, 5000), true),
      [entrantsPath(5000)]: () => page(numbered(5001, 10_000)),
    })

    const view = renderApp("/live/gid-1")

    expect(await view.findByText("Showing 10,000 of 10,000")).toBeTruthy()
    expect(entrantRequests(requests)).toEqual([entrantsPath(0), entrantsPath(5000)])
  })

  it("renders a bounded number of rows for 10,000 entries and follows the scroll", async () => {
    mockEntrants(numbered(1, 10_000))

    const view = renderApp("/live/gid-1")
    await view.findByText("Showing 10,000 of 10,000")
    const first = tableRows(view)

    expect(first.length).toBeLessThan(40)
    expect(first.length).toBeGreaterThanOrEqual(8)
    expect(view.getByRole("table").getAttribute("aria-rowcount")).toBe("10001")
    expect(names(view)[0]).toBe("User10000")

    const scroller = scrollerOf(view)
    scroller.scrollTop = entrantRowHeight * 5000
    fireEvent.scroll(scroller)

    expect(tableRows(view).length).toBeLessThan(40)
    expect(names(view)).toContain("User5000")
    expect(names(view)).not.toContain("User10000")
    expect(tableRows(view)[0]?.getAttribute("aria-rowindex")).not.toBe("2")
  })
})

describe("entrants table: search", () => {
  const people = [
    entrant(1, "Bob"),
    entrant(2, "ArDeA"),
    entrant(3, "Canada"),
    entrant(4, "Zoe_Ada"),
    entrant(5, "Adam"),
  ]

  it("ranks a prefix above a word start, a contiguous run and scattered letters, and counts the hits", async () => {
    const { view } = await openLive(people)
    await view.findByText("Adam")

    fireEvent.change(view.getByLabelText("Search by name"), { target: { value: "ada" } })

    await waitFor(() => expect(names(view)).toEqual(["Adam", "Zoe_Ada", "Canada", "ArDeA"]))
    expect(view.getByText("Showing 4 of 5")).toBeTruthy()
  })

  it("highlights the matched letters", async () => {
    const { view } = await openLive(people)
    await view.findByText("Adam")

    fireEvent.change(view.getByLabelText("Search by name"), { target: { value: "ada" } })

    await waitFor(() => expect(view.queryAllByRole("row").length).toBe(5))
    const marks = (index: number) =>
      [...(tableRows(view)[index]?.querySelectorAll("mark") ?? [])].map((mark) => mark.textContent)
    expect(marks(0)).toEqual(["Ada"])
    expect(marks(1)).toEqual(["Ada"])
    expect(marks(3)).toEqual(["A", "D", "A"])
  })

  it("matches the login when it differs from the display name", async () => {
    const { view } = await openLive([
      { seq: 1, login: "quiet_fox", displayName: "Reynard", tickets: 1, group: "viewer" },
      entrant(2, "Bob"),
    ])
    await view.findByText("Reynard")

    fireEvent.change(view.getByLabelText("Search by name"), { target: { value: "FOX" } })

    await waitFor(() => expect(names(view)).toEqual(["Reynard"]))
    expect(tableRows(view)[0]?.querySelector("mark")?.textContent).toBe("fox")
  })

  it("says nobody matches and brings the list back on Clear search", async () => {
    const { view } = await openLive(people)
    await view.findByText("Adam")

    fireEvent.change(view.getByLabelText("Search by name"), { target: { value: "zzz" } })

    expect(await view.findByRole("heading", { name: "Nobody matches your search" })).toBeTruthy()
    expect(view.getByText("Showing 0 of 5")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Clear search" }))
    await waitFor(() => expect(names(view).length).toBe(5))
    expect(inputOf(view.getByLabelText("Search by name")).value).toBe("")
  })

  it("keeps the first rows in view when the search changes after a scroll", async () => {
    const { view } = await openLive(numbered(1, 2000))
    await view.findByText("Showing 2,000 of 2,000")
    const scroller = scrollerOf(view)
    scroller.scrollTop = entrantRowHeight * 1500
    fireEvent.scroll(scroller)

    fireEvent.change(view.getByLabelText("Search by name"), { target: { value: "user19" } })

    await waitFor(() => expect(names(view)[0]).toBe("User19"))
    expect(scroller.scrollTop).toBe(0)
  })
})

describe("entrants table: winners", () => {
  it("lists winners first by place with their claim state, then everyone else newest first", async () => {
    const snapshot: LiveSnapshot = {
      ...liveSnapshot,
      status: "drawn",
      winners: [
        {
          n: 1,
          entrySeq: 2,
          displayName: "Bo",
          claimUntil: 1,
          claim: { state: "claimed", at: 1, via: "chat" },
        },
        { n: 0, entrySeq: 1, displayName: "Ada", claimUntil: 1, claim: { state: "expired" } },
        { n: 2, entrySeq: 9, displayName: "Gone", claimUntil: 1, claim: { state: "rerolled" } },
      ],
    }
    const { view } = await openLive(
      [entrant(1, "Ada"), entrant(2, "Bo"), entrant(3, "Cy"), entrant(4, "Di")],
      {},
      snapshot,
    )
    await view.findByText("Di")

    expect(names(view)).toEqual(["Ada", "Bo", "Di", "Cy"])
    expect(cellsOf(tableRows(view)[0])[2]).toBe("Did not claim")
    expect(tableRows(view)[0]?.getAttribute("data-claim")).toBe("expired")
    expect(cellsOf(tableRows(view)[1])[2]).toBe("Claimed")
    expect(tableRows(view)[1]?.getAttribute("data-claim")).toBe("claimed")
    expect(tableRows(view)[2]?.getAttribute("data-claim")).toBeNull()
  })

  it("puts the winner whose claim is open above the settled winners", async () => {
    const snapshot: LiveSnapshot = {
      ...liveSnapshot,
      status: "drawn",
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Ada",
          claimUntil: 1,
          claim: { state: "claimed", at: 1, via: "chat" },
        },
        { n: 1, entrySeq: 2, displayName: "Bo", claimUntil: 1, claim: { state: "rerolled" } },
        {
          n: 2,
          entrySeq: 3,
          displayName: "Cy",
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    const { view } = await openLive(
      [entrant(1, "Ada"), entrant(2, "Bo"), entrant(3, "Cy"), entrant(4, "Di")],
      {},
      snapshot,
    )
    await view.findByText("Di")

    expect(names(view)).toEqual(["Cy", "Ada", "Bo", "Di"])
  })

  it("numbers a waiting winner in the list the same way as the stage heading after a reroll", async () => {
    const snapshot: LiveSnapshot = {
      ...liveSnapshot,
      status: "drawn",
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Ada",
          claimUntil: 1,
          claim: { state: "claimed", at: 1, via: "chat" },
        },
        { n: 1, entrySeq: 2, displayName: "Bo", claimUntil: 1, claim: { state: "rerolled" } },
        {
          n: 2,
          entrySeq: 3,
          displayName: "Cy",
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    const { view } = await openLive(
      [entrant(1, "Ada"), entrant(2, "Bo"), entrant(3, "Cy")],
      {},
      snapshot,
    )

    await view.findByRole("heading", { name: "Winner 2 of 2" })
    expect(await view.findByText("Winner 2")).toBeTruthy()
    expect(view.queryByText("Winner 3")).toBeNull()
  })

  it("says Winner and the place for a winner whose claim is still open, and shows the claim clock on the stage only", async () => {
    const snapshot: LiveSnapshot = {
      ...liveSnapshot,
      status: "drawn",
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Ada",
          claimUntil: Date.now() + 120_000,
          claim: { state: "waiting" },
        },
      ],
    }
    const { view } = await openLive([entrant(1, "Ada")], {}, snapshot)

    await view.findByText("Winner 1")

    expect(tableRows(view)[0]?.querySelector("[role=timer]")).toBeNull()
    expect(view.getAllByRole("timer")).toHaveLength(1)
    expect(tableRows(view)[0]?.getAttribute("data-claim")).toBe("waiting")
  })
})

describe("entrants table: the live socket", () => {
  it("appends the entrants of a push without asking the server", async () => {
    const { view, requests } = await connected([entrant(1, "Ada"), entrant(2, "Bo")])

    pushDelta(FakeSocket.opened[0], delta(2, [entrant(3, "Cy"), entrant(4, "Di")]))

    await waitFor(() => expect(names(view)).toEqual(["Di", "Cy", "Bo", "Ada"]))
    expect(entrantRequests(requests)).toEqual([entrantsPath(0), entrantsPath(2)])
  })

  it("ignores rows it already has", async () => {
    const { view } = await connected([entrant(1, "Ada"), entrant(2, "Bo")])

    pushDelta(FakeSocket.opened[0], delta(1, [entrant(2, "Bo"), entrant(3, "Cy")]))

    await waitFor(() => expect(names(view)).toEqual(["Cy", "Bo", "Ada"]))
  })

  it("fetches the rest over HTTP when a push says more arrived than it carries", async () => {
    const { view, requests } = await connected([entrant(1, "Ada"), entrant(2, "Bo")], {
      [entrantsPath(3)]: () => page([entrant(4, "Di"), entrant(5, "Ed")]),
    })

    pushDelta(FakeSocket.opened[0], delta(2, [entrant(3, "Cy")], true))

    await waitFor(() => expect(names(view)).toEqual(["Ed", "Di", "Cy", "Bo", "Ada"]))
    expect(entrantRequests(requests).at(-1)).toBe(entrantsPath(3))
  })

  it("fetches from its last row when a push starts after a gap and drops that push's rows", async () => {
    let asked = 0
    const { view, requests } = await connected([entrant(1, "Ada"), entrant(2, "Bo")], {
      [entrantsPath(2)]: () => {
        asked += 1
        return asked === 1 ? page([]) : page([entrant(3, "Cy"), entrant(4, "Di"), entrant(5, "Ed")])
      },
    })

    pushDelta(FakeSocket.opened[0], delta(4, [entrant(5, "Ed")]))

    await waitFor(() => expect(names(view)).toEqual(["Ed", "Di", "Cy", "Bo", "Ada"]))
    expect(entrantRequests(requests).at(-1)).toBe(entrantsPath(2))
  })

  it("catches up from its last row when the socket connects again", async () => {
    const { view, requests } = await connected([entrant(1, "Ada")], {
      [entrantsPath(2)]: () => page([entrant(3, "Cy")]),
    })
    pushDelta(FakeSocket.opened[0], delta(1, [entrant(2, "Bo")]))
    await waitFor(() => expect(names(view)).toEqual(["Bo", "Ada"]))

    act(() => FakeSocket.opened[0]?.drop())
    await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs(0) + 200))
    expect(FakeSocket.opened.length).toBe(2)
    act(() => FakeSocket.opened[1]?.push(liveSnapshot))

    await waitFor(() => expect(names(view)).toEqual(["Cy", "Bo", "Ada"]))
    expect(entrantRequests(requests).at(-1)).toBe(entrantsPath(2))
  })
})
