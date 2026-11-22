import { describe, expect, it } from "bun:test"
import type { ActionActors } from "@rafflink/core/room/giveaway-room"
import { parseLiveSnapshot, parseOverlaySnapshot } from "../src/api/client.ts"
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
  it("keeps whether the chat watch is open and rejects a snapshot without it", () => {
    const { winnerChatOpen: _omitted, ...without } = liveSnapshot

    expect(parseLiveSnapshot({ ...liveSnapshot, winnerChatOpen: true }).winnerChatOpen).toBe(true)
    expect(() => parseLiveSnapshot(without)).toThrow(ApiShapeError)
    expect(() => parseLiveSnapshot({ ...liveSnapshot, winnerChatOpen: "yes" })).toThrow(
      ApiShapeError,
    )
  })

  it("keeps the chat lines in order", () => {
    const winnerChat = [
      { id: 1, name: "Ada", text: "first", at: 1 },
      { id: 2, name: "Ada", text: "second", at: 2 },
    ]

    expect(parseLiveSnapshot({ ...liveSnapshot, winnerChat }).winnerChat).toEqual(winnerChat)
  })

  it("rejects a live snapshot without winnerChat", () => {
    const { winnerChat: _omitted, ...overlay } = liveSnapshot

    expect(() => parseLiveSnapshot(overlay)).toThrow(ApiShapeError)
  })

  it("rejects a malformed chat line", () => {
    const bad = { ...liveSnapshot, winnerChat: [{ id: 1, name: "Ada", text: 5, at: 1 }] }

    expect(() => parseLiveSnapshot(bad)).toThrow(ApiShapeError)
  })

  it("rejects a chat line without an id or with a non-numeric one", () => {
    for (const line of [
      { name: "Ada", text: "hi", at: 1 },
      { id: "1", name: "Ada", text: "hi", at: 1 },
    ]) {
      expect(() => parseLiveSnapshot({ ...liveSnapshot, winnerChat: [line] })).toThrow(
        ApiShapeError,
      )
    }
  })
})

describe("parseLiveSnapshot actors", () => {
  it("keeps who pressed each action", () => {
    const actors: ActionActors = {
      closedBy: "mod:abc",
      picks: [{ n: 0, drawnBy: "streamer", rerolledBy: null, claimMarkedBy: "mod:abc" }],
    }

    expect(parseLiveSnapshot({ ...liveSnapshot, actors }).actors).toEqual(actors)
  })

  it("rejects an actor the room never writes and a snapshot without actors", () => {
    const { actors: _omitted, ...without } = liveSnapshot

    for (const closedBy of ["mod:", "admin", 3]) {
      expect(() => parseLiveSnapshot({ ...liveSnapshot, actors: { closedBy, picks: [] } })).toThrow(
        ApiShapeError,
      )
    }
    expect(() => parseLiveSnapshot(without)).toThrow(ApiShapeError)
  })
})

describe("parseOverlaySnapshot", () => {
  it("reads a snapshot without winnerChat, picksLeft and actors and returns none of them", () => {
    const {
      winnerChat: _chat,
      winnerChatOpen: _open,
      picksLeft: _left,
      actors: _actors,
      ...overlay
    } = liveSnapshot

    const parsed = parseOverlaySnapshot(overlay)

    expect(parsed).toEqual(overlay)
    expect(Object.hasOwn(parsed, "winnerChat")).toBe(false)
  })

  it("drops a winnerChat the sender added", () => {
    const parsed = parseOverlaySnapshot({
      ...liveSnapshot,
      winnerChat: [{ id: 1, name: "Ada", text: "secret", at: 1 }],
    })

    expect(Object.hasOwn(parsed, "winnerChat")).toBe(false)
  })

  it("rejects a snapshot with a malformed common field", () => {
    expect(() => parseOverlaySnapshot({ ...liveSnapshot, entrantCount: "many" })).toThrow(
      ApiShapeError,
    )
  })
})

describe("snapshot drawAvailableAt", () => {
  it("keeps the instant the committed round is published, or null", () => {
    expect(parseLiveSnapshot({ ...liveSnapshot, drawAvailableAt: 5 }).drawAvailableAt).toBe(5)
    expect(
      parseOverlaySnapshot({ ...liveSnapshot, drawAvailableAt: null }).drawAvailableAt,
    ).toBeNull()
  })

  it("rejects a snapshot without it", () => {
    const { drawAvailableAt: _omitted, ...without } = liveSnapshot

    expect(() => parseLiveSnapshot(without)).toThrow(ApiShapeError)
  })
})
