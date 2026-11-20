import type { Clock, Random } from "../ports.ts"

/** The real time. */
export const systemClock: Clock = { now: () => Date.now() }

/** Bytes from the platform's cryptographically secure generator. */
export const systemRandom: Random = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
}
