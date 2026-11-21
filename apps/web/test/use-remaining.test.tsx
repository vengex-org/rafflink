import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test"
import { act, cleanup, render } from "@testing-library/react"
import { ClockProvider, useRemainingMs, type Clock } from "../src/lib/use-remaining.ts"

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

function Remaining({ initialMs }: { readonly initialMs: number }) {
  return <output>{useRemainingMs(initialMs)}</output>
}

describe("useRemainingMs", () => {
  it("shows the frozen clock's value when paused between two ticks, and resumes from it", () => {
    let at = 0
    const running: Clock = { now: () => at, running: true }
    const paused: Clock = { now: () => at, running: false }
    const view = render(
      <ClockProvider value={running}>
        <Remaining initialMs={10_000} />
      </ClockProvider>,
    )
    const shown = () => view.container.querySelector("output")?.textContent

    at = 1000
    act(() => jest.advanceTimersByTime(1000))
    expect(shown()).toBe("9000")

    at = 1600
    view.rerender(
      <ClockProvider value={paused}>
        <Remaining initialMs={10_000} />
      </ClockProvider>,
    )
    expect(shown()).toBe("8400")
    act(() => jest.advanceTimersByTime(5000))
    expect(shown()).toBe("8400")

    view.rerender(
      <ClockProvider value={{ now: () => at, running: true }}>
        <Remaining initialMs={10_000} />
      </ClockProvider>,
    )
    expect(shown()).toBe("8400")
    at = 2600
    act(() => jest.advanceTimersByTime(1000))
    expect(shown()).toBe("7400")
  })
})
