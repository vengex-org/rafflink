import { errorClass } from "@rafflink/core/lib/error-class"
import { errorReportingMetaNames } from "@rafflink/core/lib/spa-html"

/** What the web build wrote into the page for the browser's Sentry SDK. */
export interface BrowserErrorReporting {
  readonly dsn: string
  readonly environment: string
  readonly release: string | null
  readonly sampleRate: number
}

type Capture = (error: unknown) => void

let capture: Promise<Capture> | null = null

/** Loads and starts the Sentry SDK when the page carries a DSN; without one nothing is loaded and nothing is sent. */
export function startErrorReporting(): void {
  const settings = errorReportingOf(document)
  if (settings === null) return
  // A separate chunk: a page without a DSN, and every page before its first paint, does not download the SDK.
  capture = import("./sentry-browser.ts").then(
    ({ startSentry }) => startSentry(settings),
    // A blocked or failed download leaves the page working; its errors are then only logged.
    (error: unknown) => {
      console.warn("error reporting not loaded", { errorClass: errorClass(error) })
      return () => {}
    },
  )
}

/** Sends an error a component or a hook caught to Sentry, once the SDK has loaded; without a DSN it does nothing. */
export function reportError(error: unknown): void {
  void capture?.then((send) => send(error))
}

function errorReportingOf(page: Document): BrowserErrorReporting | null {
  const read = (name: string) =>
    page.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null
  const dsn = read(errorReportingMetaNames.dsn)
  const environment = read(errorReportingMetaNames.environment)
  const percent = read(errorReportingMetaNames.samplePercent)
  if (dsn === null || environment === null || percent === null) return null
  const release = read(errorReportingMetaNames.release)
  return { dsn, environment, release, sampleRate: Number(percent) / 100 }
}
