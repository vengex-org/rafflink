import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render } from "@testing-library/react"
import { Page } from "../src/components/page.tsx"
import { StatusChip } from "../src/components/status-chip.tsx"
import { WinnerPlate } from "../src/components/winner-plate.tsx"

afterEach(cleanup)

describe("StatusChip", () => {
  it("writes the state in words next to a dot, so color is not the only signal", () => {
    const view = render(<StatusChip tone="success">Entries open</StatusChip>)

    expect(view.getByText("Entries open").closest("[data-tone]")?.getAttribute("data-tone")).toBe(
      "success",
    )
    expect(view.container.querySelector("[aria-hidden='true']")).not.toBeNull()
  })
})

describe("WinnerPlate", () => {
  it("shows the winner name on the plate", () => {
    const view = render(<WinnerPlate name="mira_vex" />)

    expect(view.getByText("mira_vex").closest(".winner-plate")).not.toBeNull()
  })
})

describe("Page", () => {
  it("marks its column width for the stylesheet and keeps the page's own class", () => {
    const view = render(
      <Page width="compact" as="article" className="viewer">
        Prize
      </Page>,
    )

    const column = view.getByRole("article")
    expect(column.getAttribute("data-width")).toBe("compact")
    expect(column.className).toBe("page viewer")
  })

  it("is a plain div with only the page class when the page names no element or class", () => {
    const view = render(<Page width="text">Terms</Page>)

    const column = view.getByText("Terms")
    expect(column.tagName).toBe("DIV")
    expect(column.className).toBe("page")
    expect(column.getAttribute("data-width")).toBe("text")
  })
})
