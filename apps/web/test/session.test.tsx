import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { setTimeout } from "node:timers/promises"
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { installFakeSocket } from "./fake-socket.ts"
import { donateUrl, giveaway, supportedSession } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const signedIn = {
  "GET /api/session": () =>
    ok({
      streamer: { displayName: "Streamy", login: "streamy", profileImageUrl: null },
      donateUrl: null,
    }),
}

describe("header session", () => {
  it("shows the streamer's name as an account button on the home page, with no inline Log out or demo link", async () => {
    mockFetch(signedIn)

    const view = renderApp("/")

    const name = await view.findByRole("button", { name: "Streamy" })
    expect(view.queryByRole("link", { name: "Streamy" })).toBeNull()
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
    expect(view.queryByRole("link", { name: "Log in" })).toBeNull()
    expect(view.queryByRole("link", { name: "Demo giveaway" })).toBeNull()

    fireEvent.click(name)

    // The hero button and the menu entry both lead to the dashboard.
    const links = view.getAllByRole("link", { name: "My giveaways" })
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/dashboard", "/dashboard"])
    expect(view.getByRole("button", { name: "Log out" })).toBeTruthy()
  })

  it("shows the streamer's profile picture in front of the name, the initials without one", async () => {
    const picture = "https://static-cdn.jtvnw.net/jtv_user_pictures/streamy.png"
    mockFetch({
      "GET /api/session": () =>
        ok({
          streamer: { displayName: "Streamy", login: "streamy", profileImageUrl: picture },
          donateUrl: null,
        }),
    })
    const withPicture = renderApp("/")
    await withPicture.findByRole("button", { name: "Streamy" })
    expect(withPicture.container.querySelector(".account-avatar img")?.getAttribute("src")).toBe(
      picture,
    )
    cleanup()
    mock.restore()

    mockFetch(signedIn)
    const without = renderApp("/")
    await without.findByRole("button", { name: "Streamy" })
    expect(without.container.querySelector(".account-avatar img")).toBeNull()
    expect(without.container.querySelector(".account-avatar")?.textContent).toBe("ST")
  })

  it("lists the configured support page in the account menu, opening in a new tab", async () => {
    mockFetch({ "GET /api/session": () => ok(supportedSession) })

    const view = renderApp("/")

    fireEvent.click(await view.findByRole("button", { name: "Streamy" }))
    const link = view.getByRole("link", { name: "Support Rafflink" })
    expect(link.getAttribute("href")).toBe(donateUrl)
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener")
  })

  it("leaves the support entry out of the account menu when no page is configured", async () => {
    mockFetch(signedIn)

    const view = renderApp("/")

    fireEvent.click(await view.findByRole("button", { name: "Streamy" }))
    expect(view.getByRole("button", { name: "Log out" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "Support Rafflink" })).toBeNull()
  })

  it("shows Log in when nobody is signed in", async () => {
    mockFetch({})

    const view = renderApp("/")

    await waitFor(() => expect(view.getByRole("link", { name: "Log in" })).toBeTruthy())
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
  })

  it("shows Log in and logs the failure when the session call fails", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    mockFetch({ "GET /api/session": () => ({ status: 500, body: { error: "unavailable" } }) })

    const view = renderApp("/")

    await waitFor(() =>
      expect(logged).toHaveBeenCalledWith("load failed", { errorClass: "ApiError", round: 0 }),
    )
    expect(view.getByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
  })

  it("posts the logout, goes home and shows Log in again", async () => {
    let signedInNow = true
    const requests = mockFetch({
      "GET /api/session": () =>
        ok(signedInNow ? { ...supportedSession, donateUrl: null } : { streamer: null }),
      "POST /auth/logout": () => {
        signedInNow = false
        return { status: 204, body: null }
      },
      "GET /api/dash/giveaways": () => ok({ giveaways: [] }),
    })
    const view = renderApp("/dashboard")
    fireEvent.click(await view.findByRole("button", { name: "Streamy" }))
    fireEvent.click(view.getByRole("button", { name: "Log out" }))

    expect(await view.findByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
    expect(
      await view.findByRole("heading", { level: 1, name: /Fair Twitch giveaways/ }),
    ).toBeTruthy()
    expect(requests.map((request) => request.route)).toContain("POST /auth/logout")
  })

  it("shows Log in after the logout even when a later session call would fail", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    let sessionCalls = 0
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return sessionCalls === 1
          ? ok({
              streamer: { displayName: "Streamy", login: "streamy", profileImageUrl: null },
              donateUrl: null,
            })
          : { status: 500, body: { error: "unavailable" } }
      },
      "POST /auth/logout": () => ({ status: 204, body: null }),
    })
    const view = renderApp("/")
    fireEvent.click(await view.findByRole("button", { name: "Streamy" }))
    fireEvent.click(view.getByRole("button", { name: "Log out" }))

    expect(await view.findByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Streamy" })).toBeNull()
    expect(sessionCalls).toBe(1)
    expect(logged).not.toHaveBeenCalled()
  })

  it.each(["/ABCDE", "/g/ABCDE/verify", "/demo"])(
    "makes no session call on %s, which viewers visit",
    async (path) => {
      const restoreSocket = installFakeSocket()
      const requests = mockFetch({
        "GET /api/g/ABCDE": () => ok(giveaway),
        "GET /api/g/ABCDE/verify": () => ({ status: 404, body: null }),
      })

      const view = renderApp(path)
      await setTimeout(50)

      expect(view.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/dashboard")
      expect(requests.map((request) => request.route)).not.toContain("GET /api/session")
      restoreSocket()
    },
  )

  it.each(["/verify", "/privacy", "/terms"])(
    "asks for the session once on %s and shows the account menu signed in",
    async (path) => {
      const requests = mockFetch(signedIn)

      const view = renderApp(path)

      await view.findByRole("button", { name: "Streamy" })
      expect(view.queryByRole("link", { name: "Log in" })).toBeNull()
      expect(requests.filter((request) => request.route === "GET /api/session")).toHaveLength(1)
    },
  )

  it("keeps the name and logs when the logout fails", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {})
    mockFetch({
      ...signedIn,
      "POST /auth/logout": () => ({ status: 403, body: { error: "forbidden" } }),
    })
    const view = renderApp("/")
    fireEvent.click(await view.findByRole("button", { name: "Streamy" }))
    fireEvent.click(view.getByRole("button", { name: "Log out" }))

    await waitFor(() =>
      expect(logged).toHaveBeenCalledWith("action failed", { errorClass: "ApiError" }),
    )
    expect(view.getByRole("button", { name: "Streamy" })).toBeTruthy()
    expect(view.queryByRole("link", { name: "Log in" })).toBeNull()
    expect(await view.findByText("Something went wrong. Try again.")).toBeTruthy()
  })

  it("shows Log in when a dashboard call answers 401 after the session expired", async () => {
    let sessionCalls = 0
    const headerShowsStreamer = Promise.withResolvers<void>()
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return ok(
          sessionCalls === 1 ? { ...supportedSession, donateUrl: null } : { streamer: null },
        )
      },
      "GET /api/dash/giveaways": async () => {
        await headerShowsStreamer.promise
        return { status: 401, body: { error: "unauthorized" } }
      },
    })

    const view = renderApp("/dashboard")

    await view.findByRole("button", { name: "Streamy" })
    // The header listens for the lost session in an effect; a 401 before it ran would go unheard.
    await act(async () => {})
    headerShowsStreamer.resolve()
    expect(await view.findByRole("link", { name: "Log in" })).toBeTruthy()
    expect(view.queryByRole("button", { name: "Streamy" })).toBeNull()
    expect(sessionCalls).toBe(2)
  })

  it("asks for the session once when a signed-out visitor's dashboard call answers 401", async () => {
    let sessionCalls = 0
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return ok({ streamer: null })
      },
      "GET /api/dash/giveaways": async () => {
        await setTimeout(0)
        return { status: 401, body: { error: "unauthorized" } }
      },
    })

    const view = renderApp("/dashboard")

    await view.findByRole("link", { name: "Sign in with Twitch" })
    await setTimeout(0)
    expect(sessionCalls).toBe(1)
  })

  it("does not ask for the session again when the session call itself answers 401", async () => {
    let sessionCalls = 0
    mockFetch({
      "GET /api/session": () => {
        sessionCalls += 1
        return { status: 401, body: { error: "unauthorized" } }
      },
    })
    const logged = spyOn(console, "error").mockImplementation(() => {})

    const view = renderApp("/")

    await waitFor(() => expect(logged).toHaveBeenCalled())
    await setTimeout(0)
    expect(view.getByRole("link", { name: "Log in" })).toBeTruthy()
    expect(sessionCalls).toBe(1)
  })

  it("keeps the marketing links in the home page's bar only, and no demo link in any bar", async () => {
    mockFetch({})
    const home = renderApp("/")
    await home.findByRole("link", { name: "Log in" })
    expect(home.getByRole("link", { name: "How it works" })).toBeTruthy()
    expect(home.queryByRole("link", { name: "Demo giveaway" })).toBeNull()
    cleanup()

    const legal = renderApp("/privacy")
    await legal.findByRole("link", { name: "Log in" })
    for (const name of ["How it works", "Self-host", "GitHub", "Demo giveaway"]) {
      expect(legal.queryByRole("link", { name })).toBeNull()
    }
    expect(legal.getByRole("link", { name: /Rafflink/ }).getAttribute("href")).toBe("/")
  })
})

async function openMenu() {
  const requests = mockFetch({
    ...signedIn,
    "GET /api/dash/giveaways": () => ok({ giveaways: [] }),
    "POST /auth/logout": () => ({ status: 204, body: null }),
  })
  const view = renderApp("/dashboard")
  const button = await view.findByRole("button", { name: "Streamy" })
  return { view, button, requests }
}

describe("header account menu", () => {
  it("shows a closed account button without the marketing links on a streamer page", async () => {
    const { view, button } = await openMenu()

    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(view.queryByRole("link", { name: "My giveaways" })).toBeNull()
    expect(view.queryByRole("link", { name: "How it works" })).toBeNull()
    expect(view.queryByRole("link", { name: "Demo giveaway" })).toBeNull()
    expect(view.queryByRole("button", { name: "Log out" })).toBeNull()
  })

  it("opens on click with My giveaways and Log out", async () => {
    const { view, button } = await openMenu()

    fireEvent.click(button)

    expect(button.getAttribute("aria-expanded")).toBe("true")
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "")
    expect(panel).not.toBeNull()
    expect(within(panel ?? view.container).getAllByRole("listitem")).toHaveLength(2)
    expect(view.getByRole("link", { name: "My giveaways" }).getAttribute("href")).toBe("/dashboard")
    expect(view.getByRole("button", { name: "Log out" })).toBeTruthy()
  })

  it("closes on Escape and returns focus to the button", async () => {
    const { view, button } = await openMenu()
    fireEvent.click(button)

    fireEvent.keyDown(document.body, { key: "Escape" })

    expect(view.queryByRole("link", { name: "My giveaways" })).toBeNull()
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(button)
  })

  it("closes on a click outside and when the button is clicked again", async () => {
    const { view, button } = await openMenu()
    fireEvent.click(button)

    fireEvent.pointerDown(document.body)
    expect(view.queryByRole("link", { name: "My giveaways" })).toBeNull()

    fireEvent.click(button)
    fireEvent.click(button)
    expect(view.queryByRole("link", { name: "My giveaways" })).toBeNull()
  })

  it("stays open on a click inside the panel itself", async () => {
    const { view, button } = await openMenu()
    fireEvent.click(button)

    fireEvent.pointerDown(view.getByRole("link", { name: "My giveaways" }))

    expect(view.getByRole("link", { name: "My giveaways" })).toBeTruthy()
  })

  it("keeps focus on the account button after Log out is chosen", async () => {
    const { view, button } = await openMenu()
    fireEvent.click(button)

    view.getByRole("button", { name: "Log out" }).focus()
    fireEvent.click(view.getByRole("button", { name: "Log out" }))

    expect(document.activeElement).toBe(button)
  })

  it("posts the logout from the menu item", async () => {
    const { view, button, requests } = await openMenu()
    fireEvent.click(button)

    fireEvent.click(view.getByRole("button", { name: "Log out" }))

    await waitFor(() =>
      expect(requests.map((request) => request.route)).toContain("POST /auth/logout"),
    )
  })
})
