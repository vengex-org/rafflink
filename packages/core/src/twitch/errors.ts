export type TwitchEndpoint =
  | "token"
  | "id-token"
  | "validate"
  | "subscriptions"
  | "followed"
  | "users"
  | "vips"
  | "moderators"
  | "badges"
  | "eventsub"

/**
 * A Twitch call that did not give an answer. The subclass tells the caller what to do: queue and retry
 * later (`TwitchRateLimited`, `TwitchUnavailable`) or give up (`TwitchInvalid`).
 */
export abstract class TwitchError extends Error {
  constructor(
    message: string,
    readonly endpoint: TwitchEndpoint,
    /** HTTP status of the answer, `null` when there was none (network, timeout, id_token). */
    readonly status: number | null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

/** Twitch answered 429. */
export class TwitchRateLimited extends TwitchError {
  constructor(endpoint: TwitchEndpoint, options?: ErrorOptions) {
    super("Twitch rate limited the request", endpoint, 429, options)
  }
}

/** Twitch answered 5xx or a body that does not match its documentation, or the call timed out or failed on the network. */
export class TwitchUnavailable extends TwitchError {
  constructor(endpoint: TwitchEndpoint, status: number | null, options?: ErrorOptions) {
    super("Twitch is unavailable", endpoint, status, options)
  }
}

/** Twitch rejected the request (4xx other than 429), or the id_token failed verification. */
export class TwitchInvalid extends TwitchError {
  /** The `message` field of Twitch's error body, `null` when the body had none. */
  readonly reason: string | null

  constructor(
    endpoint: TwitchEndpoint,
    status: number | null,
    options?: ErrorOptions & { readonly reason?: string | null },
  ) {
    super("Twitch rejected the request", endpoint, status, options)
    this.reason = options?.reason ?? null
  }
}
