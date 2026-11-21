import { setTimeout } from "node:timers/promises"
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTPayload } from "jose"
import type { ResolvedConfig } from "../config.ts"
import type { Group } from "../domain/groups.ts"
import type { Parsed } from "../lib/parsed.ts"
import {
  TwitchInvalid,
  TwitchRateLimited,
  TwitchUnavailable,
  type TwitchEndpoint,
} from "./errors.ts"
import {
  parseFollowed,
  parseAppToken,
  parseRolePage,
  parseSubscriberBadgeImages,
  parseSubscriptionCreated,
  parseTier,
  parseTokenResponse,
  parseUserLogins,
  parseUserProfile,
  parseValidated,
  type ExchangedCode,
  type Tier,
  type UserProfile,
} from "./lib/parse-response.ts"

export { TwitchError, TwitchInvalid, TwitchRateLimited, TwitchUnavailable } from "./errors.ts"
export type { TwitchEndpoint } from "./errors.ts"
export type { ExchangedCode, UserProfile } from "./lib/parse-response.ts"

/** The `fetch` the client sends every call through; the global `fetch` fits. */
export type TwitchFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type SubscriptionGroup = Extract<Group, "sub_t1" | "sub_t2" | "sub_t3">

export interface AuthorizeParams {
  readonly state: string
  readonly nonce: string
  readonly scopes: readonly [string, ...string[]]
  readonly redirectUri: string
  /** Makes Twitch show its account picker even when the browser is signed in; off when absent. */
  readonly forceVerify?: boolean
}

/** The user an `id_token` was issued for, as Twitch's `sub` claim. */
export interface VerifiedIdToken {
  readonly userId: string
}

/** User ids holding each role on a channel. */
export interface ChannelRoles {
  readonly vips: readonly string[]
  readonly moderators: readonly string[]
}

/**
 * Answer of the hourly token check. `invalid` is only a 401; any other failure is `unavailable`, so a
 * caller keeps the token (spec AC-22).
 */
export type TokenValidation =
  | { readonly status: "valid"; readonly userId: string }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" }

export class TwitchClient {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>
  private appToken: { readonly accessToken: string; readonly expiresAt: number } | null = null
  private appTokenGrant: Promise<string> | null = null

  constructor(
    private readonly config: ResolvedConfig,
    private readonly fetchImpl: TwitchFetch,
  ) {
    this.jwks = createRemoteJWKSet(new URL("/oauth2/keys", config.twitchIdBaseUrl), {
      timeoutDuration: config.twitchTimeoutMs,
      [customFetch]: (url, options) => this.fetchJwks(url, options),
    })
  }

  authorizeUrl(params: AuthorizeParams): string {
    const url = new URL("/oauth2/authorize", this.config.twitchIdBaseUrl)
    url.searchParams.set("client_id", this.config.twitchClientId)
    url.searchParams.set("redirect_uri", params.redirectUri)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", params.scopes.join(" "))
    url.searchParams.set("state", params.state)
    url.searchParams.set("nonce", params.nonce)
    if (params.forceVerify === true) url.searchParams.set("force_verify", "true")
    return url.toString()
  }

  /** Not retried: a code is single use, so the caller queues the code instead. */
  async exchangeCode(code: string, redirectUri: string): Promise<ExchangedCode> {
    return this.tokenRequest(
      { code, grant_type: "authorization_code", redirect_uri: redirectUri },
      parseTokenResponse,
    )
  }

  /** The answer's refresh token may differ from the one sent: the caller stores it in its place. */
  async refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    return this.tokenRequest(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      parseTokenResponse,
    )
  }

  /**
   * An app access token (client credentials grant); needs no user, so it serves lookups the app makes on its own.
   * The token is kept until a tenth of its lifetime is left, and callers at once share one grant.
   */
  async appAccessToken(): Promise<string> {
    if (this.appToken !== null && Date.now() < this.appToken.expiresAt) {
      return this.appToken.accessToken
    }
    this.appTokenGrant ??= this.grantAppToken().finally(() => {
      this.appTokenGrant = null
    })
    return this.appTokenGrant
  }

  async verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdToken> {
    const payload = await this.verifiedPayload(idToken)
    if (payload.nonce !== expectedNonce || payload.sub === undefined) {
      throw new TwitchInvalid("id-token", null)
    }
    return { userId: payload.sub }
  }

  /** The tier group of the viewer's subscription, `null` when not subscribed. */
  async subscriptionTier(
    accessToken: string,
    broadcasterId: string,
    userId: string,
  ): Promise<SubscriptionGroup | null> {
    let tier: Tier
    try {
      tier = await this.helix(
        "subscriptions",
        "/helix/subscriptions/user",
        { broadcaster_id: broadcasterId, user_id: userId },
        accessToken,
        parseTier,
      )
    } catch (error) {
      if (error instanceof TwitchInvalid && error.status === 404) return null
      throw error
    }
    return tierGroups[tier]
  }

  async follows(accessToken: string, broadcasterId: string, userId: string): Promise<boolean> {
    return this.helix(
      "followed",
      "/helix/channels/followed",
      { broadcaster_id: broadcasterId, user_id: userId },
      accessToken,
      parseFollowed,
    )
  }

  /** Login, display name and creation time of the account the token belongs to. */
  async userProfile(accessToken: string): Promise<UserProfile> {
    return this.helix("users", "/helix/users", {}, accessToken, parseUserProfile)
  }

  /** The badge image of each subscription tier in the channel's own badge set (an app token is enough); `null` for a tier the channel set no badge for. */
  async channelSubscriberBadges(
    appToken: string,
    broadcasterId: string,
  ): Promise<Readonly<Record<SubscriptionGroup, string | null>>> {
    const images = await this.helix(
      "badges",
      "/helix/chat/badges",
      { broadcaster_id: broadcasterId },
      appToken,
      parseSubscriberBadgeImages,
    )
    return {
      sub_t1: images.get(baseBadgeVersions.sub_t1) ?? null,
      sub_t2: images.get(baseBadgeVersions.sub_t2) ?? null,
      sub_t3: images.get(baseBadgeVersions.sub_t3) ?? null,
    }
  }

  /** The subscriber badge every channel without its own set shows; `null` when Twitch lists none. */
  async globalSubscriberBadge(appToken: string): Promise<string | null> {
    const images = await this.helix(
      "badges",
      "/helix/chat/badges/global",
      {},
      appToken,
      parseSubscriberBadgeImages,
    )
    return images.get(globalBadgeVersion) ?? null
  }

  /** Login to user id of the accounts that exist; Twitch answers 100 logins per call, so a longer list is sent in chunks. A login without an account is absent from the result. */
  async userIdsByLogin(
    appToken: string,
    logins: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = new Map<string, string>()
    for (let from = 0; from < logins.length; from += helixMaxPageSize) {
      const users = await this.helix(
        "users",
        "/helix/users",
        { login: logins.slice(from, from + helixMaxPageSize) },
        appToken,
        parseUserLogins,
      )
      for (const user of users) ids.set(user.login.toLowerCase(), user.id)
    }
    return ids
  }

  /** Needs the streamer's token with `channel:read:vips` and `moderation:read`. */
  async channelRoles(accessToken: string, broadcasterId: string): Promise<ChannelRoles> {
    const [vips, moderators] = await Promise.all([
      this.roleHolders("vips", "/helix/channels/vips", accessToken, broadcasterId),
      this.roleHolders("moderators", "/helix/moderation/moderators", accessToken, broadcasterId),
    ])
    return { vips, moderators }
  }

  /**
   * Subscribes the WebSocket session to the channel's chat messages. Needs the streamer's token with
   * `user:read:chat`; the streamer is both the channel and the reading user.
   */
  async subscribeChatMessages(
    accessToken: string,
    broadcasterId: string,
    sessionId: string,
  ): Promise<void> {
    await this.helix(
      "eventsub",
      "/helix/eventsub/subscriptions",
      {},
      accessToken,
      parseSubscriptionCreated,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: { broadcaster_user_id: broadcasterId, user_id: broadcasterId },
          transport: { method: "websocket", session_id: sessionId },
        }),
      },
    )
  }

  /** Never throws for an answer: only a 401 is `invalid`. */
  async validate(accessToken: string): Promise<TokenValidation> {
    let response: Response
    try {
      response = await this.send(
        "validate",
        new URL("/oauth2/validate", this.config.twitchIdBaseUrl),
        { headers: { Authorization: `OAuth ${accessToken}` } },
      )
    } catch (error) {
      if (error instanceof TwitchUnavailable) return { status: "unavailable" }
      throw error
    }
    if (response.status === 401) return { status: "invalid" }
    if (!response.ok) return { status: "unavailable" }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { status: "unavailable" }
    }
    const validated = parseValidated(body)
    return validated.ok
      ? { status: "valid", userId: validated.value.userId }
      : { status: "unavailable" }
  }

  private async grantAppToken(): Promise<string> {
    const startedAt = Date.now()
    const grant = await this.tokenRequest({ grant_type: "client_credentials" }, parseAppToken)
    this.appToken = {
      accessToken: grant.accessToken,
      expiresAt: startedAt + grant.expiresInSeconds * appTokenUsableShare * 1000,
    }
    return grant.accessToken
  }

  private async tokenRequest<T>(
    params: Record<string, string>,
    parse: (body: unknown) => Parsed<T, "malformed">,
  ): Promise<T> {
    const response = await this.send(
      "token",
      new URL("/oauth2/token", this.config.twitchIdBaseUrl),
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: this.config.twitchClientId,
          client_secret: this.config.twitchClientSecret,
          ...params,
        }),
      },
    )
    return this.read("token", response, parse)
  }

  private async verifiedPayload(idToken: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: idTokenIssuer,
        audience: this.config.twitchClientId,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "sub", "nonce"],
      })
      return payload
    } catch (cause) {
      throw translateJoseError(cause)
    }
  }

  private async roleHolders(
    endpoint: "vips" | "moderators",
    path: string,
    accessToken: string,
    broadcasterId: string,
  ): Promise<readonly string[]> {
    const userIds: string[] = []
    let cursor: string | null = null
    do {
      const query: Record<string, string> = {
        broadcaster_id: broadcasterId,
        first: String(helixMaxPageSize),
      }
      if (cursor !== null) query.after = cursor
      const page = await this.helix(endpoint, path, query, accessToken, parseRolePage)
      userIds.push(...page.userIds)
      if (page.cursor !== null && page.cursor === cursor) {
        throw new TwitchUnavailable(endpoint, 200)
      }
      cursor = page.cursor
    } while (cursor !== null)
    return userIds
  }

  /** One Helix call, a GET unless `request` says otherwise; a 503 is retried once after `helixRetryDelayMs`, nothing else is retried. */
  private async helix<T>(
    endpoint: TwitchEndpoint,
    path: string,
    query: Readonly<Record<string, string | readonly string[]>>,
    accessToken: string,
    parse: (body: unknown) => Parsed<T, "malformed">,
    request: RequestInit = {},
  ): Promise<T> {
    const url = new URL(path, this.config.twitchHelixBaseUrl)
    for (const [name, value] of Object.entries(query)) {
      for (const item of typeof value === "string" ? [value] : value) {
        url.searchParams.append(name, item)
      }
    }
    const init: RequestInit = {
      ...request,
      headers: {
        ...request.headers,
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.config.twitchClientId,
      },
    }
    let response = await this.send(endpoint, url, init)
    if (response.status === 503) {
      await response.body?.cancel()
      await setTimeout(this.config.helixRetryDelayMs)
      response = await this.send(endpoint, url, init)
    }
    return this.read(endpoint, response, parse)
  }

  private async send(endpoint: TwitchEndpoint, url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.twitchTimeoutMs),
      })
    } catch (cause) {
      throw new TwitchUnavailable(endpoint, null, { cause })
    }
  }

  private async read<T>(
    endpoint: TwitchEndpoint,
    response: Response,
    parse: (body: unknown) => Parsed<T, "malformed">,
  ): Promise<T> {
    if (response.status === 429) throw new TwitchRateLimited(endpoint)
    if (response.status >= 500) throw new TwitchUnavailable(endpoint, response.status)
    if (!response.ok) {
      throw new TwitchInvalid(endpoint, response.status, { reason: await errorReason(response) })
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new TwitchUnavailable(endpoint, response.status, { cause })
    }
    const parsed = parse(body)
    if (!parsed.ok) throw new TwitchUnavailable(endpoint, response.status)
    return parsed.value
  }

  /** jose passes a network rejection through as a non-jose error; a `JOSEError` keeps it classifiable. */
  private async fetchJwks(url: string, options: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, options)
    } catch (cause) {
      throw new errors.JOSEError("Failed to fetch the JSON Web Key Set", { cause })
    }
  }
}

/** The `iss` of every Twitch `id_token`, whichever origin serves the keys. */
const idTokenIssuer = "https://id.twitch.tv/oauth2"

/** Twitch caps `first` at 100 on its paginated endpoints. */
const helixMaxPageSize = 100

// Twitch names the first badge version of a tier by the tier: "0" for tier 1, "2000" and "3000" above it; later versions count months.
const baseBadgeVersions: Readonly<Record<SubscriptionGroup, string>> = {
  sub_t1: "0",
  sub_t2: "2000",
  sub_t3: "3000",
}

const globalBadgeVersion = "0"

/** The part of an app token's lifetime it is used for, so a call that is slow to start does not meet it expired. */
const appTokenUsableShare = 0.9

const tierGroups: Readonly<Record<Tier, SubscriptionGroup>> = {
  "1000": "sub_t1",
  "2000": "sub_t2",
  "3000": "sub_t3",
}

/**
 * A bare `JOSEError` is a JWKS fetch that failed or answered badly, so Twitch is at fault; every other
 * jose error blames the token. A non-jose error is a bug and propagates.
 */
function translateJoseError(error: unknown): TwitchInvalid | TwitchUnavailable {
  if (!(error instanceof errors.JOSEError)) throw error
  if (
    error instanceof errors.JWKSTimeout
    || error instanceof errors.JWKSInvalid
    || error.code === errors.JOSEError.code
  ) {
    return new TwitchUnavailable("id-token", null, { cause: error })
  }
  return new TwitchInvalid("id-token", null, { cause: error })
}

/** Twitch error bodies are `{status, message}`; anything else gives no reason. */
async function errorReason(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (typeof body === "object" && body !== null && "message" in body) {
      return typeof body.message === "string" ? body.message : null
    }
  } catch {
    // An empty or non-JSON error body has no reason to report.
  }
  return null
}
