import { describe, expect, it } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { systemClock } from "@rafflink/core/lib/system-ports"
import { TimerAlarm } from "./timer-alarm.ts"

function alarm() {
  const fired: number[] = []
  return { fired, alarm: new TimerAlarm(systemClock, () => fired.push(Date.now())) }
}

describe("TimerAlarm", () => {
  it("fires once at the set time", async () => {
    const { fired, alarm: timer } = alarm()
    const at = Date.now() + 40

    timer.set(at)
    await sleep(120)

    expect(fired).toHaveLength(1)
    expect(fired[0]).toBeGreaterThanOrEqual(at - 5)
  })

  it("fires at once for a time in the past", async () => {
    const { fired, alarm: timer } = alarm()

    timer.set(Date.now() - 10_000)
    await sleep(30)

    expect(fired).toHaveLength(1)
  })

  it("replaces the pending alarm when set again", async () => {
    const { fired, alarm: timer } = alarm()

    timer.set(Date.now() + 40)
    timer.set(Date.now() + 10_000)
    await sleep(120)

    expect(fired).toHaveLength(0)
    timer.clear()
  })

  it("does not fire after clear", async () => {
    const { fired, alarm: timer } = alarm()

    timer.set(Date.now() + 40)
    timer.clear()
    await sleep(120)

    expect(fired).toHaveLength(0)
  })

  it("can be cleared when nothing is pending and set again afterwards", async () => {
    const { fired, alarm: timer } = alarm()

    timer.clear()
    timer.set(Date.now() + 20)
    await sleep(80)

    expect(fired).toHaveLength(1)
  })

  it("does not fire early for a time beyond the 32-bit timer limit", async () => {
    const { fired, alarm: timer } = alarm()

    timer.set(Date.now() + 2 ** 31 + 1000)
    await sleep(80)

    expect(fired).toHaveLength(0)
    timer.clear()
  })
})
