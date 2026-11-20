/** Wraps `job` so a call that arrives while the previous run is still going returns at once and does nothing. */
export function skipWhileRunning(job: () => Promise<void>): () => Promise<void> {
  let running = false
  return async () => {
    if (running) return
    running = true
    try {
      await job()
    } finally {
      running = false
    }
  }
}
