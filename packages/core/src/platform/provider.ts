import type { Group } from "../domain/groups.ts"
import type { PointsReward, ViewerFacts } from "../domain/rules.ts"
import { streamerFeatures, type StreamerFeature } from "../domain/streamer-features.ts"
import type { Clock, Instant, SocketConnector } from "../ports.ts"
import type { ChannelEntryEvent, ChatMessage, ChatSourceFactory } from "./chat-source.ts"

/** The streaming platforms the app signs in with; the `platform` column of streamers, giveaways and entries. */
const platforms = ["twitch", "kick", "youtube"] as const

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
  /** The platform tells who moderates the channel. */
  readonly moderatorRole: boolean
  /** Viewers enter by signing in on the giveaway page. */
  readonly pageEntry: boolean
  /** Viewers enter by writing in the streamer's chat. */
  readonly chatEntry: boolean
  /** New subscribers, resubscribers and gift recipients enter by themselves. */
  readonly subEntry: boolean
  /** Viewers enter by redeeming a channel point reward. */
  readonly pointsEntry: boolean
  /**
   * Groups only the chat badges and subscription events tell. They count on a giveaway that sees a badge
   * or a sub event for every entrant, so one with neither page nor points entry.
   */
  readonly chatBadgeGroups: readonly Group[]
}

/** A platform that can check every rule and offers both entry ways. */
export const everyCapability: PlatformCapabilities = {
  followerCheck: true,
  subTiers: true,
  vip: true,
  accountAge: true,
  moderatorRole: true,
  pageEntry: true,
  chatEntry: true,
  subEntry: true,
  pointsEntry: true,
  chatBadgeGroups: [],
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
  /** The scopes the platform granted, as its answer lists them; `null` when the answer names none. */
  readonly scopes: readonly string[] | null
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
  /** `null` when the platform does not tell when the account was made. */
  readonly createdAt: Instant | null
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
  | { readonly status: "valid" }
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
  /** The giveaway whose room watches the chat. */
  readonly giveawayId: string
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
   * The viewer scopes a giveaway's rules add to `scopes.viewer`: the follow read when a follow changes who
   * enters or their tickets, the tier read when a tier does. Each viewer's own token reads them, so every
   * viewer has their own rate limit.
   */
  readonly viewerRuleScopes: Readonly<Record<"follow" | "tier", readonly string[]>>
  /**
   * The streamer scopes each feature needs on top of `scopes.streamer`, asked only when the streamer first
   * uses it; empty for a feature the platform serves without one.
   */
  readonly featureScopes: Readonly<Record<StreamerFeature, readonly string[]>>
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
  /** Whether the viewer of `accessToken` follows the channel, asked with their own token. */
  follows(accessToken: string, broadcasterId: string, userId: string): Promise<boolean>
  /** Whether `userId` follows the channel, asked with the streamer's token, for an entrant who never signed in. */
  channelFollower(accessToken: string, broadcasterId: string, userId: string): Promise<boolean>
  /** The profiles of the accounts that exist among `userIds`; a missing account is absent from the answer. */
  userProfiles(userIds: readonly string[]): Promise<readonly UserProfile[]>
  /** The tier group of the viewer's subscription, asked with their own token; `null` when not subscribed. */
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
  /**
   * Answers the platform's webhook at `/api/<platform>/webhook`, handing each event it proves to
   * `deliver`; absent on a platform that sends no webhooks.
   */
  readonly receiveWebhook?: (request: Request, deliver: WebhookDelivery) => Promise<Response>
}

/** Hands what one webhook brought to the room of a giveaway. */
export interface WebhookDelivery {
  readonly chat: (giveawayId: string, message: ChatMessage) => Promise<void>
  /** The subscriptions or redemptions of one webhook, in one call per room. */
  readonly channelEntries: (
    giveawayId: string,
    events: readonly ChannelEntryEvent[],
  ) => Promise<void>
}

/** The provider of each platform this install signs in with: Twitch always, the others when their app is configured. */
export type PlatformProviders = Readonly<
  { twitch: PlatformProvider } & Partial<Record<Exclude<Platform, "twitch">, PlatformProvider>>
>

/** A stored `platform` value with no provider: a platform this code does not know, or one whose app is not configured. */
export class UnknownPlatform extends Error {
  constructor(readonly platform: string) {
    super("no provider for platform")
  }
}

/** A known platform this install runs without: its app is blank or `SIGN_IN_DISABLED_PLATFORMS` lists it. */
export class PlatformOff extends UnknownPlatform {}

/** The provider of a stored `platform` value, `null` while the install runs without that platform. */
export function enabledProviderFor(
  providers: PlatformProviders,
  platform: string,
): PlatformProvider | null {
  return providers[knownPlatform(platform)] ?? null
}

/** A stored `platform` value this code knows, whether or not this install runs it. */
export function knownPlatform(platform: string): Platform {
  if (!isPlatform(platform)) throw new UnknownPlatform(platform)
  return platform
}

/** The provider of a stored `platform` value, for callers that cannot go on without it. */
export function providerFor(providers: PlatformProviders, platform: string): PlatformProvider {
  const provider = enabledProviderFor(providers, platform)
  if (provider === null) throw new PlatformOff(platform)
  return provider
}

/** The providers of the platforms this install signs in with, Twitch first. */
export function configuredProviders(providers: PlatformProviders): readonly PlatformProvider[] {
  return platforms.flatMap((platform) => providers[platform] ?? [])
}

/** The features whose scopes all are among a token's `scopes`. */
export function grantedFeatures(
  provider: PlatformProvider,
  scopes: readonly string[],
): readonly StreamerFeature[] {
  return streamerFeatures.filter((feature) =>
    provider.featureScopes[feature].every((scope) => scopes.includes(scope)),
  )
}

/**
 * Whether a giveaway keeps its winners' names after its entrants are deleted. YouTube's Developer Policies
 * allow stored API data for 30 days at most, so a YouTube giveaway keeps only its winners' channel ids.
 */
export function keepsWinnerNames(platform: string): boolean {
  return platform !== "youtube"
}

/**
 * Whether the winners' chat watch ends once no winner can still claim, instead of with the reroll window.
 * YouTube's chat is read by polling and every read spends the install's daily quota.
 */
export function winnerChatEndsWithClaims(platform: string): boolean {
  return platform === "youtube"
}

export function isPlatform(value: string): value is Platform {
  return platforms.some((platform) => platform === value)
}
