import { setTimeout as sleep } from "node:timers/promises"
import { errorClass } from "../../packages/core/src/lib/error-class.ts"
import { LocalBrowser, RedirectMissing } from "./local-browser.ts"
import { NonLocalUrlError } from "./local-host.ts"

export interface ViewerContext {
  readonly target: URL
  readonly code: string
  /** How the page polls a queued entry; read from the giveaway page. */
  readonly poll: { readonly intervalMs: number; readonly maxMs: number }
}

/** One sign-in of one viewer. Outcomes are the `entry` kinds the callback redirects with, plus `http-<status>` and `error-<class>`. */
export interface Attempt {
  readonly userId: string
  /** The callback's outcome, before any polling. */
  readonly callback: string
  /** The outcome the viewer ends with: the callback's, or the last poll's for a queued one. */
  readonly final: string
  /** `performance.now()` when the callback answered, or when the sign-in failed. */
  readonly answeredAt: number
  /** Start of the sign-in until the callback answered. */
  readonly signInMs: number
  /** The callback request alone. */
  readonly callbackMs: number
  /** Start of the sign-in until the final outcome; null when the viewer was not queued. */
  readonly queuedMs: number | null
  /** Answers with status 429 this viewer saw from the target. */
  readonly rateLimited: number
  /** Polls of a queued entry that failed; the page polls again after a failed one, so does the viewer. */
  readonly pollErrors: number
}

export async function signInViewer(context: ViewerContext, userId: string): Promise<Attempt> {
  const browser = new LocalBrowser(context.target)
  const began = performance.now()
  let rateLimited = 0
  let signInMs = 0
  let callbackMs = 0
  let answered = 0
  let callbackOutcome: string | null = null
  try {
    const callbackPath = await browser.signInUntilCallback(
      `/auth/twitch/viewer/start?giveaway=${context.code}`,
      userId,
    )
    const callbackBegan = performance.now()
    const callback = await browser.get(callbackPath)
    answered = performance.now()
    callbackMs = answered - callbackBegan
    signInMs = answered - began
    const redirect = browser.locationOf(callback).searchParams
    const outcome = redirect.get("entry") ?? "no-entry"
    callbackOutcome = outcome
    const ticket = redirect.get("ticket")
    if (outcome !== "pending" || ticket === null) {
      return {
        userId,
        callback: outcome,
        final: outcome,
        answeredAt: answered,
        signInMs,
        callbackMs,
        queuedMs: null,
        rateLimited,
        pollErrors: 0,
      }
    }
    const polled = await pollUntilFinal(browser, context, ticket, began)
    return {
      userId,
      callback: outcome,
      final: polled.final,
      answeredAt: answered,
      signInMs,
      callbackMs,
      queuedMs: performance.now() - began,
      rateLimited: polled.rateLimited,
      pollErrors: polled.errors,
    }
  } catch (error) {
    if (error instanceof NonLocalUrlError) throw error
    const failure =
      error instanceof RedirectMissing ? `http-${error.status}` : `error-${failureName(error)}`
    if (error instanceof RedirectMissing && error.status === 429) rateLimited += 1
    return {
      userId,
      callback: callbackOutcome ?? failure,
      final: failure,
      answeredAt: answered === 0 ? performance.now() : answered,
      signInMs: signInMs === 0 ? performance.now() - began : signInMs,
      callbackMs,
      queuedMs: null,
      rateLimited,
      pollErrors: 0,
    }
  }
}

/** The error's class and, for a network failure, the code Bun reports for it (`ConnectionRefused`, `ECONNRESET`). */
function failureName(error: unknown): string {
  const code = error instanceof Error && "code" in error ? error.code : undefined
  return typeof code === "string" ? `${errorClass(error)}-${code}` : errorClass(error)
}

/** Polls the ticket the way the page does: every `intervalMs` until a final outcome or `maxMs` after the sign-in began. */
async function pollUntilFinal(
  browser: LocalBrowser,
  context: ViewerContext,
  ticket: string,
  began: number,
): Promise<{ final: string; rateLimited: number; errors: number }> {
  let rateLimited = 0
  let errors = 0
  while (performance.now() - began < context.poll.maxMs) {
    await sleep(context.poll.intervalMs)
    try {
      const polled = await browser.get(`/api/g/${context.code}/pending/${ticket}`)
      if (polled.status === 429) rateLimited += 1
      const body: { kind: string } = await polled.json()
      if (body.kind !== "pending") return { final: body.kind, rateLimited, errors }
    } catch (error) {
      if (error instanceof NonLocalUrlError) throw error
      errors += 1
    }
  }
  return { final: "pending-timeout", rateLimited, errors }
}
