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
