import { PlatformInvalid, PlatformRateLimited, PlatformUnavailable } from "../platform/errors.ts"

export type KickEndpoint =
  | "token"
  | "users"
  | "channels"
  | "subscribe"
  | "unsubscribe"
  | "public-key"

/** Kick answered 429. */
export class KickRateLimited extends PlatformRateLimited {
  declare readonly endpoint: KickEndpoint

  constructor(endpoint: KickEndpoint, options?: ErrorOptions) {
    super("Kick rate limited the request", endpoint, 429, options)
  }
}

/** Kick answered 5xx or a body that does not match its documentation, or the call timed out or failed on the network. */
export class KickUnavailable extends PlatformUnavailable {
  declare readonly endpoint: KickEndpoint

  constructor(endpoint: KickEndpoint, status: number | null, options?: ErrorOptions) {
    super("Kick is unavailable", endpoint, status, options)
  }
}

/** Kick rejected the request (4xx other than 429). */
export class KickInvalid extends PlatformInvalid {
  declare readonly endpoint: KickEndpoint

  constructor(
    endpoint: KickEndpoint,
    status: number | null,
    options?: ErrorOptions & { readonly reason?: string | null },
  ) {
    super("Kick rejected the request", endpoint, status, options)
  }
}
