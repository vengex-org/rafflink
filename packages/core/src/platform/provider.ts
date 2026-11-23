import type { Group } from "../domain/groups.ts"
import {
  channelEntryVias,
  type ChannelEntryVia,
  type PointsReward,
  type ViewerFacts,
} from "../domain/rules.ts"
import type { Clock, Instant, SocketConnector } from "../ports.ts"
import type { ChatSourceFactory } from "./chat-source.ts"

/** The streaming platforms the app signs in with; the `platform` column of streamers, giveaways and entries. */
const platforms = ["twitch"] as const

export type Platform = (typeof platforms)[number]

/** The two sign-in callbacks: the streamer who runs giveaways and the viewer who enters one. */
export type OAuthFlow = "streamer" | "viewer"

/** What a sign-in is for; a moderator of a giveaway's channel signs in on the viewer callback, so no new redirect URI is registered. */
export type SignInPurpose = OAuthFlow | "moderator"

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
  /** New subscribers, resubscribers and gift recipients enter by themselves. */
  readonly subEntry: boolean
  /** Viewers enter by redeeming a channel point reward. */
  readonly pointsEntry: boolean
}

/** A platform that can check every rule and offers both entry ways. */
export const everyCapability: PlatformCapabilities = {
  followerCheck: true,
  subTiers: true,
  vip: true,
  accountAge: true,
  pageEntry: true,
  chatEntry: true,
  subEntry: true,
  pointsEntry: true,
}

export interface AuthorizeParams {
  readonly state: string
  readonly nonce: string
  readonly scopes: readonly [string, ...string[]]
  readonly redirectUri: string
  /** The PKCE `code_challenge` (S256) of the sign-in's code verifier; a platform without PKCE ignores it. */
  readonly codeChallenge: string
  /** Makes the platform show its account picker even when the browser is signed in; off when absent. */
  readonly forceVerify?: boolean
}

/** The token endpoint's answer to a code or a refresh token. */
export interface ExchangedCode {
  readonly accessToken: string
  readonly refreshToken: string
  /** How long the access token lives from the answer on. */
  readonly expiresInSeconds: number
  /** The OpenID Connect `id_token`; `null` when the platform or the scopes give none. */
  readonly idToken: string | null
}

/** What the sign-in callback proves the user with besides the code. */
export interface SignInProof {
  /** The nonce the sign-in start sent; an OpenID Connect platform finds it in the `id_token`. */
  readonly nonce: string
}

/** The platform user of an access token. */
export interface UserProfile {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly createdAt: Instant
  /** `null` when the platform sent no picture on its image host. */
  readonly profileImageUrl: string | null
}

/** A platform account found by its login. */
export interface PlatformAccount {
  readonly id: string
  readonly login: string
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

/** The tier of each subscriber among the asked users; a user who does not subscribe is absent. */
export type SubscriberTiers = ReadonlyMap<string, NonNullable<ViewerFacts["subTier"]>>

/** An access token of a giveaway's streamer, with the channel it is for. */
export interface StreamerAccess {
  readonly accessToken: string
  readonly broadcasterId: string
}

/** What a target gives a provider to open the chat of one giveaway's channel. */
export interface ChatContext {
  /** Outbound WebSockets of this target. */
  readonly connector: SocketConnector
  readonly clock: Clock
  readonly streamerAccess: () => Promise<StreamerAccess>
}

/** One platform: its sign-in, the viewer facts the rules read, the channel roles and the chat source. */
export interface PlatformProvider {
  readonly platform: Platform
  readonly capabilities: PlatformCapabilities
  /** The scopes each sign-in asks for; the streamer's are stored with the streamer's token. */
  readonly scopes: Readonly<Record<SignInPurpose, readonly [string, ...string[]]>>
  /**
   * The streamer scopes each channel entry way needs on top of `scopes.streamer`, asked only when the
   * streamer turns that way on. Each includes what the check of a queued entrant reads (follow, tier).
   */
  readonly entryScopes: Readonly<Record<ChannelEntryVia, readonly string[]>>
  authorizeUrl(params: AuthorizeParams): string
  /**
   * Trades the sign-in's code, with its PKCE verifier, for tokens. Not retried: a code is single use,
   * so the caller queues the code instead.
   */
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<ExchangedCode>
  /**
   * The user id the exchanged tokens prove. Throws `PlatformIdentityRejected` when they prove none,
   * for example an `id_token` that is missing or fails verification.
   */
  verifySignIn(tokens: ExchangedCode, proof: SignInProof): Promise<string>
  /** The answer's refresh token may differ from the one sent: the caller stores it in its place. */
  refreshTokens(refreshToken: string): Promise<ExchangedCode>
  userProfile(accessToken: string): Promise<UserProfile>
  validate(accessToken: string): Promise<TokenValidation>
  follows(accessToken: string, broadcasterId: string, userId: string): Promise<boolean>
  /** Whether `userId` follows the channel, asked with the streamer's token instead of the viewer's. */
  channelFollower(accessToken: string, broadcasterId: string, userId: string): Promise<boolean>
  /** The profiles of the accounts that exist among `userIds`; a missing account is absent from the answer. */
  userProfiles(userIds: readonly string[]): Promise<readonly UserProfile[]>
  /** The tier group of the viewer's subscription, `null` when not subscribed. */
  subscriptionTier(
    accessToken: string,
    broadcasterId: string,
    userId: string,
  ): Promise<SubscriptionGroup | null>
  /** The channel's subscriber badges; every tier `null` when the platform could not answer. */
  subscriberBadges(broadcasterId: string): Promise<SubscriberBadges>
  channelRoles(accessToken: string, broadcasterId: string): Promise<ChannelRoles>
  /** Whether the user moderates the channel now, asked with the streamer's token. */
  isModerator(accessToken: string, broadcasterId: string, userId: string): Promise<boolean>
  /** The tier of each of `userIds` who subscribes to the channel, asked with the streamer's token; at most 100 ids. */
  subscriberTiers(
    accessToken: string,
    broadcasterId: string,
    userIds: readonly string[],
  ): Promise<SubscriberTiers>
  /** Whether the channel has channel points at all; uses the app's own credentials, so it needs no streamer scope. */
  hasChannelPoints(broadcasterId: string): Promise<boolean>
  /** The point rewards of a channel that has channel points, asked with the streamer's token. */
  pointsRewards(accessToken: string, broadcasterId: string): Promise<readonly PointsReward[]>
  /** Typed text as a login of this platform in its normal form; `null` when the text cannot be a login. */
  parseLogin(text: string): string | null
  /** The account a login from {@link parseLogin} names; `null` when no account has it. Uses the app's own credentials. */
  accountByLogin(login: string): Promise<PlatformAccount | null>
  /** The chat of one giveaway's channel, whatever this platform's transport. */
  chatSource(context: ChatContext): ChatSourceFactory
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

/** The entry ways whose scopes all are among a token's `scopes`. */
export function readyEntryWays(
  provider: PlatformProvider,
  scopes: readonly string[],
): readonly ChannelEntryVia[] {
  return channelEntryVias.filter((way) =>
    provider.entryScopes[way].every((scope) => scopes.includes(scope)),
  )
}

export function isPlatform(value: string): value is Platform {
  return platforms.some((platform) => platform === value)
}
