import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { dashboardGiveaway } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const listed = { "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }) }

function createReply(reply: Reply) {
  return { ...listed, "POST /api/dash/giveaways": () => reply }
}

describe("dashboard", () => {
  it("offers Sign in with Twitch to a signed-out streamer", async () => {
    mockFetch({
      "GET /api/dash/giveaways": () => ({ status: 401, body: { error: "unauthorized" } }),
    })

    const view = renderApp("/dashboard")

    expect((await view.findByText("Sign in with Twitch")).getAttribute("href")).toBe(
      "/auth/twitch/streamer/start",
    )
  })

  it("lists the giveaways of the signed-in streamer", async () => {
    mockFetch(listed)

    const view = renderApp("/dashboard")

    expect(await view.findByText("Summer giveaway")).toBeTruthy()
    expect(view.getByText("ABCDE · Entries open")).toBeTruthy()
  })

  it("shows the API field error next to the field", async () => {
    mockFetch(
      createReply({
        status: 400,
        body: { error: "invalid-input", field: "tickets.vip", code: "not-a-non-negative-integer" },
      }),
    )
    const view = renderApp("/dashboard")
    await view.findByText("New giveaway")

    fireEvent.change(view.getByLabelText("Title"), { target: { value: "Cup" } })
    fireEvent.click(view.getByText("Create giveaway"))

    expect(await view.findByText("Enter a whole number, 0 or more.")).toBeTruthy()
    expect(view.getByLabelText("VIPs").getAttribute("aria-invalid")).toBe("true")
    expect(view.getByLabelText("Title").getAttribute("aria-invalid")).toBe("false")
  })

  it("sends the form as the API expects", async () => {
    const requests = mockFetch(
      createReply({
        status: 400,
        body: { error: "invalid-input", field: "prize", code: "missing" },
      }),
    )
    const view = renderApp("/dashboard")
    await view.findByText("New giveaway")

    fireEvent.change(view.getByLabelText("Title"), { target: { value: "Cup" } })
    fireEvent.change(view.getByLabelText("VIPs"), { target: { value: "5" } })
    fireEvent.click(view.getByLabelText("Subscribers only"))
    fireEvent.change(view.getByLabelText("Minimum account age in days"), { target: { value: "7" } })
    fireEvent.click(view.getByText("Create giveaway"))
    await view.findByText("This field is required.")

    expect(requests.find((request) => request.route === "POST /api/dash/giveaways")?.body).toEqual({
      title: "Cup",
      prize: "",
      rules: {
        tickets: { viewer: 1, follower: 1, sub_t1: 1, sub_t2: 1, sub_t3: 1, vip: 5, moderator: 1 },
        subsOnly: true,
        followersOnly: false,
        minAccountAgeDays: 7,
        claimKeyword: "",
      },
    })
  })

  it("shows the code, the share link and the overlay URL after create", async () => {
    mockFetch(
      createReply({
        status: 201,
        body: { giveaway: dashboardGiveaway, roomReady: true, warnings: [] },
      }),
    )
    const view = renderApp("/dashboard")
    await view.findByText("New giveaway")

    fireEvent.click(view.getByText("Create giveaway"))

    expect(await view.findByText("ABCDE", { selector: "strong" })).toBeTruthy()
    expect(view.getByLabelText("Share link").getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
    expect(view.getByLabelText("Overlay URL for OBS").getAttribute("value")).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
    expect(view.queryByText(/Worker requests are left/)).toBeNull()
  })

  it("warns when the day's requests are nearly used up", async () => {
    mockFetch(
      createReply({
        status: 201,
        body: {
          giveaway: dashboardGiveaway,
          roomReady: true,
          warnings: [{ kind: "worker-requests-low", remaining: 1200 }],
        },
      }),
    )
    const view = renderApp("/dashboard")
    await view.findByText("New giveaway")

    fireEvent.click(view.getByText("Create giveaway"))

    expect(await view.findByText(/only 1200 Worker requests are left today/)).toBeTruthy()
  })

  it("asks for a new sign-in when the session ended during create", async () => {
    mockFetch(createReply({ status: 401, body: { error: "unauthorized" } }))
    const view = renderApp("/dashboard")
    await view.findByText("New giveaway")

    fireEvent.click(view.getByText("Create giveaway"))

    expect(await view.findByText("Sign in with Twitch")).toBeTruthy()
  })
})
