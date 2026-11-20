/** Outcome of parsing untrusted input at a trust boundary. */
export type Parsed<T, Issue> = { ok: true; value: T } | { ok: false; issue: Issue }
