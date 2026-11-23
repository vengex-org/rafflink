import type { ResolvedConfig } from "../config.ts"
import type { Parsed } from "../lib/parsed.ts"
import type { AuthorizeParams, ExchangedCode } from "../platform/provider.ts"
import type { Clock } from "../ports.ts"
import {
  YouTubeInvalid,
  YouTubeQuotaExhausted,
  YouTubeRateLimited,
  YouTubeUnavailable,
  type YouTubeEndpoint,
} from "./errors.ts"
import {
  errorReasonOf,
  parseChannels,
  parseChatPage,
  parseGoogleTokens,
  parseLiveChatIds,
  parseTokenInfo,
  type GoogleTokens,
  type YouTubeChannel,
  type YouTubeChatPage,
} from "./lib/parse-response.ts"
import { youtubeUnits, type YouTubeQuota } from "./quota.ts"

/** The `fetch` the client sends every call through; the global `fetch` fits. */
export type YouTubeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** A Google OAuth web client: `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`, which resolveConfig sets together. */
export interface YouTubeApp {
  readonly clientId: string
  readonly clientSecret: string
}

export type YouTubeClientConfig = Pick<
  ResolvedConfig,
  "youtubeAuthBaseUrl" | "youtubeTokenBaseUrl" | "youtubeApiBaseUrl" | "youtubeTimeoutMs"
>

/** The Google client of the config, `null` when this install has none. */
export function youtubeAppOf(
  config: Pick<ResolvedConfig, "youtubeClientId" | "youtubeClientSecret">,
): YouTubeApp | null {
  const { youtubeClientId: clientId, youtubeClientSecret: clientSecret } = config
  return clientId === null || clientSecret === null ? null : { clientId, clientSecret }
}

/**
 * Google OAuth (`accounts.google.com`, `oauth2.googleapis.com`) and the YouTube Data API v3. Every API call
 * spends its units in the quota first and is not sent when the day's cap would be passed.
 */
export class YouTubeClient {
  constructor(
    private readonly app: YouTubeApp,
    private readonly config: YouTubeClientConfig,
    private readonly quota: YouTubeQuota,
    private readonly clock: Clock,
    private readonly fetchImpl: YouTubeFetch,
  ) {}

  /**
   * Google's consent page with PKCE. `access_type=offline` with `prompt=consent` makes Google answer a
   * refresh token on every sign-in, and `select_account` shows the account and channel picker, so a
   * streamer with several channels picks the one the token is for.
   */
  authorizeUrl(params: Omit<AuthorizeParams, "nonce" | "forceVerify">): string {
    const url = new URL("/o/oauth2/v2/auth", this.config.youtubeAuthBaseUrl)
    url.searchParams.set("client_id", this.app.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", params.redirectUri)
    url.searchParams.set("state", params.state)
    url.searchParams.set("scope", params.scopes.join(" "))
    url.searchParams.set("code_challenge", params.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "select_account consent")
    url.searchParams.set("include_granted_scopes", "false")
    return url.toString()
  }

  /** Not retried: a code is single use. Google answers a refresh token here because the consent was forced. */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<ExchangedCode> {
    const tokens = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
    if (tokens.refreshToken === null) throw new YouTubeUnavailable("token", 200)
    return { ...tokens, refreshToken: tokens.refreshToken, idToken: null }
  }

  /** Google keeps the refresh token on a refresh and answers none, so the one sent is returned. */
  async refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    const tokens = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken, idToken: null }
  }

  /** Whether Google still knows the access token and issued it to this client; costs no quota. */
  async tokenAudience(accessToken: string): Promise<string> {
    const url = new URL("/tokeninfo", this.config.youtubeTokenBaseUrl)
    url.searchParams.set("access_token", accessToken)
    return this.read("tokeninfo", await this.send("tokeninfo", url, {}), parseTokenInfo)
  }

  /** The channels the token's account signed in as; one, or none for an account without a channel. */
  async myChannels(accessToken: string): Promise<readonly YouTubeChannel[]> {
    return this.api(
      "channels",
      youtubeUnits.channels,
      "/youtube/v3/channels",
      { part: "id,snippet", mine: "true" },
      accessToken,
      parseChannels,
    )
  }

  /** The live chat of the token's channel's active broadcast, `null` while the channel is not live. */
  async activeLiveChatId(accessToken: string): Promise<string | null> {
    const ids = await this.api(
      "live-broadcasts",
      youtubeUnits.liveBroadcasts,
      "/youtube/v3/liveBroadcasts",
      { part: "snippet", broadcastStatus: "active", broadcastType: "all" },
      accessToken,
      parseLiveChatIds,
    )
    return ids[0] ?? null
  }

  /** One page of a live chat, from the start of what YouTube keeps when `pageToken` is null. */
  async chatPage(
    accessToken: string,
    liveChatId: string,
    pageToken: string | null,
  ): Promise<YouTubeChatPage> {
    return this.api(
      "live-chat-messages",
      youtubeUnits.liveChatMessages,
      "/youtube/v3/liveChat/messages",
      {
        liveChatId,
        part: "snippet,authorDetails",
        ...(pageToken === null ? {} : { pageToken }),
      },
      accessToken,
      parseChatPage,
    )
  }

  private async tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
    const response = await this.send("token", new URL("/token", this.config.youtubeTokenBaseUrl), {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.app.clientId,
        client_secret: this.app.clientSecret,
        ...params,
      }),
    })
    return this.read("token", response, parseGoogleTokens)
  }

  private async api<T>(
    endpoint: YouTubeEndpoint,
    units: number,
    path: string,
    query: Readonly<Record<string, string>>,
    accessToken: string,
    parse: (body: unknown) => Parsed<T, "malformed">,
  ): Promise<T> {
    if (!(await this.quota.spend(units, this.clock.now()))) {
      throw new YouTubeQuotaExhausted(endpoint)
    }
    const url = new URL(path, this.config.youtubeApiBaseUrl)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    const response = await this.send(endpoint, url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return this.read(endpoint, response, parse)
  }

  private async send(endpoint: YouTubeEndpoint, url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.youtubeTimeoutMs),
      })
    } catch (cause) {
      throw new YouTubeUnavailable(endpoint, null, { cause })
    }
  }

  private async read<T>(
    endpoint: YouTubeEndpoint,
    response: Response,
    parse: (body: unknown) => Parsed<T, "malformed">,
  ): Promise<T> {
    if (response.status === 429) throw new YouTubeRateLimited(endpoint)
    if (response.status >= 500) throw new YouTubeUnavailable(endpoint, response.status)
    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      if (!response.ok) throw new YouTubeInvalid(endpoint, response.status, { cause })
      throw new YouTubeUnavailable(endpoint, response.status, { cause })
    }
    if (!response.ok) {
      throw new YouTubeInvalid(endpoint, response.status, { reason: errorReasonOf(body) })
    }
    const parsed = parse(body)
    if (!parsed.ok) throw new YouTubeUnavailable(endpoint, response.status)
    return parsed.value
  }
}
