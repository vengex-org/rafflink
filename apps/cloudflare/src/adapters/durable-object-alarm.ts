import type { Alarm, Instant } from "@rafflink/core/ports"

/** The {@link Alarm} of one Durable Object: its storage alarm, which the runtime fires through `alarm()`. */
export class DurableObjectAlarm implements Alarm {
  constructor(private readonly storage: DurableObjectStorage) {}

  set(at: Instant): void {
    this.storage.setAlarm(at).catch(reportFailure)
  }

  clear(): void {
    this.storage.deleteAlarm().catch(reportFailure)
  }
}

// The port is synchronous and the storage write is not; a failure has no caller left to receive it.
function reportFailure(error: unknown): void {
  console.error("alarm write failed", {
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
  })
}
