import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, waitFor } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { encode } from "uqr"
import { shareUrl } from "../src/lib/links.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { donateUrl, giveaway, liveSnapshot } from "./fixtures.ts"
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
})

const drawn: LiveSnapshot = {
  ...liveSnapshot,
  status: "drawn",
  winners: [
    {
      n: 0,
      entrySeq: 1,
      displayName: "Bob",
      profileImageUrl: null,
      claimUntil: 1,
      claim: { state: "claimed", at: 1, via: "chat" },
    },
  ],
}

function routeSnapshot(
  snapshot: LiveSnapshot,
  giveawayReply: () => Reply | Promise<Reply> = () => ok({ ...giveaway, prize: null }),
) {
  return mockFetch({
    "GET /api/overlay/gid-1/tok-1": () => ok(snapshot),
    "GET /api/g/ABCDE": giveawayReply,
  })
}

it("shows the live view read-only on the overlay socket without a session", async () => {
  mockFetch({
    "GET /api/overlay/gid-1/tok-1": () =>
      ok({ ...liveSnapshot, chatClaimUnavailable: true, roleRefreshFailures: 3 }),
  })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Ada")).toBeTruthy()
  expect(view.getByText("Summer giveaway")).toBeTruthy()
  expect(view.getByText("ABCDE")).toBeTruthy()
  expect(view.getByText("people entered")).toBeTruthy()
  expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/overlay/gid-1/tok-1")
  act(() => FakeSocket.opened[0]?.push({ ...liveSnapshot, entrantCount: 11 }))
  expect(await view.findByText("11")).toBeTruthy()
  expect(view.queryAllByRole("button")).toHaveLength(0)
  expect(view.queryByText(/Chat claim unavailable/)).toBeNull()
  expect(view.queryByText(/Chat watch is off/)).toBeNull()
  expect(view.queryByRole("heading", { name: "Problems" })).toBeNull()
  expect(document.documentElement.dataset.surface).toBe("overlay")
})

it("never shows a support link, even when the answer carries one", async () => {
  mockFetch({ "GET /api/overlay/gid-1/tok-1": () => ok({ ...liveSnapshot, donateUrl }) })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Ada")).toBeTruthy()
  expect(view.queryAllByRole("link")).toHaveLength(0)
})

it("names the giveaway by its code when the title is missing", async () => {
  mockFetch({ "GET /api/overlay/gid-1/tok-1": () => ok({ ...liveSnapshot, title: null }) })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByRole("heading", { level: 1, name: "Giveaway ABCDE" })).toBeTruthy()
})

it("shows the winner on a plate after a draw", async () => {
  routeSnapshot(drawn)

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Bob")).toBeTruthy()
  expect(view.container.querySelectorAll(".winner-plate")).toHaveLength(1)
  expect(view.queryByText("people entered")).toBeNull()
})

it("labels each standing winner by place and counts down the claim only for a waiting one", async () => {
  routeSnapshot({
    ...drawn,
    winners: [
      {
        n: 0,
        entrySeq: 1,
        displayName: "Bob",
        profileImageUrl: null,
        claimUntil: 1,
        claim: { state: "claimed", at: 1, via: "chat" },
      },
      {
        n: 1,
        entrySeq: 2,
        displayName: "Cy",
        profileImageUrl: null,
        claimUntil: Date.now() + 90_000,
        claim: { state: "waiting" },
      },
    ],
  })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Winner 1 of 2")).toBeTruthy()
  expect(view.getByText("Winner 2 of 2")).toBeTruthy()
  // The plates show the title once the prize answer says there is none.
  await waitFor(() => expect(view.getAllByText("Summer giveaway")).toHaveLength(3))
  expect(view.getAllByRole("timer")).toHaveLength(1)
  expect(view.getByRole("timer").textContent).toBe("1:30")
  expect(view.getByText("to claim")).toBeTruthy()
})

/** A drawn snapshot with `count` waiting winners, as one batch draw leaves it. */
const batch = (count: number): LiveSnapshot => ({
  ...drawn,
  winners: Array.from({ length: count }, (_, n) => ({
    n,
    entrySeq: n + 1,
    displayName: `Winner${n + 1}`,
    profileImageUrl: null,
    claimUntil: Date.now() + 90_000,
    claim: { state: "waiting" as const },
  })),
})

describe("a batch of winners", () => {
  it("lists more winners than plates fit on one plate, without claim clocks", async () => {
    routeSnapshot(batch(4))

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Winner4")).toBeTruthy()
    expect(view.getByRole("heading", { level: 2, name: "Winners" })).toBeTruthy()
    expect(view.container.querySelectorAll(".overlay-winner")).toHaveLength(1)
    expect(view.container.querySelectorAll(".overlay-winner-list li")).toHaveLength(4)
    expect(view.queryByRole("timer")).toBeNull()
  })

  it("lists the newest 24 of a large batch and counts the rest", async () => {
    routeSnapshot(batch(500))

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Winner500")).toBeTruthy()
    expect(view.container.querySelectorAll(".overlay-winner-list li")).toHaveLength(24)
    expect(view.queryByText("Winner476")).toBeNull()
    expect(view.getByText("Winner477")).toBeTruthy()
    expect(view.getByText("and 476 more")).toBeTruthy()
  })

  it("names the newest 24 of a large batch on the compact plate and counts the rest", async () => {
    routeSnapshot(batch(30))

    const view = renderApp("/overlay/gid-1/tok-1?mode=compact")

    const line = await view.findByText(/Winner30/)
    expect(line.textContent).toStartWith("Winner7, Winner8")
    expect(line.textContent).toEndWith("Winner30 and 6 more")
  })
})

it("shows the prize on each winner plate", async () => {
  routeSnapshot(
    {
      ...drawn,
      winners: [
        {
          n: 0,
          entrySeq: 1,
          displayName: "Bob",
          profileImageUrl: null,
          claimUntil: 1,
          claim: { state: "waiting" },
        },
        {
          n: 1,
          entrySeq: 2,
          displayName: "Cy",
          profileImageUrl: null,
          claimUntil: 1,
          claim: { state: "waiting" },
        },
      ],
    },
    () => ok(giveaway),
  )

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findAllByText("A gaming chair")).toHaveLength(2)
  expect(view.getAllByText("Summer giveaway")).toHaveLength(1)
})

it("leaves the prize line empty while the prize loads, so the title never flashes first", async () => {
  routeSnapshot(drawn, () => new Promise<Reply>(() => {}))

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Bob")).toBeTruthy()
  expect(view.container.querySelector(".overlay-prize")?.textContent).toBe("")
  expect(view.getAllByText("Summer giveaway")).toHaveLength(1)
})

it("does not load the prize in compact mode, which shows no prize", async () => {
  const requests = routeSnapshot(drawn)

  const view = renderApp("/overlay/gid-1/tok-1?mode=compact")
  await view.findByRole("heading", { level: 1, hidden: true })

  expect(requests.map((request) => request.route).toSorted()).toEqual([
    "GET /api/overlay/gid-1/tok-1",
    "GET /api/overlay/gid-1/tok-1/theme",
  ])
})

it("does not load the prize while the giveaway is open", async () => {
  const requests = routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1")
  await view.findByRole("heading", { level: 1, hidden: true })

  expect(requests.map((request) => request.route).toSorted()).toEqual([
    "GET /api/overlay/gid-1/tok-1",
    "GET /api/overlay/gid-1/tok-1/theme",
  ])
})

it.each([
  ["has no prize", null],
  ["has an empty prize", ""],
  ["has a blank prize", "  "],
])("names the giveaway on the plate when it %s", async (_case, prize) => {
  routeSnapshot(drawn, () => ok({ ...giveaway, prize }))

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Bob")).toBeTruthy()
  await waitFor(() => expect(view.getAllByText("Summer giveaway")).toHaveLength(2))
  expect(view.queryByText("A gaming chair")).toBeNull()
})

it("names the giveaway on the plate and logs when the prize cannot be loaded", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {})
  routeSnapshot(drawn, () => ({ status: 500, body: { error: "unavailable" } }))

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Bob")).toBeTruthy()
  await waitFor(() =>
    expect(logged).toHaveBeenCalledWith("load failed", { errorClass: "ApiError", round: 0 }),
  )
  expect(view.getAllByText("Summer giveaway")).toHaveLength(2)
})

it("keeps a replaced winner off the overlay", async () => {
  routeSnapshot({
    ...drawn,
    winners: [
      {
        n: 0,
        entrySeq: 1,
        displayName: "Bob",
        profileImageUrl: null,
        claimUntil: 1,
        claim: { state: "rerolled" },
      },
      {
        n: 1,
        entrySeq: 2,
        displayName: "Cy",
        profileImageUrl: null,
        claimUntil: 1,
        claim: { state: "waiting" },
      },
    ],
  })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Cy")).toBeTruthy()
  expect(view.queryByText("Bob")).toBeNull()
})

it("shows the code, the count and the newest names in compact mode while open", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=compact")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.getByText("3")).toBeTruthy()
  expect(view.getByText("Ada")).toBeTruthy()
  expect(view.container.querySelector(".winner-plate")).toBeNull()
})

it("keeps the corner badge small after a draw and names the standing winner on it", async () => {
  routeSnapshot({
    ...drawn,
    winners: [
      {
        n: 0,
        entrySeq: 1,
        displayName: "Bob",
        profileImageUrl: null,
        claimUntil: 1,
        claim: { state: "rerolled" },
      },
      {
        n: 1,
        entrySeq: 2,
        displayName: "Cy",
        profileImageUrl: null,
        claimUntil: 1,
        claim: { state: "waiting" },
      },
    ],
  })

  const view = renderApp("/overlay/gid-1/tok-1?mode=compact")

  expect(await view.findByText("Cy")).toBeTruthy()
  expect(view.getByText("Winners")).toBeTruthy()
  expect(view.queryByText("Bob")).toBeNull()
  expect(view.container.querySelector(".winner-plate")).toBeNull()
  expect(view.queryByText("ABCDE")).toBeNull()
  expect(view.queryByText("people entered")).toBeNull()
})

it("says the entries are closed on the chip once they close", async () => {
  routeSnapshot({ ...liveSnapshot, status: "closed" })

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("Entries closed")).toBeTruthy()
  expect(view.queryByText("Enter at")).toBeNull()
})

it("treats an unknown mode like auto", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=sideways")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.getByText("Ada")).toBeTruthy()
})

it("shows only the winner plate in winner mode after a draw", async () => {
  routeSnapshot(drawn)

  const view = renderApp("/overlay/gid-1/tok-1?mode=winner")

  expect(await view.findByText("Bob")).toBeTruthy()
  expect(view.queryByText("ABCDE")).toBeNull()
  expect(view.queryByRole("img")).toBeNull()
})

it("shows nothing before a draw in winner mode", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=winner")

  expect(await view.findByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
  expect(view.queryByText("Ada")).toBeNull()
  expect(view.queryByText("ABCDE")).toBeNull()
  expect(view.queryByText("people entered")).toBeNull()
  expect(view.queryByRole("img")).toBeNull()
  expect(view.container.querySelector(".winner-plate")).toBeNull()
})

it("draws a QR code of the viewer link beside the code with qr=1", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?qr=1")

  const qr = await view.findByRole("img", { name: "QR code with the link to enter the giveaway" })
  const { data, size } = encode(shareUrl("ABCDE"), { ecc: "M", border: 4 })
  expect(qr.getAttribute("viewBox")).toBe(`0 0 ${size} ${size}`)
  const dark = [...qr.querySelectorAll("rect")].map(
    (rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`,
  )
  const expected = data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`${x},${y}`] : [])))
  expect(dark).toEqual(expected)
  expect(qr.querySelector("[style]")).toBeNull()
})

it("draws no QR code unless qr is 1", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?qr=true")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.queryByRole("img")).toBeNull()
})

it.each(["auto", "compact", "winner"])(
  "draws the QR code with qr=1 after a draw in %s mode, outside the winner plate",
  async (mode) => {
    routeSnapshot(drawn)

    const view = renderApp(`/overlay/gid-1/tok-1?mode=${mode}&qr=1`)

    expect(await view.findByText("Bob")).toBeTruthy()
    const qr = view.getByRole("img", { name: "QR code with the link to enter the giveaway" })
    expect(qr.closest(".overlay-winner")).toBeNull()
  },
)

it("draws the QR code with qr=1 in winner mode before a draw", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1?mode=winner&qr=1")

  expect(
    await view.findByRole("img", { name: "QR code with the link to enter the giveaway" }),
  ).toBeTruthy()
})

const mark = (view: ReturnType<typeof renderApp>) => view.container.querySelector(".overlay-host")

it("never invites to run a giveaway on the overlay", async () => {
  routeSnapshot(liveSnapshot)

  const view = renderApp("/overlay/gid-1/tok-1")

  expect(await view.findByText("ABCDE")).toBeTruthy()
  expect(view.queryByRole("link", { name: "Run your own giveaway with Rafflink" })).toBeNull()
})

describe("host mark", () => {
  it("stays off while the entry plate shows the host", async () => {
    for (const snapshot of [liveSnapshot, { ...liveSnapshot, status: "closed" as const }]) {
      routeSnapshot(snapshot)
      const view = renderApp("/overlay/gid-1/tok-1")
      expect(await view.findByText("ABCDE")).toBeTruthy()
      expect(mark(view)).toBeNull()
      cleanup()
      mock.restore()
    }
  })

  it("stays off the blank winner-mode overlay before a draw", async () => {
    routeSnapshot(liveSnapshot)

    const view = renderApp("/overlay/gid-1/tok-1?mode=winner")

    expect(await view.findByRole("heading", { level: 1, name: "Summer giveaway" })).toBeTruthy()
    expect(mark(view)).toBeNull()
  })

  it("names the deployment's host under the shuffle while a draw is pending", async () => {
    routeSnapshot({
      ...liveSnapshot,
      status: "closed",
      drawRequested: true,
      drawAvailableAt: liveSnapshot.now + 5000,
      shuffleNames: ["Ann", "Bo"],
    })

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findAllByText("Drawing the winner…")).not.toHaveLength(0)
    expect(mark(view)?.textContent).toBe("Rrafflink.test")
    expect(mark(view)?.parentElement?.className).toBe("overlay-plate overlay-winner")
  })

  it("names the deployment's host under a claimed winner, in every mode", async () => {
    for (const mode of ["auto", "winner", "compact"]) {
      routeSnapshot(drawn)
      const view = renderApp(`/overlay/gid-1/tok-1?mode=${mode}`)
      expect(await view.findByText("Bob")).toBeTruthy()
      expect(mark(view)?.textContent).toBe("Rrafflink.test")
      expect(mark(view)?.parentElement?.lastElementChild).toBe(mark(view))
      expect(mark(view)?.parentElement?.classList.contains("overlay-plate")).toBe(true)
      cleanup()
      mock.restore()
    }
  })

  it("names the host once, on the last of several winner plates", async () => {
    routeSnapshot({
      ...drawn,
      winners: [
        ...drawn.winners,
        {
          n: 1,
          entrySeq: 2,
          displayName: "Cy",
          profileImageUrl: null,
          claimUntil: 1,
          claim: { state: "claimed", at: 1, via: "chat" },
        },
      ],
    })

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByText("Cy")).toBeTruthy()
    const plates = view.container.querySelectorAll(".overlay-winner")
    expect(plates).toHaveLength(2)
    expect(plates[0]?.querySelector(".overlay-host")).toBeNull()
    expect(plates[1]?.lastElementChild).toBe(mark(view))
  })

  it("keeps the host on a plate of its own when no winner stands", async () => {
    routeSnapshot({
      ...drawn,
      winners: drawn.winners.map((winner) => ({ ...winner, claim: { state: "rerolled" } })),
    })

    const view = renderApp("/overlay/gid-1/tok-1")

    expect(await view.findByRole("heading", { level: 2, name: "Winners" })).toBeTruthy()
    expect(mark(view)?.textContent).toBe("Rrafflink.test")
    expect(view.container.querySelectorAll(".overlay-winner")).toHaveLength(1)
    expect(mark(view)?.parentElement?.className).toBe("overlay-plate overlay-winner")
    expect(view.container.querySelector(".winner-plate")).toBeNull()
  })
})

it("shows not found for an invalid token and opens no socket", async () => {
  mockFetch({ "GET /api/overlay/gid-1/bad": () => ({ status: 404, body: { error: "not-found" } }) })

  const view = renderApp("/overlay/gid-1/bad")

  expect(await view.findByRole("heading", { level: 1, name: "Not found" })).toBeTruthy()
  expect(view.queryAllByRole("link")).toHaveLength(0)
  expect(FakeSocket.opened).toHaveLength(0)
})
