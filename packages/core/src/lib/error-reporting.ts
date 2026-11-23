import type {
  Breadcrumb,
  DataCollection,
  ErrorEvent,
  EventHint,
  Options,
  RequestEventData,
} from "@sentry/core"
import type { ErrorReportingConfig } from "../config.ts"
import { PlatformRateLimited } from "../platform/errors.ts"

/** The options both server targets start their Sentry SDK with: errors only, no tracing, no personal data. */
export type SentryOptions = Pick<
  Options,
  | "dsn"
  | "environment"
  | "release"
  | "sampleRate"
  | "tracesSampleRate"
  | "dataCollection"
  | "integrations"
  | "beforeSend"
>

/**
 * What the SDKs of all three targets collect beside the error and its stack: no user, cookies, headers, bodies,
 * query parameters or variable values. The defaults of SDK 11 collect each of them.
 */
export const minimalDataCollection: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
}

/** The SDK options of the Worker and the Bun server; null without a DSN, so the target starts no SDK and sends nothing. */
export function sentryOptions(config: ErrorReportingConfig): SentryOptions | null {
  if (config.sentryDsn === null) return null
  return {
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    ...(config.sentryRelease === null ? {} : { release: config.sentryRelease }),
    sampleRate: config.sentrySamplePercent / 100,
    tracesSampleRate: 0,
    dataCollection: minimalDataCollection,
    // The console integration turns every log call into a breadcrumb; see `scrubEvent`.
    integrations: (defaults) => defaults.filter(({ name }) => name !== "Console"),
    beforeSend: (event: ErrorEvent, hint: EventHint) =>
      isExpectedServerError(hint) ? null : withoutMessages(scrubEvent(event)),
  }
}

// A server error's message can quote a login, a display name or a platform id from the data it failed on, as the
// logs' `errorClass` rule assumes; the report keeps the class and the stack, which find the place, without it.
function withoutMessages(event: ErrorEvent): ErrorEvent {
  delete event.message
  for (const exception of event.exception?.values ?? []) delete exception.value
  return event
}

// A platform 429 is retried by the caller that threw it: the queue backs off and the room checks again.
function isExpectedServerError(hint: EventHint): boolean {
  return hint.originalException instanceof PlatformRateLimited
}

const filtered = "[Filtered]"

/**
 * Removes what an error report must never carry: cookies, the `Authorization` header, request bodies (a winner's
 * form answers, OAuth codes), OAuth `code` and `state` parameters, secrets in a path or a fragment, and platform
 * tokens in any text or field.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request !== undefined) scrubRequest(event.request)
  if (event.message !== undefined) event.message = scrubMessage(event.message)
  if (event.transaction !== undefined) event.transaction = scrubText(event.transaction)
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = scrubMessage(exception.value)
  }
  // A console breadcrumb holds the arguments of a log call, which can be an error with a login in its message.
  if (event.breadcrumbs !== undefined) {
    event.breadcrumbs = event.breadcrumbs.filter(({ category }) => category !== "console")
    for (const breadcrumb of event.breadcrumbs) scrubBreadcrumb(breadcrumb)
  }
  if (event.extra !== undefined) scrubRecord(event.extra)
  for (const context of Object.values(event.contexts ?? {})) {
    if (context !== undefined) scrubRecord(context)
  }
  return event
}

function scrubRequest(request: RequestEventData): void {
  delete request.cookies
  delete request.data
  if (request.url !== undefined) request.url = scrubText(request.url)
  if (request.headers !== undefined) {
    for (const [name, value] of Object.entries(request.headers)) {
      if (isSensitiveKey(name)) delete request.headers[name]
      else request.headers[name] = scrubText(value)
    }
  }
  const query = request.query_string
  if (typeof query === "string") request.query_string = scrubText(query)
  else if (Array.isArray(query)) {
    request.query_string = query.map(([name, value]) => [
      name,
      isSensitiveKey(name) ? filtered : value,
    ])
  } else if (query !== undefined) scrubRecord(query)
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): void {
  if (breadcrumb.message !== undefined) breadcrumb.message = scrubMessage(breadcrumb.message)
  if (breadcrumb.data !== undefined) scrubRecord(breadcrumb.data)
}

function scrubRecord(record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    record[key] = isSensitiveKey(key) ? filtered : scrubValue(value)
  }
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value)
  if (Array.isArray(value)) return value.map(scrubValue)
  if (isRecord(value)) scrubRecord(value)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// The one list of secret names, for fields and headers and for `name=value` in any text. `code` and `state` are the
// OAuth callback's parameters, `ticket` a queued entry's; the rest name credentials, cookies and winner form answers.
function isSensitiveKey(key: string): boolean {
  const name = key.toLowerCase()
  return (
    name === "code"
    || name === "state"
    || name === "ticket"
    || /cookie|authori[sz]ation|token|secret|pass|signature|api[-_]?key|answer/.test(name)
  )
}

// One segment of a path in a URL or a log line.
const segment = String.raw`[^/?#\s"']+`

/**
 * Paths whose segment is a secret, from the routes of the page and of the API: the overlay's token
 * (`/overlay/<id>/<token>`, `/api/overlay/<id>/<token>/theme`) and a queued entry's ticket
 * (`/api/g/<code>/pending/<ticket>`). A new route with a secret in its path is added here.
 */
const secretPathSegments = [
  new RegExp(String.raw`(/overlay/${segment}/)${segment}`, "g"),
  new RegExp(String.raw`(/pending/)${segment}`, "g"),
]

// The Twitch validate endpoint takes `OAuth <token>`, the other APIs `Bearer <token>`. A moderator link carries
// its token after `#` (`/mod#<token>`), so every fragment of a path goes.
function scrubText(text: string): string {
  let scrubbed = text
    .replace(/\b(Bearer|Basic|OAuth)\s+[^\s"',;]+/gi, `$1 ${filtered}`)
    .replace(/((?:^|[?&\s])([^=&#?\s"']+)=)([^&#\s"']*)/g, (whole, prefix: string, name: string) =>
      isSensitiveKey(name) ? `${prefix}${filtered}` : whole,
    )
    .replace(/(\/[^\s"'#]*)#[^\s"']+/g, `$1#${filtered}`)
  for (const pattern of secretPathSegments) scrubbed = scrubbed.replace(pattern, `$1${filtered}`)
  return scrubbed
}

// Error messages are untrusted text: a JWT, or a run of 24 or more token characters with a digit and a letter,
// goes too. Stack frames and the release are other fields, so this never touches them.
function scrubMessage(text: string): string {
  return scrubText(text)
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, filtered)
    .replace(/[\w+=-]{24,}/g, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? filtered : run))
}
