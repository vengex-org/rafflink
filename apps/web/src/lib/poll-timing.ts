/** How the giveaway page polls a queued entry; the server sends it with the giveaway. */
export interface PollTiming {
  readonly intervalMs: number
  readonly maxMs: number
}
