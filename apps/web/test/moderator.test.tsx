import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, within } from "@testing-library/react"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
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
  window.sessionStorage.clear()
})

const token = `${"a".repeat(32)}.${"b".repeat(32)}`

/** What a moderator link's live page asks for besides its snapshot. */
function mockModerator(routes: Readonly<Record<string, () => Reply>>) {
  return mockFetch({
    "GET /api/g/ABCDE": () => ok(giveaway),
    "GET /api/mod/gid-1": () => ok(liveSnapshot),
    "GET /api/mod/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    "GET /api/mod/gid-1/badges": () => ok({ sub_t1: null, sub_t2: null, sub_t3: null }),
    ...routes,
  })
}

const refused = (status: number, error: string): Reply => ({ status, body: { error } })

describe("opening a moderator link", () => {
  it("sends the token from the fragment once and moves to the moderator page without it", async () => {
    const requests = mockModerator({
      "POST /api/moderator-links/open": () => ok({ giveawayId: "gid-1" }),
    })

    const view = renderApp(`/mod#${token}`)

    expect(await view.findByRole("heading", { name: "Entries are open" })).toBeTruthy()
    expect(view.address()).toBe("/mod/gid-1")
    expect(
      requests.find((request) => request.route === "POST /api/moderator-links/open")?.body,
    ).toEqual({ token })
    expect(FakeSocket.opened[0]?.url).toBe("ws://rafflink.test/api/mod/gid-1")
  })

  it("sends a signed-out opener to the moderator sign-in and keeps no copy of the token", async () => {
    mockModerator({ "POST /api/moderator-links/open": () => refused(401, "sign-in-required") })

    const view = renderApp(`/mod#${token}`)

    const signIn = await view.findByRole("link", { name: "Sign in with Twitch" })
    expect(signIn.getAttribute("href")).toBe("/auth/twitch/moderator/start")
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
  })

  it("explains where the moderator sign-in ended when it came back without the moderator page", async () => {
    const requests = mockModerator({})
    const cases = [
      ["not-a-moderator", "Only for moderators"],
      ["link-invalid", "This moderator link does not work"],
      ["cancelled", "The Twitch sign-in did not finish. Open the link from the streamer again."],
      [
        "invalid-state",
        "The Twitch sign-in did not finish. Open the link from the streamer again.",
      ],
    ] as const

    for (const [outcome, text] of cases) {
      const view = renderApp(`/mod?moderator=${outcome}`)
      expect(await view.findByText(text)).toBeTruthy()
      cleanup()
    }
    expect(requests.filter((request) => request.route.startsWith("POST"))).toHaveLength(0)
  })

  it("says a revoked or mistyped link does not work, and sends nothing without a token", async () => {
    const requests = mockModerator({
      "POST /api/moderator-links/open": () => refused(403, "link-invalid"),
    })

    const view = renderApp(`/mod#${token}`)
    expect(await view.findByText("This moderator link does not work")).toBeTruthy()
    cleanup()

    const empty = renderApp("/mod")
    expect(await empty.findByText("This moderator link does not work")).toBeTruthy()
    expect(requests.filter((request) => request.route.startsWith("POST"))).toHaveLength(1)
  })

  it("tells a signed-in account that is not a moderator why it is refused", async () => {
    mockModerator({ "POST /api/moderator-links/open": () => refused(403, "not-a-moderator") })

    const view = renderApp(`/mod#${token}`)

    expect(await view.findByText("Only for moderators")).toBeTruthy()
  })
})

describe("a moderator link's live page", () => {
  it("has the draw controls but no winner count, no overlay link and no moderator links", async () => {
    mockModerator({})

    const view = renderApp("/mod/gid-1")

    expect(await view.findByRole("button", { name: "Closed" })).toBeTruthy()
    expect(view.queryByLabelText("Planned winners")).toBeNull()
    expect(view.queryByRole("button", { name: "Overlay link" })).toBeNull()
    expect(view.queryByRole("button", { name: "Moderator links" })).toBeNull()
  })

  it("never shows or asks for the winners' form answers", async () => {
    const drawn: LiveSnapshot = {
      ...liveSnapshot,
      status: "drawn",
      winners: [
        {
          n: 0,
          entrySeq: null,
          displayName: "Wanda",
          profileImageUrl: null,
          claimUntil: 1,
          claim: { state: "claimed", at: 1, via: "rafflink" },
        },
      ],
    }
    const requests = mockModerator({
      "GET /api/g/ABCDE": () =>
        ok({ ...giveaway, rules: { ...giveaway.rules, winnerForm: ["address"] } }),
      "GET /api/mod/gid-1": () => ok(drawn),
    })

    const view = renderApp("/mod/gid-1")

    expect(await view.findByText("Wanda")).toBeTruthy()
    // The form comes with the giveaway's public facts; once they are in, the panel would have asked.
    await act(async () => {})
    expect(requests.some((request) => request.route === "GET /api/g/ABCDE")).toBe(true)
    expect(view.queryByRole("heading", { name: "Winner answers" })).toBeNull()
    expect(requests.some((request) => request.route.endsWith("/answers"))).toBe(false)
  })

  it("sends its buttons to the link's own routes", async () => {
    const requests = mockModerator({
      "POST /api/mod/gid-1/close": () => ok({ kind: "closed" }),
    })

    const view = renderApp("/mod/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Closed" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, close entries" }))

    expect(await view.findByText("Entries closed.")).toBeTruthy()
    expect(requests.some((request) => request.route === "POST /api/mod/gid-1/close")).toBe(true)
  })

  it("says the link stopped working when the server answers 403 or ends the socket for a revoke", async () => {
    mockModerator({ "GET /api/mod/gid-2": () => refused(403, "forbidden") })
    const refusedView = renderApp("/mod/gid-2")
    expect(await refusedView.findByText("This moderator link does not work")).toBeTruthy()
    cleanup()

    const view = renderApp("/mod/gid-1")
    await view.findByRole("button", { name: "Closed" })
    act(() => FakeSocket.opened.at(-1)?.revoke())

    expect(await view.findByText("This moderator link does not work")).toBeTruthy()
  })
})

function mockStreamer(routes: Readonly<Record<string, () => Reply>>) {
  return mockFetch({
    "GET /api/g/ABCDE": () => ok(giveaway),
    "GET /api/live/gid-1": () => ok({ ...liveSnapshot, overlayToken: "tok-1" }),
    "GET /api/live/gid-1/entrants?after=0": () => ok({ rows: [], more: false }),
    ...routes,
  })
}

describe("moderator links on the streamer's live page", () => {
  it("makes a moderators-only link, shows its URL once and lists it", async () => {
    const copied = stubClipboard(false)
    let links: unknown[] = []
    const link = { id: "c0ffee1234567890c0ffee1234567890", requireMod: true, createdAt: 1 }
    const requests = mockStreamer({
      "GET /api/dash/giveaways/gid-1/moderator-links": () => ok({ links }),
      "POST /api/dash/giveaways/gid-1/moderator-links": () => {
        links = [link]
        return { status: 201, body: { link, token } }
      },
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Moderator links" }))
    expect(await view.findByText("No moderator link works now.")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Create link" }))

    const field = await view.findByRole("textbox", {
      name: "New link. Copy it now, it is shown only once.",
    })
    expect(field instanceof HTMLInputElement && field.value).toBe(
      `http://rafflink.test/mod#${token}`,
    )
    expect(await view.findByRole("button", { name: "Revoke link c0ffee" })).toBeTruthy()
    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways/gid-1/moderator-links")
        ?.body,
    ).toEqual({ requireMod: true })
    fireEvent.click(view.getByRole("button", { name: "Copy moderator link" }))
    await view.findByText("Copied!")
    expect(copied).toEqual([`http://rafflink.test/mod#${token}`])
  })

  it("makes a link for anyone who has it when the streamer picks that", async () => {
    const requests = mockStreamer({
      "GET /api/dash/giveaways/gid-1/moderator-links": () => ok({ links: [] }),
      "POST /api/dash/giveaways/gid-1/moderator-links": () => ({
        status: 201,
        body: { link: { id: "d".repeat(32), requireMod: false, createdAt: 1 }, token },
      }),
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Moderator links" }))
    fireEvent.click(view.getByRole("radio", { name: "Anyone with the link" }))
    fireEvent.click(view.getByRole("button", { name: "Create link" }))

    await view.findByRole("textbox", { name: "New link. Copy it now, it is shown only once." })
    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways/gid-1/moderator-links")
        ?.body,
    ).toEqual({ requireMod: false })
  })

  it("revokes a link and lists the rest", async () => {
    const linkId = "e".repeat(32)
    let links: unknown[] = [{ id: linkId, requireMod: false, createdAt: 1 }]
    const requests = mockStreamer({
      "GET /api/dash/giveaways/gid-1/moderator-links": () => ok({ links }),
      [`POST /api/dash/giveaways/gid-1/moderator-links/${linkId}/revoke`]: () => {
        links = []
        return ok({ kind: "revoked" })
      },
    })

    const view = renderApp("/live/gid-1")
    fireEvent.click(await view.findByRole("button", { name: "Moderator links" }))
    fireEvent.click(await view.findByRole("button", { name: "Revoke link eeeeee" }))

    expect(await view.findByText("Link revoked. It stopped working.")).toBeTruthy()
    expect(await view.findByText("No moderator link works now.")).toBeTruthy()
    expect(requests.some((request) => request.route.endsWith("/revoke"))).toBe(true)
  })
})

describe("who did what", () => {
  const drawnByModerator: LiveSnapshot = {
    ...liveSnapshot,
    actors: {
      closedBy: "streamer",
      picks: [
        { n: 0, drawnBy: `mod:${"f".repeat(32)}`, rerolledBy: null, claimMarkedBy: "streamer" },
      ],
    },
  }

  it("lists each action with its actor once a moderator link acted", async () => {
    mockModerator({ "GET /api/mod/gid-1": () => ok(drawnByModerator) })

    const view = renderApp("/mod/gid-1")

    const log = within(await view.findByRole("region", { name: "Who did what" }))
    expect(log.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Entries closed by the streamer",
      "Winner 1 drawn by moderator link ffffff",
      "Winner 1 marked as claimed by the streamer",
    ])
  })

  it("shows nothing while only the streamer acted", async () => {
    const streamerOnly: LiveSnapshot = {
      ...liveSnapshot,
      actors: { closedBy: "streamer", picks: [] },
    }
    mockModerator({ "GET /api/mod/gid-1": () => ok(streamerOnly) })

    const view = renderApp("/mod/gid-1")

    await view.findByRole("button", { name: "Closed" })
    expect(view.queryByRole("region", { name: "Who did what" })).toBeNull()
  })
})
