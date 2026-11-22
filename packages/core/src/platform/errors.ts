/**
 * A platform call that did not give an answer. The subclass tells the caller what to do: queue and retry
 * later (`PlatformRateLimited`, `PlatformUnavailable`) or give up (`PlatformInvalid`).
 */
export abstract class PlatformError extends Error {
  constructor(
    message: string,
    /** The platform's name for the call that failed, for logs. */
    readonly endpoint: string,
    /** HTTP status of the answer, `null` when there was none (network, timeout, identity check). */
    readonly status: number | null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

/** The platform answered 429. */
export class PlatformRateLimited extends PlatformError {}

/** The platform answered 5xx or an undocumented body, or the call timed out or failed on the network. */
export class PlatformUnavailable extends PlatformError {}

/** The platform rejected the request (4xx other than 429). */
export class PlatformInvalid extends PlatformError {
  /** The platform's own error message, `null` when the body had none. */
  readonly reason: string | null

  constructor(
    message: string,
    endpoint: string,
    status: number | null,
    options?: ErrorOptions & { readonly reason?: string | null },
  ) {
    super(message, endpoint, status, options)
    this.reason = options?.reason ?? null
  }
}

/** The sign-in did not prove who the user is: no identity in the token answer, or one that failed verification. */
export class PlatformIdentityRejected extends PlatformInvalid {}
