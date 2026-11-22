import { PlatformInvalid, PlatformRateLimited, PlatformUnavailable } from "../platform/errors.ts"

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

/** Twitch answered 429. */
export class TwitchRateLimited extends PlatformRateLimited {
  declare readonly endpoint: TwitchEndpoint

  constructor(endpoint: TwitchEndpoint, options?: ErrorOptions) {
    super("Twitch rate limited the request", endpoint, 429, options)
  }
}

/** Twitch answered 5xx or a body that does not match its documentation, or the call timed out or failed on the network. */
export class TwitchUnavailable extends PlatformUnavailable {
  declare readonly endpoint: TwitchEndpoint

  constructor(endpoint: TwitchEndpoint, status: number | null, options?: ErrorOptions) {
    super("Twitch is unavailable", endpoint, status, options)
  }
}

/** Twitch rejected the request (4xx other than 429), or the id_token failed verification. */
export class TwitchInvalid extends PlatformInvalid {
  declare readonly endpoint: TwitchEndpoint

  constructor(
    endpoint: TwitchEndpoint,
    status: number | null,
    options?: ErrorOptions & { readonly reason?: string | null },
  ) {
    super("Twitch rejected the request", endpoint, status, options)
  }
}
