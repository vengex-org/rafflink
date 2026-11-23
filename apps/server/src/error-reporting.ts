import type { ErrorReportingConfig } from "@rafflink/core/config"
import { sentryOptions } from "@rafflink/core/lib/error-reporting"

/** Starts the Sentry SDK when SENTRY_DSN is set; without it the SDK is not even loaded. Returns whether it started. */
export async function startErrorReporting(config: ErrorReportingConfig): Promise<boolean> {
  const options = sentryOptions(config)
  if (options === null) return false
  const { init } = await import("@sentry/bun")
  init(options)
  return true
}
