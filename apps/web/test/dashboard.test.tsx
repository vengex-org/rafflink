import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, waitFor } from "@testing-library/react"
import { stubClipboard } from "./clipboard.ts"
import {
  dashboardGiveaway,
  donateUrl,
  rules,
  supportedSession,
  twitchPlatform,
} from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { inputOf } from "./queries.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const listed = { "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }) }
const empty = { "GET /api/dash/giveaways": () => ok({ giveaways: [] }) }

describe("dashboard", () => {
  it("offers Sign in with Twitch to a signed-out streamer", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard")

    expect(
      (await view.findByRole("link", { name: "Sign in with Twitch" })).getAttribute("href"),
    ).toBe("/auth/twitch/streamer/start")
  })

  it("brings a streamer who signs in from the verify page back to it", async () => {
    mockFetch({
      "GET /api/g/ABCDE/verify": () => ({ status: 404, body: null }),
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })
    const view = renderApp("/ABCDE/verify?from=chat")

    fireEvent.click(await view.findByRole("link", { name: "Streamer sign in" }))

    expect(
      (await view.findByRole("link", { name: "Sign in with Twitch" })).getAttribute("href"),
    ).toBe("/auth/twitch/streamer/start?return=%2FABCDE%2Fverify%3Ffrom%3Dchat")
  })

  it("ignores a return to another site", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard?return=%2F%2Fevil.example")

    const href = (await view.findByRole("link", { name: "Sign in with Twitch" })).getAttribute(
      "href",
    )
    expect(new URL(href ?? "", "https://rafflink.test").searchParams.get("return")).toBe(
      "/dashboard?return=%2F%2Fevil.example",
    )
  })

  it("offers Sign in with Kick next to Twitch when the install signs in with Kick", async () => {
    mockFetch({
      "GET /api/session": () =>
        ok({
          streamer: null,
          signInPlatforms: ["twitch", "kick"],
          donateUrl: null,
          operator: null,
        }),
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard")

    expect(
      (await view.findByRole("link", { name: "Sign in with Kick" })).getAttribute("href"),
    ).toBe("/auth/kick/streamer/start")
    expect(view.getByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  it("teaches an empty dashboard in three steps with one button to start", async () => {
    mockFetch(empty)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Create your first giveaway" })).toBeTruthy()
    const steps = view.getAllByRole("listitem").map((item) => item.textContent)
    expect(steps).toEqual([
      "Create it. Say what you give away and who can enter.",
      "Share the link. Paste it in your chat. Viewers sign in on the giveaway page to enter.",
      "Draw live. Close entries and pick the winner on your stream.",
    ])
    fireEvent.click(view.getByRole("link", { name: "Create giveaway" }))
    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
  })

  it("lists each giveaway as a card with its prize, status and a link to its live page", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(view.getByText("Prize: A gaming chair")).toBeTruthy()
    expect(view.getByText("Entries open")).toBeTruthy()
    const meta = view.container.querySelector(".giveaway-meta")
    expect(meta?.textContent).toStartWith("Code ABCDE, created ")
    expect(meta?.querySelector(".code-tag")?.textContent).toBe("ABCDE")
    expect(view.getByRole("link", { name: "Open live page" }).getAttribute("href")).toBe(
      "/live/gid-1",
    )
  })

  it("names a giveaway without a title by its code and leaves out a missing prize", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({ giveaways: [{ ...dashboardGiveaway, title: null, prize: null }] }),
    })

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Giveaway ABCDE" })).toBeTruthy()
    expect(view.queryByText(/Prize:/)).toBeNull()
  })

  it("keeps the link and overlay link of a listed giveaway at hand", async () => {
    const copied = stubClipboard(false)
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")

    expect(view.getByRole("textbox", { name: "Your link" }).getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
    expect(view.getByRole("textbox", { name: "Overlay link" }).getAttribute("value")).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/ABCDE"])
  })

  it("copies the whole overlay link from an icon button beside its clipped address", async () => {
    const copied = stubClipboard(false)
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")
    fireEvent.click(view.getByRole("button", { name: "Copy overlay link" }))

    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/overlay/gid-1/tok-1"])
    const shown = view.getByText("http://rafflink.test/overlay/gid-1/tok-1", {
      selector: ".share-link-url",
    })
    expect(shown.getAttribute("data-clipped")).toBe("true")
  })

  it("shows the link without its protocol and the code marked, and the icon button copies the whole link", async () => {
    const copied = stubClipboard(false)
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")

    const shown = view.container.querySelector(".share-link-url")
    expect(shown?.textContent).toBe("rafflink.test/ABCDE")
    expect(shown?.querySelector("em")?.textContent).toBe("ABCDE")
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/ABCDE"])
  })

  it("says how to copy by hand when the clipboard is refused", async () => {
    stubClipboard(true)
    spyOn(console, "error").mockImplementation(() => {})
    mockFetch(listed)

    const view = renderApp("/dashboard")
    await view.findByText("Link and OBS overlay")
    fireEvent.click(view.getByRole("button", { name: "Copy link" }))

    expect(await view.findByText(/Could not copy/)).toBeTruthy()
    expect(
      view.container.querySelector(".share-link .copy-button")?.getAttribute("data-state"),
    ).toBe("failed")
  })

  it("shows each status as a chip with its words", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            { ...dashboardGiveaway, id: "a", code: "AAAAA", status: "open" },
            { ...dashboardGiveaway, id: "b", code: "BBBBB", status: "closed" },
            { ...dashboardGiveaway, id: "c", code: "CCCCC", status: "drawn" },
          ],
        }),
    })

    const view = renderApp("/dashboard")
    await view.findByText("Entries open")

    expect(
      view.getByText("Entries closed").closest(".status-chip")?.getAttribute("data-tone"),
    ).toBe("warning")
    expect(view.getByText("Winners drawn").closest(".status-chip")).toBeTruthy()
    expect(view.getByText("Entries open").closest(".status-chip")?.getAttribute("data-tone")).toBe(
      "success",
    )
  })

  describe("support line", () => {
    const withDrawn = {
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            { ...dashboardGiveaway, id: "a", code: "AAAAA", status: "open" },
            { ...dashboardGiveaway, id: "c", code: "CCCCC", status: "drawn" },
          ],
        }),
    }
    const supportText = "If Rafflink saved you time, you can support it."

    it("links the configured support page in a new tab above the drawn giveaways", async () => {
      mockFetch({ ...withDrawn, "GET /api/session": () => ok(supportedSession) })

      const view = renderApp("/dashboard")

      const link = await view.findByRole("link", { name: "Support" })
      expect(link.getAttribute("href")).toBe(donateUrl)
      expect(link.getAttribute("target")).toBe("_blank")
      expect(link.getAttribute("rel")).toBe("noopener nofollow")
      expect(link.closest(".support-note")?.textContent).toContain(supportText)
      expect(link.closest(".support-note")?.nextElementSibling).toBe(
        view.getByRole("region", { name: "Finished" }),
      )
    })

    it("stays away while nothing is drawn yet", async () => {
      mockFetch({ ...listed, "GET /api/session": () => ok(supportedSession) })

      const view = renderApp("/dashboard")

      await view.findByRole("heading", { name: "Summer giveaway" })
      await view.findByRole("button", { name: "Streamy" })
      expect(view.queryByText(supportText, { exact: false })).toBeNull()
    })

    it("stays away when the deployment names no support page", async () => {
      mockFetch({
        ...withDrawn,
        "GET /api/session": () => ok({ ...supportedSession, donateUrl: null }),
      })

      const view = renderApp("/dashboard")

      await view.findByRole("button", { name: "Streamy" })
      await view.findByText("Winners drawn")
      expect(view.queryByRole("link", { name: "Support" })).toBeNull()
    })
  })

  it("pins the open giveaway above the others, each group under its own heading", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            { ...dashboardGiveaway, id: "c", code: "CCCCC", title: "Old one", status: "drawn" },
            { ...dashboardGiveaway, id: "a", code: "AAAAA", title: "Current one", status: "open" },
          ],
        }),
    })

    const view = renderApp("/dashboard")

    const names = (await view.findAllByRole("heading", { level: 3 })).map((h) => h.textContent)
    expect(names).toEqual(["Current one", "Old one"])
    const sections = view.getAllByRole("region").map((region) => ({
      heading: region.querySelector("h2")?.textContent,
      giveaways: Array.from(region.querySelectorAll("h3"), (h) => h.textContent),
    }))
    expect(sections).toEqual([
      { heading: "Running", giveaways: ["Current one"] },
      { heading: "Finished", giveaways: ["Old one"] },
    ])
  })

  it("leaves out the heading of a group with no giveaways", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("region", { name: "Running" })).toBeTruthy()
    expect(view.queryByRole("region", { name: "Finished" })).toBeNull()
  })

  it("opens the create form prefilled from a giveaway with entries ending left open", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            {
              ...dashboardGiveaway,
              closesAt: 4_102_444_800_000,
              rules: { ...rules, claimKeyword: "mine", minAccountAgeDays: 7 },
            },
          ],
        }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("link", { name: "Duplicate Summer giveaway" }))

    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    expect(inputOf(view.getByLabelText("Giveaway name optional")).value).toBe("Summer giveaway")
    expect(inputOf(view.getByLabelText("What does the winner get? optional")).value).toBe(
      "A gaming chair",
    )
    expect(inputOf(view.getByLabelText(/^When I close them/)).checked).toBe(true)
    expect(view.queryByLabelText("Entries end at")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Next" }))
    expect(inputOf(view.getByLabelText("Subscribers, tier 3")).value).toBe("5")
    expect(inputOf(view.getByLabelText("Moderators")).value).toBe("7")
    expect(inputOf(view.getByLabelText("Minimum account age in days optional")).value).toBe("7")
    expect(inputOf(view.getByLabelText("Claim word optional")).value).toBe("mine")
  })

  it("leaves Bonus tickets off for a copy whose only zeros are groups the platform cannot tell", async () => {
    const capabilities = {
      ...supportedSession.streamer.capabilities,
      followerCheck: false,
      subTiers: false,
      vip: false,
      moderatorRole: false,
      chatBadgeGroups: ["sub_t1", "moderator"],
    }
    const tickets = {
      viewer: 1,
      follower: 0,
      sub_t1: 0,
      sub_t2: 0,
      sub_t3: 0,
      member: 0,
      vip: 0,
      moderator: 0,
    }
    mockFetch({
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, platform: "kick", capabilities },
        }),
      "GET /api/dash/giveaways": () =>
        ok({ giveaways: [{ ...dashboardGiveaway, rules: { ...rules, tickets } }] }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("link", { name: "Duplicate Summer giveaway" }))
    await view.findByText("Step 1 of 3: Basics")
    fireEvent.click(view.getByRole("button", { name: "Next" }))

    expect(inputOf(view.getByRole("checkbox", { name: "Bonus tickets" })).checked).toBe(false)
  })

  it("copies the recent-winners rule of a giveaway into the create form", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            {
              ...dashboardGiveaway,
              rules: { ...rules, excludeRecentWinners: { kind: "days", count: 30 } },
            },
          ],
        }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("link", { name: "Duplicate Summer giveaway" }))
    await view.findByText("Step 1 of 3: Basics")
    fireEvent.click(view.getByRole("button", { name: "Next" }))

    expect(inputOf(view.getByRole("radio", { name: /Last days/ })).checked).toBe(true)
    expect(inputOf(view.getByLabelText("How many days back")).value).toBe("30")
  })

  it("links Duplicate to the wizard with the id of the giveaway, which refills it after a reload", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")
    const duplicate = await view.findByRole("link", { name: "Duplicate Summer giveaway" })

    expect(duplicate.getAttribute("href")).toBe("/dashboard/new?from=gid-1")
    fireEvent.click(duplicate)
    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    expect(view.address()).toBe("/dashboard/new?from=gid-1")
    view.unmount()

    const reloaded = renderApp("/dashboard/new?from=gid-1")
    await reloaded.findByText("Step 1 of 3: Basics")
    expect(inputOf(reloaded.getByLabelText("Giveaway name optional")).value).toBe("Summer giveaway")
  })

  it("starts the wizard blank when the giveaway to copy is not in the list", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard/new?from=other")
    await view.findByText("Step 1 of 3: Basics")

    expect(inputOf(view.getByLabelText("Giveaway name optional")).value).toBe("")
  })

  it("offers sign-in on the wizard and brings the streamer back to it", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard/new?from=gid-1")

    expect(
      (await view.findByRole("link", { name: "Sign in with Twitch" })).getAttribute("href"),
    ).toBe("/auth/twitch/streamer/start?return=%2Fdashboard%2Fnew%3Ffrom%3Dgid-1")
  })

  it("preselects Custom with the minutes for a claim time outside the presets", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({ giveaways: [{ ...dashboardGiveaway, claimSeconds: 900 }] }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("link", { name: "Duplicate Summer giveaway" }))
    fireEvent.click(await view.findByRole("button", { name: "Next" }))

    expect(inputOf(view.getByLabelText("Custom")).checked).toBe(true)
    expect(inputOf(view.getByLabelText("5 minutes")).checked).toBe(false)
    expect(inputOf(view.getByLabelText("Minutes")).value).toBe("15")
  })

  it("tells a streamer who waits for approval and offers no way to create", async () => {
    mockFetch({
      ...empty,
      "GET /api/session": () =>
        ok({
          streamer: {
            displayName: "Streamy",
            login: "streamy",
            profileImageUrl: null,
            canCreate: false,
            ...twitchPlatform,
          },
          signInPlatforms: ["twitch"],
          donateUrl: null,
          operator: null,
        }),
    })

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy()
    expect(view.getByText(/has not approved your account/)).toBeTruthy()
    expect(view.queryByRole("link", { name: "Create giveaway" })).toBeNull()
  })

  it("keeps the list of a streamer whose approval was revoked and hides New and Duplicate", async () => {
    mockFetch({
      ...listed,
      "GET /api/session": () =>
        ok({
          streamer: {
            displayName: "Streamy",
            login: "streamy",
            profileImageUrl: null,
            canCreate: false,
            ...twitchPlatform,
          },
          signInPlatforms: ["twitch"],
          donateUrl: null,
          operator: null,
        }),
    })

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy()
    expect(view.getByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "New giveaway" })).toBeNull()
    expect(view.queryByRole("link", { name: "Duplicate Summer giveaway" })).toBeNull()
  })

  it("shows no notice to a streamer who may create", async () => {
    mockFetch({ ...empty, "GET /api/session": () => ok(supportedSession) })

    const view = renderApp("/dashboard")

    expect(await view.findByRole("link", { name: "Create giveaway" })).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Waiting for approval" })).toBeNull()
  })

  it("lets a session that allows creating outrank an old refusal and clears the refusal from the history entry", async () => {
    mockFetch({ ...listed, "GET /api/session": () => ok(supportedSession) })

    const view = renderApp("/dashboard", { kind: "not-approved" })

    expect(await view.findByRole("link", { name: "New giveaway" })).toBeTruthy()
    expect(view.queryByRole("heading", { name: "Waiting for approval" })).toBeNull()
    await waitFor(() => expect(view.state()).toBeNull())
  })

  it("keeps the refusal while the session is unknown, and after a reload of the page", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard", { kind: "not-approved" })

    expect(await view.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "New giveaway" })).toBeNull()
    expect(view.state()).toEqual({ kind: "not-approved" })
  })

  it("shows the waiting notice when the server refuses a create the session allowed", async () => {
    mockFetch({
      ...listed,
      "POST /api/dash/giveaways": () => ({
        status: 403,
        body: { error: "streamer_not_approved" },
      }),
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("link", { name: "Duplicate Summer giveaway" }))
    fireEvent.click(await view.findByRole("button", { name: "Next" }))
    fireEvent.click(await view.findByRole("button", { name: "Next" }))
    fireEvent.click(await view.findByRole("button", { name: "Start giveaway" }))

    expect(await view.findByRole("heading", { name: "Waiting for approval" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "New giveaway" })).toBeNull()
  })
})

describe("dashboard history", () => {
  const finished = [
    { ...dashboardGiveaway, id: "a", code: "AAAAA", title: "Spring keyboard", status: "drawn" },
    { ...dashboardGiveaway, id: "b", code: "BBBBB", title: "Winter mouse", status: "drawn" },
  ]

  it("offers the winners of a finished giveaway as a CSV download, and none for a running one", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway, ...finished] }),
    })

    const view = renderApp("/dashboard")

    const links = await view.findAllByRole("link", { name: /Winners as CSV/ })
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/api/dash/giveaways/a/winners.csv",
      "/api/dash/giveaways/b/winners.csv",
    ])
    expect(links.every((link) => link.hasAttribute("download"))).toBe(true)
  })

  it("shows how many claimed prizes were delivered, and nothing before a claim or the mirror", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () =>
        ok({
          giveaways: [
            { ...finished[0], delivery: { claimed: 3, delivered: 2 } },
            { ...finished[1], delivery: { claimed: 0, delivered: 0 } },
            { ...dashboardGiveaway, id: "c", code: "CCCCC", status: "drawn", delivery: null },
          ],
        }),
    })

    const view = renderApp("/dashboard")

    expect(await view.findByText("2 of 3 delivered")).toBeTruthy()
    expect(view.queryAllByText(/ delivered$/)).toHaveLength(1)
  })

  it("narrows the finished giveaways to a search by name, prize or code", async () => {
    mockFetch({ "GET /api/dash/giveaways": () => ok({ giveaways: finished }) })

    const view = renderApp("/dashboard")
    const search = await view.findByRole("searchbox", { name: "Search finished giveaways" })
    fireEvent.change(search, { target: { value: "winter" } })

    await waitFor(() =>
      expect(view.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
        "Winter mouse",
      ]),
    )
    fireEvent.change(search, { target: { value: "AAAAA" } })
    await waitFor(() =>
      expect(view.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
        "Spring keyboard",
      ]),
    )
    fireEvent.change(search, { target: { value: "nothing like it" } })
    expect(await view.findByText("No finished giveaway matches your search.")).toBeTruthy()
  })

  it("deletes a giveaway once the streamer confirms and lists the rest again", async () => {
    let giveaways = finished
    const requests = mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways }),
      "POST /api/dash/giveaways/a/delete": () => {
        giveaways = finished.slice(1)
        return ok({ kind: "deleted" })
      },
    })

    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("button", { name: "Delete Spring keyboard" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, delete it" }))

    await waitFor(() =>
      expect(view.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
        "Winter mouse",
      ]),
    )
    expect(requests.map((request) => request.route)).toContain("POST /api/dash/giveaways/a/delete")
  })
})

describe("dashboard public history", () => {
  const drawn = { ...dashboardGiveaway, status: "drawn" }

  it("hides a finished giveaway from the public history and offers to show it again", async () => {
    let hidden = false
    const requests = mockFetch({
      "GET /api/dash/giveaways": () => ok({ giveaways: [{ ...drawn, hiddenFromHistory: hidden }] }),
      "POST /api/dash/giveaways/gid-1/history": () => {
        hidden = true
        return ok({ kind: "saved", hidden: true })
      },
    })

    const view = renderApp("/dashboard")
    fireEvent.click(
      await view.findByRole("button", {
        name: "Hide Summer giveaway from your public history",
      }),
    )

    expect(
      await view.findByRole("button", { name: "Show Summer giveaway in your public history" }),
    ).toBeTruthy()
    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways/gid-1/history")?.body,
    ).toEqual({ hidden: true })
  })

  it("offers no history button on a giveaway that is not drawn yet", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")

    expect(await view.findByRole("heading", { name: "Summer giveaway" })).toBeTruthy()
    expect(view.queryByRole("button", { name: /from your public history/ })).toBeNull()
  })
})
