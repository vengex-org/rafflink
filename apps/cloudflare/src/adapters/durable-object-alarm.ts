import { errorClass } from "@rafflink/core/lib/error-class"
import type { Alarm, Instant } from "@rafflink/core/ports"
import { captureException } from "@sentry/cloudflare"

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
  captureException(error)
  console.error("alarm write failed", {
    errorClass: errorClass(error),
  })
}
