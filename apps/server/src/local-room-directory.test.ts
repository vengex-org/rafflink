import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { systemClock, systemRandom } from "@rafflink/core/lib/system-ports"
import { idleChat } from "@rafflink/core/test/contract"
import type { SocketConnector } from "@rafflink/core/ports"
import type { GiveawayRoom } from "@rafflink/core/room/giveaway-room"
import { RoomTransientError } from "@rafflink/core/room/room-directory"
import { giveawayInit, tempDir, testConfig } from "../test/fixtures.ts"
import {
  LocalRoomDirectory,
  liveTopic,
  type LocalRoomDirectoryDeps,
} from "./local-room-directory.ts"

const id = "0123456789abcdef0123456789abcdef"
const otherId = "fedcba9876543210fedcba9876543210"
const viewer = {
  platformUserId: "100",
  login: "viewer",
  displayName: "Viewer",
  isFollower: false,
  subTier: null,
  accountAgeDays: 100,
} as const

let dir: ReturnType<typeof tempDir>
let directories: LocalRoomDirectory[]

beforeEach(() => {
  dir = tempDir()
  directories = []
})

afterEach(async () => {
  for (const directory of directories) await directory.close()
  dir.remove()
})

function directoryWith(overrides: Partial<LocalRoomDirectoryDeps> = {}): LocalRoomDirectory {
  const directory = new LocalRoomDirectory({
    roomsDir: join(dir.path, "rooms"),
    config: testConfig({ LIVE_INTERVAL_MS: "1" }),
    clock: systemClock,
    random: systemRandom,
    publish: () => {},
    onAlarm: async () => {},
    connector: idleChat.connector,
    subscribeChat: idleChat.subscribe,
    ...overrides,
  })
  directories.push(directory)
  return directory
}

describe("LocalRoomDirectory", () => {
  it("returns stubs of the same room for the same id and separate rooms for different ids", async () => {
    const directory = directoryWith()
    await directory.get(id).init(giveawayInit(id))
    await directory.get(otherId).init(giveawayInit(otherId))

    await directory.get(id).enter(viewer)

    expect((await directory.get(id).summary()).entrantCount).toBe(1)
    expect((await directory.get(otherId).summary()).entrantCount).toBe(0)
  })

  it("keeps a room across a restart of the directory", async () => {
    const first = directoryWith()
    await first.get(id).init(giveawayInit(id))
    await first.get(id).enter(viewer)
    await first.close()

    const second = directoryWith()

    expect((await second.get(id).summary()).entrantCount).toBe(1)
  })

  it("refuses an id that is not a giveaway id, so no file is named by it", () => {
    const directory = directoryWith()

    for (const bad of [
      "",
      "../escape",
      "ABCDEF0123456789ABCDEF0123456789",
      `${id}0`,
      "constructor",
    ]) {
      expect(() => directory.get(bad)).toThrow(RangeError)
    }
  })

  it("publishes a live snapshot to the topic of its room", async () => {
    const published: { topic: string; message: string }[] = []
    const directory = directoryWith({
      publish: (topic, message) => published.push({ topic, message }),
    })
    await directory.get(id).init(giveawayInit(id))

    await directory.get(id).enter(viewer)

    expect(published).toHaveLength(1)
    expect(published[0]?.topic).toBe(liveTopic(id))
    expect(JSON.parse(published[0]?.message ?? "")).toMatchObject({ entrantCount: 1 })
  })

  it("wraps a locked room database in RoomTransientError", async () => {
    const directory = directoryWith()
    await directory.get(id).init(giveawayInit(id))
    const rival = new Database(join(dir.path, "rooms", `${id}.sqlite`))
    rival.exec("BEGIN IMMEDIATE")

    try {
      await expect(directory.get(id).enter(viewer)).rejects.toBeInstanceOf(RoomTransientError)
    } finally {
      rival.exec("ROLLBACK")
      rival.close()
    }
    expect((await directory.get(id).enter(viewer)).kind).toBe("entered")
  })

  it("lets an error that is not a lock pass through unwrapped", async () => {
    const directory = directoryWith()

    const error = await directory
      .get(id)
      .summary()
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RoomTransientError)
  })

  it("runs the room alarm callback with the room's id when the alarm fires", async () => {
    const fired: string[] = []
    const directory = directoryWith({ onAlarm: async (giveawayId) => void fired.push(giveawayId) })

    await directory.get(id).init(giveawayInit(id, Date.now() + 40))
    await sleep(150)

    expect(fired).toContain(id)
  })

  it("logs the id and error class of an alarm callback that throws instead of crashing", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const directory = directoryWith({
      onAlarm: async () => {
        throw new TypeError("boom")
      },
    })

    await directory.get(id).init(giveawayInit(id))
    await sleep(60)

    expect(error).toHaveBeenCalledWith("room alarm failed", {
      giveawayId: id,
      errorClass: "TypeError",
    })
    error.mockRestore()
  })

  it("runs the alarm of every room file on reviveAll and ignores other files", async () => {
    const first = directoryWith()
    await first.get(id).init(giveawayInit(id, Date.now() + 40))
    await first.get(otherId).init(giveawayInit(otherId))
    await first.close()
    await sleep(80)
    await Bun.write(join(dir.path, "rooms", "notes.txt"), "not a room")
    await Bun.write(join(dir.path, "rooms", "not-an-id.sqlite"), "not a room")
    const revived: string[] = []
    const second = directoryWith({
      onAlarm: async (giveawayId, room: GiveawayRoom) => {
        room.onAlarm()
        revived.push(giveawayId)
      },
    })

    await second.reviveAll()

    expect(revived.toSorted()).toEqual([id, otherId].toSorted())
    expect((await second.get(id).summary()).status).toBe("closed")
    expect((await second.get(otherId).summary()).status).toBe("open")
  })

  it("closes the chat socket of a room that waits for a claim when the directory closes", async () => {
    let opened = 0
    let closed = 0
    const connector: SocketConnector = {
      open: () => {
        opened += 1
        return { close: () => void (closed += 1) }
      },
    }
    const directory = directoryWith({ connector })
    const room = directory.get(id)
    await room.init(giveawayInit(id))
    await room.enter(viewer)
    await room.close()
    await room.draw(1)
    expect({ opened, closed }).toEqual({ opened: 1, closed: 0 })

    await directory.close()

    expect({ opened, closed }).toEqual({ opened: 1, closed: 1 })
  })

  it("waits for a running alarm before it closes the room database", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const finished: string[] = []
    const directory = directoryWith({
      onAlarm: async (giveawayId, room: GiveawayRoom) => {
        started.resolve()
        await release.promise
        room.summary()
        finished.push(giveawayId)
      },
    })
    await directory.get(id).init(giveawayInit(id, Date.now() + 20))
    await started.promise

    const closing = directory.close()
    release.resolve()
    await closing

    expect(finished).toEqual([id])
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
