import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test"
import { act, cleanup, fireEvent } from "@testing-library/react"
import { demoReducer, demoSteps, initialDemoState, type DemoState } from "../src/lib/demo-script.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { renderApp } from "./render-app.tsx"

describe("demo timeline", () => {
  it("plays the steps in order and stays on the last one", () => {
    const seen: string[] = [initialDemoState.step]
    let state: DemoState = initialDemoState
    for (let index = 0; index < demoSteps.length + 1; index += 1) {
      state = demoReducer(state, { type: "advance" })
      seen.push(state.step)
    }

    expect(seen.slice(0, demoSteps.length)).toEqual([...demoSteps])
    expect(seen.at(-1)).toBe("claimed")
  })

  it("counts the visitor on entering and other people only while entries rise", () => {
    const entered = demoReducer(initialDemoState, { type: "advance" })
    const rising = demoReducer(entered, { type: "advance" })

    expect(entered.entrants).toBe(initialDemoState.entrants + 1)
    expect(demoReducer(initialDemoState, { type: "join" })).toEqual(initialDemoState)
    expect(demoReducer(entered, { type: "join" })).toEqual(entered)
    expect(demoReducer(rising, { type: "join" }).entrants).toBe(entered.entrants + 1)
  })
})

const refuseFetch = () => {
  throw new Error("the demo must not call fetch")
}
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms))

let restoreSocket = () => {}

describe("demo page", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    restoreSocket = installFakeSocket()
    FakeSocket.opened.length = 0
  })
  afterEach(() => {
    cleanup()
    jest.useRealTimers()
    restoreSocket()
  })

  it("plays a giveaway from entering to the claim without a request, and plays again", () => {
    // lib.dom's fetch type has no `preconnect`, Bun's has; the demo never calls it.
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(refuseFetch, { preconnect: () => {} }),
    )
    const view = renderApp("/demo")

    expect(view.getByText("Demo")).toBeTruthy()
    expect(view.getByRole("heading", { level: 1, name: "A gaming chair" })).toBeTruthy()
    expect(view.getByText("41 people entered")).toBeTruthy()
    expect(view.getByText("Ready to enter?")).toBeTruthy()

    fireEvent.click(view.getByRole("link", { name: "Enter with Twitch" }))
    expect(view.getByText("You are in")).toBeTruthy()
    expect(view.getByText("42 people entered")).toBeTruthy()

    advance(1500)
    advance(2100)
    expect(view.getByText("45 people entered")).toBeTruthy()
    expect(view.getByText(/Entries close in/)).toBeTruthy()

    advance(2900)
    expect(view.getByText("Entries closed")).toBeTruthy()
    expect(view.getByText("Waiting for the draw")).toBeTruthy()

    advance(1500)
    expect(view.getByText("Drawing a winner…")).toBeTruthy()

    advance(2500)
    expect(view.getByText("mira_vex")).toBeTruthy()
    expect(view.getByText("You won")).toBeTruthy()

    fireEvent.click(view.getByRole("button", { name: "Claim my prize" }))
    expect(view.getByText("Prize claimed")).toBeTruthy()

    fireEvent.click(view.getByRole("button", { name: "Play again" }))
    expect(view.getByText("Ready to enter?")).toBeTruthy()
    expect(view.getByText("41 people entered")).toBeTruthy()
    expect(view.queryByText("mira_vex")).toBeNull()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(FakeSocket.opened).toHaveLength(0)
  })

  it("enters by itself when the visitor does nothing", () => {
    const view = renderApp("/demo")

    advance(3000)

    expect(view.getByText("You are in")).toBeTruthy()
  })

  it("keeps every link inside the demo from reaching the API or the sign-in", () => {
    const view = renderApp("/demo")

    const targets = [...view.container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    )

    expect(targets.filter((href) => href?.startsWith("/api") || href?.startsWith("/auth"))).toEqual(
      [],
    )
  })
})
