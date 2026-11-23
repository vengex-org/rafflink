import { PlatformInvalid, PlatformRateLimited, PlatformUnavailable } from "../platform/errors.ts"

export type YouTubeEndpoint =
  | "token"
  | "tokeninfo"
  | "channels"
  | "live-broadcasts"
  | "live-chat-messages"

/** Google answered 429. */
export class YouTubeRateLimited extends PlatformRateLimited {
  declare readonly endpoint: YouTubeEndpoint

  constructor(endpoint: YouTubeEndpoint, options?: ErrorOptions) {
    super("YouTube rate limited the request", endpoint, 429, options)
  }
}

/** Google answered 5xx or a body that does not match its documentation, or the call timed out or failed on the network. */
export class YouTubeUnavailable extends PlatformUnavailable {
  declare readonly endpoint: YouTubeEndpoint

  constructor(endpoint: YouTubeEndpoint, status: number | null, options?: ErrorOptions) {
    super("YouTube is unavailable", endpoint, status, options)
  }
}

/**
 * Google rejected the request (4xx other than 429). `reason` is the OAuth `error` code (`invalid_grant`) or
 * the first reason of a YouTube API error (`liveChatEnded`, `quotaExceeded`).
 */
export class YouTubeInvalid extends PlatformInvalid {
  declare readonly endpoint: YouTubeEndpoint

  constructor(
    endpoint: YouTubeEndpoint,
    status: number | null,
    options?: ErrorOptions & { readonly reason?: string | null },
  ) {
    super("YouTube rejected the request", endpoint, status, options)
  }
}

/** The call would spend more of today's units than YOUTUBE_DAILY_QUOTA_UNITS leaves, so it was not sent. */
export class YouTubeQuotaExhausted extends PlatformUnavailable {
  declare readonly endpoint: YouTubeEndpoint

  constructor(endpoint: YouTubeEndpoint) {
    super("YouTube daily quota of the install is spent", endpoint, null)
  }
}
