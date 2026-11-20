import type { Context } from "hono"
import { takeFailure, type FailableEndpoint, type FailureStatus, type FakeState } from "../state.ts"

export type HelixErrorStatus = 400 | 401 | 403 | 404 | FailureStatus

const STATUS_TEXT: Record<HelixErrorStatus, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
}

export function helixError(c: Context, status: HelixErrorStatus, message: string) {
  return c.json({ error: STATUS_TEXT[status], status, message }, status)
}

/** Answers with the next scripted failure for `endpoint`, if `control.failNext` queued one. */
export function scriptedHelixFailure(c: Context, state: FakeState, endpoint: FailableEndpoint) {
  const status = takeFailure(state, endpoint)
  return status === undefined ? undefined : helixError(c, status, STATUS_TEXT[status])
}
