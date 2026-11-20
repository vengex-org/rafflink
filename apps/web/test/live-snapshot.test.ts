import { describe, expect, it } from "bun:test"
import { parseLiveSnapshot } from "../src/api/client.ts"
import { ApiShapeError } from "../src/api/decode.ts"
import { liveSnapshot } from "./fixtures.ts"

describe("parseLiveSnapshot reroll state", () => {
  it("keeps the reason a reroll is blocked", () => {
    const parsed = parseLiveSnapshot({
      ...liveSnapshot,
      rerollOpen: false,
      rerollBlocked: "nobody-left",
    })

    expect(parsed).toMatchObject({ rerollOpen: false, rerollBlocked: "nobody-left" })
  })

  it("rejects a snapshot without rerollBlocked", () => {
    const { rerollBlocked: _omitted, ...withoutReason } = liveSnapshot

    expect(() => parseLiveSnapshot(withoutReason)).toThrow(ApiShapeError)
  })

  it("rejects an unknown rerollBlocked value and a reason on an open reroll", () => {
    const unknown = { ...liveSnapshot, rerollBlocked: "tired" }
    const openWithReason = { ...liveSnapshot, rerollOpen: true, rerollBlocked: "window-over" }

    expect(() => parseLiveSnapshot(unknown)).toThrow(ApiShapeError)
    expect(() => parseLiveSnapshot(openWithReason)).toThrow(ApiShapeError)
  })
})

describe("parseLiveSnapshot winner chat", () => {
  it("keeps the chat lines in order", () => {
    const winnerChat = [
      { name: "Ada", text: "first", at: 1 },
      { name: "Ada", text: "second", at: 2 },
    ]

    expect(parseLiveSnapshot({ ...liveSnapshot, winnerChat }).winnerChat).toEqual(winnerChat)
  })

  it("reads a snapshot without winnerChat, which the overlay route sends, as no lines", () => {
    const { winnerChat: _omitted, ...overlay } = liveSnapshot

    expect(parseLiveSnapshot(overlay).winnerChat).toEqual([])
  })

  it("rejects a malformed chat line", () => {
    const bad = { ...liveSnapshot, winnerChat: [{ name: "Ada", text: 5, at: 1 }] }

    expect(() => parseLiveSnapshot(bad)).toThrow(ApiShapeError)
  })
})
