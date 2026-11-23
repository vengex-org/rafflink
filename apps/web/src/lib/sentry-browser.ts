import { minimalDataCollection, scrubEvent } from "@rafflink/core/lib/error-reporting"
import { captureException, init, type BrowserOptions } from "@sentry/react"
import { ApiError } from "../api/client.ts"
import type { BrowserErrorReporting } from "./error-reporting.ts"

/** Starts the SDK and returns how a caught error is sent; uncaught errors and rejections it catches on its own. */
export function startSentry(settings: BrowserErrorReporting): (error: unknown) => void {
  init(browserSentryOptions(settings))
  return (error) => {
    captureException(error)
  }
}

// What `fetch` throws when the network fails or the page is left mid-request, in Chrome, Firefox and Safari.
const networkFailures = [
  /^Failed to fetch$/,
  /^NetworkError when attempting to fetch resource\.$/,
  /^Load failed$/,
]

/** Errors only: no tracing, no replay, no session pings, no personal data. */
export function browserSentryOptions(settings: BrowserErrorReporting): BrowserOptions {
  return {
    dsn: settings.dsn,
    environment: settings.environment,
    ...(settings.release === null ? {} : { release: settings.release }),
    sampleRate: settings.sampleRate,
    tracesSampleRate: 0,
    dataCollection: minimalDataCollection,
    integrations: (defaults) => defaults.filter(({ name }) => name !== "BrowserSession"),
    ignoreErrors: networkFailures,
    // An answer of the API with a status the page did not expect: a 401 after the session expired, a 4xx the user
    // caused, or a 5xx the server has reported itself.
    beforeSend: (event, hint) =>
      hint.originalException instanceof ApiError ? null : scrubEvent(event),
  }
}
