import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render } from "@testing-library/react"
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
