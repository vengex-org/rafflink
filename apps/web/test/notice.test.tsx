import { afterEach, describe, expect, it, jest } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { Status } from "../src/components/notice.tsx"
import { I18nProvider } from "../src/i18n/i18n.tsx"

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
