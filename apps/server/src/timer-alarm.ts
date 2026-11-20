import type { Alarm, Clock, Instant } from "@rafflink/core/ports"

// setTimeout keeps its delay in a signed 32-bit integer and fires at once beyond it. A wake-up this
// early finds nothing due, and the owner arms the next alarm.
const maxTimerDelayMs = 2 ** 31 - 1

/** An {@link Alarm} on one timer. `onFire` must not throw: nothing awaits a timer callback. */
export class TimerAlarm implements Alarm {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly clock: Clock,
    private readonly onFire: () => void,
  ) {}

  set(at: Instant): void {
    this.clear()
    const delay = Math.min(Math.max(at - this.clock.now(), 0), maxTimerDelayMs)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onFire()
    }, delay)
  }

  clear(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
