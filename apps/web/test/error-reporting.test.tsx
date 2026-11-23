import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test"
import { withErrorReportingMeta } from "@rafflink/core/lib/spa-html"
import { startFakeSentry, type FakeSentry } from "@rafflink/core/test/contract"
import { flush, getClient } from "@sentry/react"
import { cleanup, render } from "@testing-library/react"
import { ApiError } from "../src/api/client.ts"
import { ErrorBoundary } from "../src/components/error-boundary.tsx"
import { Failed } from "../src/components/notice.tsx"
import { I18nProvider } from "../src/i18n/i18n.tsx"
import { reportError, startErrorReporting } from "../src/lib/error-reporting.ts"

let sentry: FakeSentry
let logged: ReturnType<typeof spyOn>
let warned: ReturnType<typeof spyOn>

// The SDK wraps timers, listeners, `fetch`, `history` and the console of the page; the other test files share this
// window and their fake timers must not run through the wrappers, so the originals come back after this file.
const wrapped: [object, string, PropertyDescriptor | undefined][] = []

function remember(target: object, keys: readonly string[]): void {
  for (const key of keys) wrapped.push([target, key, Object.getOwnPropertyDescriptor(target, key)])
}

function restoreWrapped(): void {
  for (const [target, key, descriptor] of wrapped) {
    if (descriptor === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, descriptor)
  }
}

beforeAll(async () => {
  remember(window, ["setTimeout", "setInterval", "requestAnimationFrame", "fetch", "onerror"])
  remember(window, ["onunhandledrejection"])
  remember(console, ["debug", "info", "warn", "error", "log", "assert", "trace"])
  remember(history, ["pushState", "replaceState"])
  remember(XMLHttpRequest.prototype, ["open", "send"])
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    const global: unknown = Reflect.get(globalThis, name)
    const prototype: unknown = typeof global === "function" ? global.prototype : null
    if (
      typeof prototype === "object"
      && prototype !== null
      && Object.hasOwn(prototype, "addEventListener")
    ) {
      remember(prototype, ["addEventListener", "removeEventListener"])
    }
  }
  sentry = await startFakeSentry()
  logged = spyOn(console, "error").mockImplementation(() => {})
  warned = spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  document.head.innerHTML = ""
})

afterAll(async () => {
  await getClient()?.close()
  await sentry.stop()
  logged.mockRestore()
  warned.mockRestore()
  restoreWrapped()
})

function Broken(): never {
  throw new RangeError("render broke")
}

/** The head the web build writes for a DSN, here the fake ingest's. */
function buildWithDsn(dsn: string): void {
  const html = withErrorReportingMeta("<head></head>", {
    sentryDsn: dsn,
    sentryEnvironment: "test",
    sentryRelease: "test-release",
    sentrySamplePercent: 100,
  })
  document.head.innerHTML = html.replace(/^<head>|<\/head>$/g, "")
}

describe("error reporting in the browser", () => {
  // First: the module keeps the SDK it started for the rest of the file.
  it("loads no SDK and sends nothing when the page carries no DSN", async () => {
    startErrorReporting()
    reportError(new Error("caught"))
    render(
      <I18nProvider>
        <ErrorBoundary fallback={<Failed />}>
          <Broken />
        </ErrorBoundary>
      </I18nProvider>,
    )
    await Bun.sleep(200)

    expect(getClient()).toBeUndefined()
    expect(sentry.requests()).toBe(0)
  })

  it("shows the fallback for a render error and reports it with the release and the environment", async () => {
    buildWithDsn(sentry.dsn)
    startErrorReporting()

    const view = render(
      <I18nProvider>
        <ErrorBoundary fallback={<Failed />}>
          <Broken />
        </ErrorBoundary>
      </I18nProvider>,
    )
    await sentry.eventsArrived(1)

    expect(view.getByRole("alert")).toBeTruthy()
    expect(sentry.events[0]).toMatchObject({
      release: "test-release",
      environment: "test",
      exception: { values: [{ type: "RangeError", value: "render broke" }] },
    })
  })

  it("leaves the overlay token and what was logged before out of a report", async () => {
    const before = sentry.events.length
    window.history.pushState(null, "", "/overlay/gid-1/secret-token-1")

    console.warn("lookup failed", { error: new Error("login foo_viewer") })
    reportError(new RangeError("overlay broke"))
    await sentry.eventsArrived(before + 1)
    window.history.pushState(null, "", "/")

    expect(sentry.events[before]).toMatchObject({
      request: { url: "http://rafflink.test/overlay/gid-1/[Filtered]" },
    })
    expect(JSON.stringify(sentry.events.slice(before))).not.toContain("secret-token-1")
    expect(JSON.stringify(sentry.events.slice(before))).not.toContain("foo_viewer")
  })

  it("sends no answer of the API, such as a 401 after the session expired", async () => {
    const before = sentry.events.length

    reportError(new ApiError(401))
    reportError(new SyntaxError("push not understood"))
    await sentry.eventsArrived(before + 1)
    await flush(500)

    expect(sentry.events.slice(before)).toEqual([
      expect.objectContaining({
        exception: { values: [expect.objectContaining({ type: "SyntaxError" })] },
      }),
    ])
  })

  it("shows nothing in place of a broken overlay", () => {
    const view = render(
      <ErrorBoundary fallback={null}>
        <Broken />
      </ErrorBoundary>,
    )

    expect(view.container.innerHTML).toBe("")
  })
})
