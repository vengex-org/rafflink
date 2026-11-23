import { afterEach, describe, expect, it, spyOn } from "bun:test"
import type { RoomMirror } from "./giveaway-room.ts"
import { mirrorStatus, type MirroredRoom } from "./mirror-status.ts"

afterEach(() => {
  spyOn(console, "warn").mockRestore()
})

const drawn: RoomMirror = { status: "drawn", entrantCount: 3, winners: 2, claimed: 1, delivered: 0 }

function text(mirror: RoomMirror): string {
  return `${mirror.status} ${mirror.entrantCount} ${mirror.winners}`
}

function setup(failures: { mirrorState?: Error; setStatus?: Error; markMirrored?: Error } = {}) {
  const calls: string[] = []
  const accounts = {
    setStatus: async (id: string, mirror: RoomMirror) => {
      calls.push(`setStatus ${id} ${text(mirror)}`)
      if (failures.setStatus !== undefined) throw failures.setStatus
    },
  }
  const room: MirroredRoom = {
    mirrorState: async () => {
      if (failures.mirrorState !== undefined) throw failures.mirrorState
      return drawn
    },
    markMirrored: async (mirror) => {
      calls.push(`markMirrored ${text(mirror)}`)
      if (failures.markMirrored !== undefined) throw failures.markMirrored
    },
  }
  return { accounts, room, calls }
}

describe("mirrorStatus", () => {
  it("writes the room's status and counts to the account store first and then tells the room", async () => {
    const { accounts, room, calls } = setup()

    await mirrorStatus(room, accounts, "g1", 0)

    expect(calls).toEqual(["setStatus g1 drawn 3 2", "markMirrored drawn 3 2"])
  })

  it("leaves the mirror pending in the room when the account store fails, and logs it with the giveaway", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, room, calls } = setup({ setStatus: new TypeError("db down") })

    await mirrorStatus(room, accounts, "g1", 0)

    expect(calls).toEqual(["setStatus g1 drawn 3 2"])
    expect(warn).toHaveBeenCalledWith("status mirror failed", {
      giveawayId: "g1",
      status: "drawn",
      errorClass: "TypeError",
    })
  })

  it("writes nothing when the room cannot be read, and logs it", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, room, calls } = setup({ mirrorState: new RangeError("room gone") })

    await mirrorStatus(room, accounts, "g1", 0)

    expect(calls).toEqual([])
    expect(warn).toHaveBeenCalledWith("mirror state read failed", {
      giveawayId: "g1",
      errorClass: "RangeError",
    })
  })

  it("logs a failed mark separately and does not throw", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, room } = setup({ markMirrored: new RangeError("room gone") })

    await mirrorStatus(room, accounts, "g1", 0)

    expect(warn).toHaveBeenCalledWith("mirror mark failed", {
      giveawayId: "g1",
      status: "drawn",
      errorClass: "RangeError",
    })
  })
})
