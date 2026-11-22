import type { Clock } from "../ports.ts"
import type {
  AuthorizeParams,
  ChannelRoles,
  ExchangedCode,
  PlatformCapabilities,
  PlatformProvider,
  SubscriberBadges,
  SubscriptionGroup,
  TokenValidation,
  UserProfile,
  VerifiedIdToken,
} from "../platform/provider.ts"
import { ChannelBadges, type ChannelBadgesConfig } from "./channel-badges.ts"
import type { TwitchClient } from "./twitch-client.ts"

const twitchCapabilities: PlatformCapabilities = {
  followerCheck: true,
  subTiers: true,
  vip: true,
  accountAge: true,
  pageEntry: true,
  chatEntry: false,
}

/** Twitch behind the platform seam: the Helix client, the scopes of both sign-ins and the badge cache. */
export class TwitchProvider implements PlatformProvider {
  readonly platform = "twitch"
  readonly capabilities = twitchCapabilities
  readonly scopes = {
    streamer: ["openid", "channel:read:vips", "moderation:read", "user:read:chat"],
    viewer: ["openid", "user:read:subscriptions", "user:read:follows"],
  } as const
  private readonly badges: ChannelBadges

  constructor(
    private readonly client: TwitchClient,
    clock: Clock,
    config: ChannelBadgesConfig,
  ) {
    this.badges = new ChannelBadges(client, clock, config)
  }

  authorizeUrl(params: AuthorizeParams): string {
    return this.client.authorizeUrl(params)
  }

  exchangeCode(code: string, redirectUri: string): Promise<ExchangedCode> {
    return this.client.exchangeCode(code, redirectUri)
  }

  refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    return this.client.refreshTokens(refreshToken)
  }

  verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdToken> {
    return this.client.verifyIdToken(idToken, expectedNonce)
  }

  userProfile(accessToken: string): Promise<UserProfile> {
    return this.client.userProfile(accessToken)
  }

  validate(accessToken: string): Promise<TokenValidation> {
    return this.client.validate(accessToken)
  }

  follows(accessToken: string, broadcasterId: string, userId: string): Promise<boolean> {
    return this.client.follows(accessToken, broadcasterId, userId)
  }

  subscriptionTier(
    accessToken: string,
    broadcasterId: string,
    userId: string,
  ): Promise<SubscriptionGroup | null> {
    return this.client.subscriptionTier(accessToken, broadcasterId, userId)
  }

  subscriberBadges(broadcasterId: string): Promise<SubscriberBadges> {
    return this.badges.of(broadcasterId)
  }

  channelRoles(accessToken: string, broadcasterId: string): Promise<ChannelRoles> {
    return this.client.channelRoles(accessToken, broadcasterId)
  }

  subscribeChatMessages(
    accessToken: string,
    broadcasterId: string,
    sessionId: string,
  ): Promise<void> {
    return this.client.subscribeChatMessages(accessToken, broadcasterId, sessionId)
  }
}
