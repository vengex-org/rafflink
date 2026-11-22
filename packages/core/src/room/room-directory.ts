import type { Remote } from "../ports.ts"
import type { GiveawayRoom, RoomCounts } from "./giveaway-room.ts"

/** The counts of a room that is open now; `viewers` are the giveaway pages connected to it, which only the target's socket layer knows. */
export interface LiveCounts extends RoomCounts {
  readonly viewers: number
}

/** The room methods the HTTP app calls, as an async stub: a Durable Object stub, or an in-process room. */
export type RoomStub = Remote<
  { liveCounts(): LiveCounts } & Pick<
    GiveawayRoom,
    | "init"
    | "enter"
    | "summary"
    | "entryOf"
    | "entrants"
    | "leafOf"
    | "verification"
    | "leaves"
    | "close"
    | "requestDraw"
    | "draw"
    | "setWinnerCount"
    | "reroll"
    | "claim"
    | "picks"
    | "removeWinnerName"
    | "markMirrored"
    | "liveSnapshot"
    | "entriesPerSecondBefore"
    | "pushOverlayTheme"
  >
>

/** Finds the room of a giveaway. Any implementation returns a stub for the same room on every call with the same id. */
export interface RoomDirectory {
  get(giveawayId: string): RoomStub
  /** Removes the room's storage and its alarm; a later `get` with the same id finds an empty room. */
  delete(giveawayId: string): Promise<void>
  /** Closes the live sockets the room's pages opened through one moderator link; the room and its other sockets stay. */
  closeModeratorSockets(giveawayId: string, linkId: string): Promise<void>
}

/**
 * A room call that failed in a way a retry can fix: the object was overloaded or answered 5xx. Adapters
 * wrap their runtime's error in it; every other error means the call must not be repeated.
 */
export class RoomTransientError extends Error {}
