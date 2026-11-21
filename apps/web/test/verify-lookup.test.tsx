import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const typeCode = (view: ReturnType<typeof renderApp>, value: string) => {
  fireEvent.change(view.getByLabelText("Giveaway code or link"), { target: { value } })
  fireEvent.click(view.getByRole("button", { name: "Open the verification" }))
}

describe("verify a draw", () => {
  it("opens the verification of the giveaway for a pasted link", async () => {
    const requests = mockFetch({ "GET /api/g/YNX9N/verify": () => ({ status: 404, body: null }) })
    const view = renderApp("/verify")

    typeCode(view, "https://rafflink.example/g/ynx9n")

    await waitFor(() =>
      expect(requests.map((request) => request.route)).toContain("GET /api/g/YNX9N/verify"),
    )
  })

  it("says so next to the field and goes nowhere for something that is no code", () => {
    const requests = mockFetch({ "GET /api/g/ABCDE": () => ok(giveaway) })
    const view = renderApp("/verify")

    typeCode(view, "not a code")

    expect(view.getByText("That is not a giveaway code or link.")).toBeTruthy()
    expect(view.getByRole("heading", { level: 1, name: "Verify a draw" })).toBeTruthy()
    expect(requests.filter((request) => request.route !== "GET /api/session")).toHaveLength(0)
  })

  it("clears the error as soon as the person types again", () => {
    mockFetch({})
    const view = renderApp("/verify")
    typeCode(view, "x")

    fireEvent.change(view.getByLabelText("Giveaway code or link"), { target: { value: "YNX9" } })

    expect(view.queryByText("That is not a giveaway code or link.")).toBeNull()
  })
})

describe("verify link in the header and the home footer", () => {
  it.each(["/", "/privacy", "/verify"])("is in the header of %s when signed out", (path) => {
    mockFetch({})
    const view = renderApp(path)

    expect(view.getAllByRole("link", { name: "Verify a draw" })[0]?.getAttribute("href")).toBe(
      "/verify",
    )
  })

  it("is in the header when signed in, and in the home footer", async () => {
    mockFetch({
      "GET /api/session": () =>
        ok({ streamer: { displayName: "Streamy", login: "streamy", profileImageUrl: null } }),
    })
    const view = renderApp("/")
    await view.findByRole("button", { name: "Streamy" })

    const footer = within(view.getByRole("navigation", { name: "Footer" }))
    expect(footer.getByRole("link", { name: "Verify a draw" }).getAttribute("href")).toBe("/verify")
    expect(view.getAllByRole("link", { name: "Verify a draw" }).length).toBeGreaterThan(1)
  })
})
