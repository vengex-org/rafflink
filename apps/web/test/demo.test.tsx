import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test"
import { act, cleanup, fireEvent, within } from "@testing-library/react"
import {
  demoClaimMs,
  demoReducer,
  demoSteps,
  demoViewerSeq,
  initialDemoState,
  type DemoState,
} from "../src/lib/demo-script.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"
import { claimedAt, claimedAtText } from "./fixtures.ts"
import { renderApp } from "./render-app.tsx"

describe("demo timeline", () => {
  it("plays the steps in order and stays on the last one", () => {
    const seen: string[] = [initialDemoState.step]
    let state: DemoState = initialDemoState
    for (let index = 0; index < demoSteps.length + 1; index += 1) {
      state = demoReducer(state, { type: "advance", now: 0 })
      seen.push(state.step)
    }

    expect(seen.slice(0, demoSteps.length)).toEqual([...demoSteps])
    expect(seen.at(-1)).toBe("claimed")
  })

  it("records the clock reading of the step that claims, and only that step", () => {
    const won = { ...initialDemoState, step: "won" } as const
    const claimed = demoReducer(won, { type: "advance", now: 5000 })

    expect(demoReducer(initialDemoState, { type: "advance", now: 9 }).claimedAt).toBeNull()
    expect(claimed.claimedAt).toBe(5000)
    expect(demoReducer(claimed, { type: "advance", now: 9000 }).claimedAt).toBe(5000)
  })

  it("counts the visitor on entering and other people only while entries rise", () => {
    const entered = demoReducer(initialDemoState, { type: "advance", now: 0 })
    const rising = demoReducer(entered, { type: "advance", now: 0 })

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
// Timers set by an effect only exist after the render before it, so a long wait runs in slices that each flush it.
const advanceInSlices = (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) advance(100)
}

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

  it("shows the moment of the claim, not the moment the demo started", () => {
    jest.setSystemTime(claimedAt - 30 * 60_000)
    const view = renderApp("/demo")
    for (const ms of [3000, 1500, 5000, 1500, 2500]) advance(ms)
    jest.setSystemTime(claimedAt)

    fireEvent.click(view.getByRole("button", { name: "Claim my prize" }))

    expect(view.getByText(`Claimed on ${claimedAtText}.`)).toBeTruthy()
  })

  it("claims by itself when the visitor outwaits the claim window", () => {
    const view = renderApp("/demo")
    for (const ms of [3000, 1500, 5000, 1500, 2500]) advance(ms)
    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()

    advance(demoClaimMs + 1000)

    expect(view.getByText("Prize claimed")).toBeTruthy()
    expect(view.queryByText("Time is up")).toBeNull()
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

const drawn = (): DemoState => {
  let state: DemoState = initialDemoState
  for (const _ of [0, 1, 2, 3, 4]) {
    state = demoReducer(state, { type: "advance", now: 1000 })
  }
  return state
}

describe("demo script, streamer actions", () => {
  it("counts the visitor when the streamer draws before they entered", () => {
    const state = demoReducer(initialDemoState, { type: "draw", now: 0 })

    expect(state.step).toBe("drawing")
    expect(state.entrants).toBe(initialDemoState.entrants + 1)
  })

  it("closes entries for the streamer and counts the visitor, and ignores a close once they are closed", () => {
    const closed = demoReducer(initialDemoState, { type: "close", now: 0 })

    expect(closed.step).toBe("closed")
    expect(closed.entrants).toBe(initialDemoState.entrants + 1)
    expect(demoReducer(drawn(), { type: "close", now: 0 })).toEqual(drawn())
  })

  it("shows the winner's first chat lines without claiming, and claims on the line with the keyword", () => {
    const thanks = demoReducer(drawn(), { type: "chat", now: 2000 })
    const discord = demoReducer(thanks, { type: "chat", now: 3000 })
    const claim = demoReducer(discord, { type: "chat", now: 4000 })

    expect(discord.chat.map((line) => line.key)).toEqual(["thanks", "discord"])
    expect(discord.claimedAt).toBeNull()
    expect(claim.step).toBe("claimed")
    expect(claim.claimedAt).toBe(4000)
    expect(claim.claimedVia).toBe("chat")
    expect(demoReducer(claim, { type: "chat", now: 5000 })).toEqual(claim)
  })

  it("writes no chat line for a pick the streamer replaced", () => {
    const rerolled = demoReducer(drawn(), { type: "reroll", n: 0, now: 2000 })

    expect(demoReducer(rerolled, { type: "chat", now: 3000 })).toEqual(rerolled)
  })

  it("keeps the planned winner count the streamer sets", () => {
    expect(demoReducer(initialDemoState, { type: "winnerCount", count: 3 }).winnerCount).toBe(3)
  })

  it("draws a later winner who is neither the visitor nor an earlier pick", () => {
    const first = demoReducer(drawn(), { type: "draw", now: 2000 })
    const second = demoReducer(first, { type: "draw", now: 3000 })

    expect(first.laterPicks.map((pick) => pick.n)).toEqual([1])
    expect(second.laterPicks.map((pick) => pick.n)).toEqual([1, 2])
    const seqs = second.laterPicks.map((pick) => pick.seq)
    expect(new Set(seqs).size).toBe(2)
    expect(seqs).not.toContain(demoViewerSeq)
  })

  it("claims and rerolls the visitor's pick only while it is open", () => {
    const rerolled = demoReducer(drawn(), { type: "reroll", n: 0, now: 2000 })

    expect(rerolled.firstRerolled).toBe(true)
    expect(rerolled.laterPicks).toHaveLength(1)
    expect(demoReducer(rerolled, { type: "mark", n: 0, now: 3000 })).toEqual(rerolled)

    const claimed = demoReducer(drawn(), { type: "mark", n: 0, now: 2500 })
    expect(claimed.claimedAt).toBe(2500)
    expect(claimed.step).toBe("claimed")
    expect(demoReducer(claimed, { type: "reroll", n: 0, now: 3000 })).toEqual(claimed)
  })

  it("does not claim a rerolled pick when the script reaches the claim step", () => {
    const rerolled = demoReducer(drawn(), { type: "reroll", n: 0, now: 2000 })

    const end = demoReducer(rerolled, { type: "advance", now: 9000 })

    expect(end.step).toBe("claimed")
    expect(end.claimedAt).toBeNull()
  })
})

describe("demo views", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(Date.UTC(2026, 10, 21, 12))
    restoreSocket = installFakeSocket()
    FakeSocket.opened.length = 0
  })
  afterEach(() => {
    cleanup()
    jest.useRealTimers()
    restoreSocket()
    window.localStorage.clear()
  })

  it("opens on the viewer's view", () => {
    const view = renderApp("/demo")

    expect(view.getByRole("radio", { name: "Viewer" })).toHaveProperty("checked", true)
    expect(view.getByText("Ready to enter?")).toBeTruthy()
  })

  it("shows the same giveaway from the other side after the switch", () => {
    const view = renderApp("/demo")
    fireEvent.click(view.getByRole("link", { name: "Enter with Twitch" }))
    expect(view.getByText("You are in")).toBeTruthy()

    fireEvent.click(view.getByRole("radio", { name: "Streamer" }))

    expect(view.queryByText("You are in")).toBeNull()
    expect(view.getByRole("heading", { name: /Entrants/ }).textContent).toContain("42")
    expect(view.getAllByText("mira_vex").length).toBeGreaterThan(0)

    advanceInSlices(1500 + 5000 + 1500 + 2500 + 3000)
    expect(view.getByRole("heading", { name: "Winner 1 of 1" })).toBeTruthy()

    fireEvent.click(view.getByRole("radio", { name: "Viewer" }))

    expect(view.getByText("You won")).toBeTruthy()
    expect(view.getByRole("button", { name: "Claim my prize" })).toBeTruthy()
  })

  it("shows the winner's chat in the streamer's view after the scripted delay and offers the chat claim to the viewer", () => {
    const view = renderApp("/demo?view=streamer")
    advanceInSlices(3000 + 1500 + 5000 + 1500 + 2500 + 1600)
    expect(view.queryByText("Winner chat")).toBeNull()

    advanceInSlices(4000 + 5000)

    const chat = within(view.getByRole("region", { name: "Winner chat" }))
    expect(chat.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "mira_vexthank you so much!!",
      "mira_vexI will message you on discord",
    ])

    fireEvent.click(view.getByRole("radio", { name: "Viewer" }))
    expect(view.getByText(/type/i, { selector: ".viewer-alt" })).toBeTruthy()
  })

  it("lets the streamer mark the visitor's claim and the viewer sees it", () => {
    const view = renderApp("/demo?view=streamer")
    expect(view.getByRole("radio", { name: "Streamer" })).toHaveProperty("checked", true)
    expect(view.queryByText("Ready to enter?")).toBeNull()
    advanceInSlices(3000 + 1500 + 5000 + 1500 + 2500 + 3000)

    fireEvent.click(view.getByRole("button", { name: "Mark as claimed for mira_vex" }))
    fireEvent.click(view.getByRole("radio", { name: "Viewer" }))

    expect(view.getByText("Prize claimed")).toBeTruthy()
  })

  it("lets the streamer draw, with the shuffle, and reroll the winner", () => {
    const view = renderApp("/demo?view=streamer")

    fireEvent.click(view.getByRole("button", { name: "Draw winner" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, close entries and draw" }))
    advance(0)
    expect(view.getByRole("heading", { name: "Drawing the winner…" })).toBeTruthy()
    advanceInSlices(5500)
    expect(view.getByRole("heading", { name: "Winner 1 of 1" })).toBeTruthy()

    fireEvent.click(view.getByRole("button", { name: "Reroll mira_vex" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, pick another winner" }))
    advanceInSlices(2000)
    fireEvent.click(view.getByRole("radio", { name: "Viewer" }))

    expect(view.getByText("Another winner was picked")).toBeTruthy()
  })

  it("sends no request and opens no socket from the streamer's view", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(refuseFetch, { preconnect: () => {} }),
    )
    const view = renderApp("/demo?view=streamer")

    fireEvent.click(view.getByRole("button", { name: "Closed" }))
    fireEvent.click(view.getByRole("button", { name: "Yes, close entries" }))
    advanceInSlices(10_000)
    fireEvent.click(view.getByRole("button", { name: "Mark as claimed for mira_vex" }))
    await act(() => Promise.resolve())
    fireEvent.click(view.getByRole("button", { name: "Draw next winner" }))
    advanceInSlices(10_000)

    expect(view.getByRole("heading", { name: "Winner 2 of 2" })).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(FakeSocket.opened).toHaveLength(0)
  })
})
