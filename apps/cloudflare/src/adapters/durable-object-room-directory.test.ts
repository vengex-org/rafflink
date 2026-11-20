import { describe, expect, it } from "bun:test"
import { RoomTransientError } from "@rafflink/core/room/room-directory"
import { inRoom } from "./durable-object-room-directory.ts"

/** An error the way the Durable Object runtime marks one: a property on an `Error`. */
function runtimeError(flag: "overloaded" | "retryable", value: unknown): Error {
  return Object.assign(new Error("object call failed"), { [flag]: value })
}

describe("inRoom", () => {
  it("returns what the room answers", async () => {
    expect(await inRoom(async () => ({ kind: "closed" }))).toEqual({ kind: "closed" })
  })

  it("turns an overloaded object into a transient error that keeps its cause", async () => {
    const cause = runtimeError("overloaded", true)

    const failure = await inRoom(() => Promise.reject(cause)).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RoomTransientError)
    expect(failure).toMatchObject({ cause })
  })

  it("turns a retryable object failure into a transient error", async () => {
    const failure = await inRoom(() => Promise.reject(runtimeError("retryable", true))).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(RoomTransientError)
  })

  it("passes any other failure on unchanged", async () => {
    for (const cause of [
      new Error("room is broken"),
      runtimeError("overloaded", false),
      runtimeError("retryable", "yes"),
    ]) {
      const failure = await inRoom(() => Promise.reject(cause)).catch((error: unknown) => error)
      expect(failure).toBe(cause)
    }
  })
})
