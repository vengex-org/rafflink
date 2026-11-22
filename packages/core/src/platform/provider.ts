import type { Group } from "../domain/groups.ts"
import type { Instant } from "../ports.ts"

/** The streaming platforms the app signs in with; the `platform` column of streamers, giveaways and entries. */
const platforms = ["twitch"] as const

export type Platform = (typeof platforms)[number]

/** The two sign-ins: the streamer who runs giveaways and the viewer who enters one. */
export type OAuthFlow = "streamer" | "viewer"

export type SubscriptionGroup = Extract<Group, "sub_t1" | "sub_t2" | "sub_t3">

/** The image of each subscription tier's badge; `null` when no image is known for the tier. */
export type SubscriberBadges = Readonly<Record<SubscriptionGroup, string | null>>

/** What a platform can tell or do, so the web app offers only the rules and entry paths it supports. */
export interface PlatformCapabilities {
  readonly followerCheck: boolean
  readonly subTiers: boolean
  readonly vip: boolean
  readonly accountAge: boolean
  /** Viewers enter by signing in on the giveaway page. */
  readonly pageEntry: boolean
  /** Viewers enter by writing in the streamer's chat. */
  readonly chatEntry: boolean
}

export interface AuthorizeParams {
  readonly state: string
  readonly nonce: string
  readonly scopes: readonly [string, ...string[]]
  readonly redirectUri: string
  /** Makes the platform show its account picker even when the browser is signed in; off when absent. */
  readonly forceVerify?: boolean
}

export interface ExchangedCode {
  readonly accessToken: string
  readonly refreshToken: string
  /** `null` when the code was not requested with the `openid` scope. */
  readonly idToken: string | null
}

/** The user an `id_token` was issued for, as its `sub` claim. */
export interface VerifiedIdToken {
  readonly userId: string
}

/** The platform user of an access token. */
export interface UserProfile {
  readonly login: string
  readonly displayName: string
  readonly createdAt: Instant
  /** `null` when the platform sent no picture on its image host. */
  readonly profileImageUrl: string | null
}

/** User ids holding each role on a channel. */
export interface ChannelRoles {
  readonly vips: readonly string[]
  readonly moderators: readonly string[]
}

/**
 * Answer of the hourly token check. `invalid` is only a rejected token; any other failure is
 * `unavailable`, so a caller keeps the token (spec AC-22).
 */
export type TokenValidation =
  | { readonly status: "valid"; readonly userId: string }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" }

/** One platform: its sign-in, the viewer facts the rules read, the channel roles and the chat subscription. */
export interface PlatformProvider {
  readonly platform: Platform
  readonly capabilities: PlatformCapabilities
  /** The scopes each sign-in asks for; the streamer's are stored with the streamer's token. */
  readonly scopes: Readonly<Record<OAuthFlow, readonly [string, ...string[]]>>
  authorizeUrl(params: AuthorizeParams): string
  /** Not retried: a code is single use, so the caller queues the code instead. */
  exchangeCode(code: string, redirectUri: string): Promise<ExchangedCode>
  /** The answer's refresh token may differ from the one sent: the caller stores it in its place. */
  refreshTokens(refreshToken: string): Promise<ExchangedCode>
  verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdToken>
  userProfile(accessToken: string): Promise<UserProfile>
  validate(accessToken: string): Promise<TokenValidation>
  follows(accessToken: string, broadcasterId: string, userId: string): Promise<boolean>
  /** The tier group of the viewer's subscription, `null` when not subscribed. */
  subscriptionTier(
    accessToken: string,
    broadcasterId: string,
    userId: string,
  ): Promise<SubscriptionGroup | null>
  /** The channel's subscriber badges; every tier `null` when the platform could not answer. */
  subscriberBadges(broadcasterId: string): Promise<SubscriberBadges>
  channelRoles(accessToken: string, broadcasterId: string): Promise<ChannelRoles>
  /** Subscribes a chat session to the channel's chat messages with the streamer's token. */
  subscribeChatMessages(
    accessToken: string,
    broadcasterId: string,
    sessionId: string,
  ): Promise<void>
}

/** The provider of each platform, as `AppDeps` carries it. */
export type PlatformProviders = Readonly<Record<Platform, PlatformProvider>>

/** A stored `platform` value with no provider; rows are only written for registered platforms. */
export class UnknownPlatform extends Error {
  constructor(readonly platform: string) {
    super("no provider for platform")
  }
}

/** The provider of a stored `platform` value. */
export function providerFor(providers: PlatformProviders, platform: string): PlatformProvider {
  if (!isPlatform(platform)) throw new UnknownPlatform(platform)
  return providers[platform]
}

function isPlatform(value: string): value is Platform {
  return platforms.some((platform) => platform === value)
}
