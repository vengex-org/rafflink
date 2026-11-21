import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render } from "@testing-library/react"
import { Countdown, claimTone } from "../src/components/countdown.tsx"
import { I18nProvider } from "../src/i18n/i18n.tsx"
import type { Tone } from "../src/components/state-card.tsx"

afterEach(cleanup)

const label: Readonly<Record<"info" | "warning" | "danger", string>> = {
  info: "left to claim",
  warning: "left, hurry up",
  danger: "left, claim now",
}

const cases: readonly (readonly [number, "info" | "warning" | "danger", string])[] = [
  [15_000, "info", "0:15"],
  [14_999, "warning", "0:15"],
  [5000, "warning", "0:05"],
  [4999, "danger", "0:05"],
  [0, "danger", "0:00"],
  [-1000, "danger", "0:00"],
]

describe("claimTone", () => {
  it.each(cases)("is %p ms -> %p", (ms, tone) => {
    const result: Tone = claimTone(ms)
    expect(result).toBe(tone)
  })
})

describe("Countdown", () => {
  it.each(cases)("shows the clock and the words of the tone at %p ms", (ms, tone, clock) => {
    const view = render(
      <I18nProvider>
        <Countdown initialMs={ms} />
      </I18nProvider>,
    )

    expect(view.getByRole("timer").textContent).toBe(clock)
    expect(view.getByText(label[tone])).toBeTruthy()
    expect(view.container.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe(tone)
  })
})
