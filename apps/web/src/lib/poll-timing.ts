/** How the giveaway page polls a queued entry. */
export interface PollTiming {
  readonly intervalMs: number
  readonly maxMs: number
}

// Same numbers as the server's QUEUE_POLL_SECONDS and QUEUE_POLL_MAX_SECONDS defaults (spec AC-14); the API does not send them.
export const entryPoll: PollTiming = { intervalMs: 3000, maxMs: 120_000 }
