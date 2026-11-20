import { describe, expect, it } from "bun:test"
import { skipWhileRunning } from "./skip-while-running.ts"

describe("skipWhileRunning", () => {
  it("does not start the job again while the previous run waits", async () => {
    let starts = 0
    const finish: (() => void)[] = []
    const run = skipWhileRunning(() => {
      starts++
      return new Promise<void>((resolve) => finish.push(resolve))
    })

    const first = run()
    await run()

    expect(starts).toBe(1)
    finish[0]?.()
    await first
  })

  it("runs the job again after the previous run ended, also after it threw", async () => {
    let starts = 0
    const run = skipWhileRunning(async () => {
      starts++
      if (starts === 1) throw new TypeError("first run fails")
    })

    await expect(run()).rejects.toThrow("first run fails")
    await run()

    expect(starts).toBe(2)
  })
})
