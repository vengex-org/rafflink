import type { GiveawayRoom } from "@rafflink/core/room/giveaway-room"
import {
  RoomTransientError,
  type RoomDirectory,
  type RoomStub,
} from "@rafflink/core/room/room-directory"
import type { GiveawayRoomObject } from "../durable-objects/giveaway-room-do.ts"

/** Rooms as Durable Objects named by the giveaway id. */
export class DurableObjectRoomDirectory implements RoomDirectory {
  constructor(private readonly namespace: DurableObjectNamespace<GiveawayRoomObject>) {}

  // The stub is made per call of `get`: it belongs to the request that asked for the room.
  get(giveawayId: string): RoomStub {
    return new DurableObjectRoomStub(this.stubOf(giveawayId))
  }

  delete(giveawayId: string): Promise<void> {
    return inRoom(() => this.stubOf(giveawayId).destroy())
  }

  closeModeratorSockets(giveawayId: string, linkId: string): Promise<void> {
    return inRoom(() => this.stubOf(giveawayId).closeModeratorSockets(linkId))
  }

  private stubOf(giveawayId: string): DurableObjectStub<GiveawayRoomObject> {
    return this.namespace.get(this.namespace.idFromName(giveawayId))
  }
}

/** The room's methods as RPC calls; an overloaded or retryable object is transient, anything else is not. */
class DurableObjectRoomStub implements RoomStub {
  constructor(private readonly stub: DurableObjectStub<GiveawayRoomObject>) {}

  init(...args: Parameters<GiveawayRoom["init"]>) {
    return inRoom(() => this.stub.init(...args))
  }
  loadExclusions(...args: Parameters<GiveawayRoom["loadExclusions"]>) {
    return inRoom(() => this.stub.loadExclusions(...args))
  }
  replaceBlocked(...args: Parameters<GiveawayRoom["replaceBlocked"]>) {
    return inRoom(() => this.stub.replaceBlocked(...args))
  }
  enter(...args: Parameters<GiveawayRoom["enter"]>) {
    return inRoom(() => this.stub.enter(...args))
  }
  summary() {
    return inRoom(() => this.stub.summary())
  }
  entryOf(...args: Parameters<GiveawayRoom["entryOf"]>) {
    return inRoom(() => this.stub.entryOf(...args))
  }
  entrants(...args: Parameters<GiveawayRoom["entrants"]>) {
    return inRoom(() => this.stub.entrants(...args))
  }
  leafOf(...args: Parameters<GiveawayRoom["leafOf"]>) {
    return inRoom(() => this.stub.leafOf(...args))
  }
  verification() {
    return inRoom(() => this.stub.verification())
  }
  leaves() {
    return inRoom(() => this.stub.leaves())
  }
  close(...args: Parameters<GiveawayRoom["close"]>) {
    return inRoom(() => this.stub.close(...args))
  }
  requestDraw(...args: Parameters<GiveawayRoom["requestDraw"]>) {
    return inRoom(() => this.stub.requestDraw(...args))
  }
  draw(...args: Parameters<GiveawayRoom["draw"]>) {
    return inRoom(() => this.stub.draw(...args))
  }
  setWinnerCount(...args: Parameters<GiveawayRoom["setWinnerCount"]>) {
    return inRoom(() => this.stub.setWinnerCount(...args))
  }
  reroll(...args: Parameters<GiveawayRoom["reroll"]>) {
    return inRoom(() => this.stub.reroll(...args))
  }
  claim(...args: Parameters<GiveawayRoom["claim"]>) {
    return inRoom(() => this.stub.claim(...args))
  }
  picks() {
    return inRoom(() => this.stub.picks())
  }
  removeWinnerName(...args: Parameters<GiveawayRoom["removeWinnerName"]>) {
    return inRoom(() => this.stub.removeWinnerName(...args))
  }
  markMirrored(...args: Parameters<GiveawayRoom["markMirrored"]>) {
    return inRoom(() => this.stub.markMirrored(...args))
  }
  liveSnapshot() {
    return inRoom(() => this.stub.liveSnapshot())
  }
  entriesPerSecondBefore(...args: Parameters<GiveawayRoom["entriesPerSecondBefore"]>) {
    return inRoom(() => this.stub.entriesPerSecondBefore(...args))
  }
  pushOverlayTheme(...args: Parameters<GiveawayRoom["pushOverlayTheme"]>) {
    return inRoom(() => this.stub.pushOverlayTheme(...args))
  }
  liveCounts() {
    return inRoom(() => this.stub.liveCounts())
  }
}

/** Runs a call on a room object and turns the runtime's retryable failures into {@link RoomTransientError}. */
export async function inRoom<Result extends PromiseLike<unknown>>(
  call: () => Result,
): Promise<Awaited<Result>> {
  try {
    return await call()
  } catch (error) {
    if (isTransient(error)) {
      throw new RoomTransientError("room object is overloaded or retryable", { cause: error })
    }
    throw error
  }
}

// The runtime marks the errors of a call that may succeed on a repeat with these two properties.
function isTransient(error: unknown): boolean {
  return (
    error instanceof Error
    && (Reflect.get(error, "overloaded") === true || Reflect.get(error, "retryable") === true)
  )
}
