import { setTimeout as sleep } from "node:timers/promises"

const pollMs = 20

/** Polls `check` until it holds; fails after `timeoutMs` so a test that never gets its event does not hang. */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(pollMs)
  }
}
