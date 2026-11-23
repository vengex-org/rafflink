import type { ReportError } from "@rafflink/core/ports"
import { captureException } from "@sentry/cloudflare"

/** The {@link ReportError} of the Worker and its Durable Objects: Sentry, with the context as tags an issue is searched by. */
export const sentryReportError: ReportError = (error, context) => {
  captureException(error, { tags: context })
}
