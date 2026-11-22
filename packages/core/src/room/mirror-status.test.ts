import { afterEach, describe, expect, it, spyOn } from "bun:test"
import type { RoomStatus } from "./rows.ts"
import { mirrorStatus, type MirroredRoom } from "./mirror-status.ts"

afterEach(() => {
  spyOn(console, "warn").mockRestore()
})

function setup(failures: { setStatus?: Error; markMirrored?: Error } = {}) {
  const calls: string[] = []
  const accounts = {
    setStatus: async (id: string, status: RoomStatus) => {
      calls.push(`setStatus ${id} ${status}`)
      if (failures.setStatus !== undefined) throw failures.setStatus
    },
  }
  const room: MirroredRoom = {
    markMirrored: async (status) => {
      calls.push(`markMirrored ${status}`)
      if (failures.markMirrored !== undefined) throw failures.markMirrored
    },
  }
  return { accounts, room, calls }
}

describe("mirrorStatus", () => {
  it("writes the account store first and then tells the room", async () => {
    const { accounts, room, calls } = setup()

    await mirrorStatus(room, accounts, "g1", "closed", 0)

    expect(calls).toEqual(["setStatus g1 closed", "markMirrored closed"])
  })

  it("leaves the status pending in the room when the account store fails, and logs it with the giveaway", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, room, calls } = setup({ setStatus: new TypeError("db down") })

    await mirrorStatus(room, accounts, "g1", "drawn", 0)

    expect(calls).toEqual(["setStatus g1 drawn"])
    expect(warn).toHaveBeenCalledWith("status mirror failed", {
      giveawayId: "g1",
      status: "drawn",
      errorClass: "TypeError",
    })
  })

  it("logs a failed mark separately and does not throw", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { accounts, room } = setup({ markMirrored: new RangeError("room gone") })

    await mirrorStatus(room, accounts, "g1", "closed", 0)

    expect(warn).toHaveBeenCalledWith("mirror mark failed", {
      giveawayId: "g1",
      status: "closed",
      errorClass: "RangeError",
    })
  })
})
