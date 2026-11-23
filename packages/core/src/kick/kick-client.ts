import type { ResolvedConfig } from "../config.ts"
import type { Parsed } from "../lib/parsed.ts"
import type { AuthorizeParams, ExchangedCode } from "../platform/provider.ts"
import { parseAppToken, parseTokenResponse } from "../twitch/lib/parse-response.ts"
import { KickInvalid, KickRateLimited, KickUnavailable, type KickEndpoint } from "./errors.ts"
import {
  isRecord,
  parseChannelIds,
  parsePublicKey,
  parseSubscription,
  parseUsers,
  type KickUser,
} from "./lib/parse-response.ts"

export { KickInvalid, KickRateLimited, KickUnavailable } from "./errors.ts"

/** The `fetch` the client sends every call through; the global `fetch` fits. */
export type KickFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** A registered Kick app: `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`, which resolveConfig sets together. */
export interface KickApp {
  readonly clientId: string
  readonly clientSecret: string
}

export type KickClientConfig = Pick<
  ResolvedConfig,
  "kickIdBaseUrl" | "kickApiBaseUrl" | "kickTimeoutMs"
>

/** The Kick app of the config, `null` when this install has none. */
export function kickAppOf(
  config: Pick<ResolvedConfig, "kickClientId" | "kickClientSecret">,
): KickApp | null {
  const { kickClientId: clientId, kickClientSecret: clientSecret } = config
  return clientId === null || clientSecret === null ? null : { clientId, clientSecret }
}

/** The event a chat watch subscribes to, as Kick names it. */
export const chatMessageEvent = { name: "chat.message.sent", version: 1 } as const

/** Kick's OAuth 2.1 server (`id.kick.com`) and public API (`api.kick.com`). */
export class KickClient {
  private appToken: { readonly accessToken: string; readonly expiresAt: number } | null = null
  private appTokenGrant: Promise<string> | null = null

  constructor(
    private readonly app: KickApp,
    private readonly config: KickClientConfig,
    private readonly fetchImpl: KickFetch,
  ) {}

  /** Kick requires PKCE with S256 and has no OpenID Connect, so no nonce is sent. */
  authorizeUrl(params: Omit<AuthorizeParams, "nonce" | "forceVerify">): string {
    const url = new URL("/oauth/authorize", this.config.kickIdBaseUrl)
    url.searchParams.set("client_id", this.app.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", params.redirectUri)
    url.searchParams.set("state", params.state)
    url.searchParams.set("scope", params.scopes.join(" "))
    url.searchParams.set("code_challenge", params.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    return url.toString()
  }

  /** Not retried: a code is single use, so the caller queues the code instead. */
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<ExchangedCode> {
    return this.tokenRequest(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
      parseTokenResponse,
    )
  }

  /** The answer's refresh token may differ from the one sent: the caller stores it in its place. */
  refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    return this.tokenRequest(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      parseTokenResponse,
    )
  }

  /** The user the access token belongs to: `GET /public/v1/users` with no id answers the token's own user. */
  async currentUser(accessToken: string): Promise<KickUser> {
    const [user] = await this.api("users", "/public/v1/users", {}, accessToken, parseUsers)
    if (user === undefined) throw new KickUnavailable("users", 200)
    return user
  }

  /** The accounts among `userIds` that exist, asked with the app's own token in chunks Kick accepts. */
  async users(userIds: readonly string[]): Promise<readonly KickUser[]> {
    const users: KickUser[] = []
    for (let start = 0; start < userIds.length; start += maxIdsPerCall) {
      const chunk = userIds.slice(start, start + maxIdsPerCall)
      const token = await this.appAccessToken()
      users.push(...(await this.api("users", "/public/v1/users", { id: chunk }, token, parseUsers)))
    }
    return users
  }

  /** The broadcaster user id of a channel slug, `null` when no channel has it. */
  async channelIdBySlug(slug: string): Promise<string | null> {
    const token = await this.appAccessToken()
    const ids = await this.api("channels", "/public/v1/channels", { slug }, token, parseChannelIds)
    return ids.get(slug) ?? null
  }

  /**
   * Subscribes the app to the chat of the token's own channel; Kick takes the broadcaster from a user token.
   * Returns the subscription id.
   */
  async subscribeChat(accessToken: string, broadcasterId: string): Promise<string> {
    const outcome = await this.api(
      "subscribe",
      "/public/v1/events/subscriptions",
      {},
      accessToken,
      parseSubscription,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [chatMessageEvent],
          method: "webhook",
          broadcaster_user_id: Number(broadcasterId),
        }),
      },
    )
    if (!outcome.ok) throw new KickInvalid("subscribe", 200, { reason: outcome.error })
    return outcome.subscriptionId
  }

  /**
   * Deletes a subscription with the app's own token, so it works after the streamer's token is gone; Kick
   * answers 204.
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const url = this.apiUrl("/public/v1/events/subscriptions", { id: [subscriptionId] })
    const response = await this.send("unsubscribe", url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await this.appAccessToken()}` },
    })
    await this.check("unsubscribe", response)
    await response.body?.cancel()
  }

  /** The PEM public key Kick signs webhooks with; Kick may rotate it, so callers read it again on a failed check. */
  async publicKey(): Promise<string> {
    const response = await this.send("public-key", this.apiUrl("/public/v1/public-key", {}), {})
    return this.read("public-key", response, parsePublicKey)
  }

  /**
   * An app access token (client credentials grant), kept until a tenth of its lifetime is left; callers at
   * once share one grant.
   */
  private async appAccessToken(): Promise<string> {
    if (this.appToken !== null && Date.now() < this.appToken.expiresAt) {
      return this.appToken.accessToken
    }
    this.appTokenGrant ??= this.grantAppToken().finally(() => {
      this.appTokenGrant = null
    })
    return this.appTokenGrant
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
    const response = await this.send("token", new URL("/oauth/token", this.config.kickIdBaseUrl), {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.app.clientId,
        client_secret: this.app.clientSecret,
        ...params,
      }),
    })
    return this.read("token", response, parse)
  }

  private async api<T>(
    endpoint: KickEndpoint,
    path: string,
    query: Readonly<Record<string, string | readonly string[]>>,
    accessToken: string,
    parse: (body: unknown) => Parsed<T, "malformed">,
    request: RequestInit = {},
  ): Promise<T> {
    const response = await this.send(endpoint, this.apiUrl(path, query), {
      ...request,
      headers: { ...request.headers, Authorization: `Bearer ${accessToken}` },
    })
    return this.read(endpoint, response, parse)
  }

  private apiUrl(path: string, query: Readonly<Record<string, string | readonly string[]>>): URL {
    const url = new URL(path, this.config.kickApiBaseUrl)
    for (const [name, value] of Object.entries(query)) {
      for (const item of typeof value === "string" ? [value] : value) {
        url.searchParams.append(name, item)
      }
    }
    return url
  }

  private async send(endpoint: KickEndpoint, url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.kickTimeoutMs),
      })
    } catch (cause) {
      throw new KickUnavailable(endpoint, null, { cause })
    }
  }

  private async check(endpoint: KickEndpoint, response: Response): Promise<void> {
    if (response.status === 429) throw new KickRateLimited(endpoint)
    if (response.status >= 500) throw new KickUnavailable(endpoint, response.status)
    if (!response.ok) {
      throw new KickInvalid(endpoint, response.status, { reason: await errorReason(response) })
    }
  }

  private async read<T>(
    endpoint: KickEndpoint,
    response: Response,
    parse: (body: unknown) => Parsed<T, "malformed">,
  ): Promise<T> {
    await this.check(endpoint, response)
    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new KickUnavailable(endpoint, response.status, { cause })
    }
    const parsed = parse(body)
    if (!parsed.ok) throw new KickUnavailable(endpoint, response.status)
    return parsed.value
  }
}

// Kick caps the id and slug lists of its lookups at 50.
const maxIdsPerCall = 50

/** The part of an app token's lifetime it is used for, so a call that is slow to start does not meet it expired. */
const appTokenUsableShare = 0.9

/** OAuth errors carry `error` (`invalid_grant`), API errors `message`; anything else gives no reason. */
async function errorReason(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (!isRecord(body)) return null
    if (typeof body.error === "string") return body.error
    return typeof body.message === "string" ? body.message : null
  } catch {
    // An empty or non-JSON error body has no reason to report.
  }
  return null
}
