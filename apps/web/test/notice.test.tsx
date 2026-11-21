import { afterEach, describe, expect, it, jest } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { Status } from "../src/components/notice.tsx"
import { I18nProvider } from "../src/i18n/i18n.tsx"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

function toast(message: string) {
  return (
    <I18nProvider>
      <Status>{message}</Status>
    </I18nProvider>
  )
}

describe("Status toast", () => {
  it("announces the message politely and goes away when dismissed", () => {
    const view = render(toast("Entries closed."))

    expect(view.getByRole("status").textContent).toContain("Entries closed.")
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }))

    expect(view.queryByText("Entries closed.")).toBeNull()
    expect(view.getByRole("status")).toBeTruthy()
  })

  it("dismisses itself after six seconds, not before", () => {
    jest.useFakeTimers()
    const view = render(toast("Entries closed."))

    act(() => jest.advanceTimersByTime(5999))
    expect(view.queryByText("Entries closed.")).not.toBeNull()
    act(() => jest.advanceTimersByTime(1))

    expect(view.queryByText("Entries closed.")).toBeNull()
  })

  it("shows a new message after an earlier one was dismissed", () => {
    const view = render(toast("Entries closed."))
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }))

    view.rerender(toast("Winner drawn."))

    expect(view.queryByText("Winner drawn.")).not.toBeNull()
  })
})

describe("not found page", () => {
  it("names the missing page and offers the way back to the home page", () => {
    const view = renderApp("/no/such/page")

    expect(view.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy()
    expect(view.getByRole("link", { name: "Go to the home page" }).getAttribute("href")).toBe("/")
  })

  it("shows the status code as decoration that screen readers skip", () => {
    const view = renderApp("/no/such/page")

    const code = view.getByText("404")
    expect(code.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true")
  })
})
