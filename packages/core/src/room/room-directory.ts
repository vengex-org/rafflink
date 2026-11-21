import type { Remote } from "../ports.ts"
import type { GiveawayRoom } from "./giveaway-room.ts"

/** The room methods the HTTP app calls, as an async stub: a Durable Object stub, or an in-process room. */
export type RoomStub = Remote<
  Pick<
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
    | "markMirrored"
    | "liveSnapshot"
  >
>

/** Finds the room of a giveaway. Any implementation returns a stub for the same room on every call with the same id. */
export interface RoomDirectory {
  get(giveawayId: string): RoomStub
}

/**
 * A room call that failed in a way a retry can fix: the object was overloaded or answered 5xx. Adapters
 * wrap their runtime's error in it; every other error means the call must not be repeated.
 */
export class RoomTransientError extends Error {}
