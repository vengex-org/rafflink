import type { PointsReward } from "../domain/rules.ts"
import type { ChatSourceFactory } from "../platform/chat-source.ts"
import { PlatformIdentityRejected } from "../platform/errors.ts"
import {
  everyCapability,
  type AuthorizeParams,
  type ChannelRoles,
  type ChatContext,
  type ExchangedCode,
  type PlatformAccount,
  type PlatformCapabilities,
  type PlatformProvider,
  type SignInProof,
  type SubscriberBadges,
  type SubscriberTiers,
  type SubscriptionGroup,
  type TokenValidation,
  type UserProfile,
} from "../platform/provider.ts"
import type { Clock } from "../ports.ts"
import { ChannelBadges, type ChannelBadgesConfig } from "./channel-badges.ts"
import { eventSubChat, type ChatWatcherConfig } from "./chat-watcher.ts"
import { twitchLoginPattern } from "./lib/login.ts"
import { TwitchInvalid, type TwitchClient } from "./twitch-client.ts"

export type TwitchProviderConfig = ChannelBadgesConfig & ChatWatcherConfig

/** Twitch behind the platform seam: the Helix client, the scopes of both sign-ins, the badge cache and EventSub chat. */
export class TwitchProvider implements PlatformProvider {
  readonly platform = "twitch"
  readonly capabilities: PlatformCapabilities = everyCapability
  readonly scopes = {
    streamer: ["openid", "channel:read:vips", "moderation:read", "user:read:chat"],
    viewer: ["openid", "user:read:subscriptions", "user:read:follows"],
    moderator: ["openid"],
  } as const
  // The check of a queued entrant reads the follow with the streamer's token, and a redeemer's tier too.
  readonly entryScopes = {
    chat: ["moderator:read:followers"],
    sub: ["moderator:read:followers", "channel:read:subscriptions"],
    points: ["moderator:read:followers", "channel:read:subscriptions", "channel:read:redemptions"],
  } as const
  private readonly badges: ChannelBadges

  constructor(
    private readonly client: TwitchClient,
    clock: Clock,
    private readonly config: TwitchProviderConfig,
  ) {
    this.badges = new ChannelBadges(client, clock, config)
  }

  authorizeUrl(params: AuthorizeParams): string {
    return this.client.authorizeUrl(params)
  }

  // Twitch's code flow takes no PKCE verifier; the confidential client secret authenticates the exchange.
  exchangeCode(code: string, redirectUri: string): Promise<ExchangedCode> {
    return this.client.exchangeCode(code, redirectUri)
  }

  /** Twitch proves the user with the OpenID Connect `id_token`; a missing or failing one is `PlatformIdentityRejected`. */
  async verifySignIn(tokens: ExchangedCode, proof: SignInProof): Promise<string> {
    if (tokens.idToken === null) {
      throw new PlatformIdentityRejected("Twitch sent no id_token", "id-token", null)
    }
    try {
      return (await this.client.verifyIdToken(tokens.idToken, proof.nonce)).userId
    } catch (error) {
      if (error instanceof TwitchInvalid && error.endpoint === "id-token") {
        throw new PlatformIdentityRejected(
          "Twitch id_token failed verification",
          "id-token",
          null,
          {
            cause: error,
          },
        )
      }
      throw error
    }
  }

  refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    return this.client.refreshTokens(refreshToken)
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

  channelFollower(accessToken: string, broadcasterId: string, userId: string): Promise<boolean> {
    return this.client.channelFollower(accessToken, broadcasterId, userId)
  }

  async userProfiles(userIds: readonly string[]): Promise<readonly UserProfile[]> {
    return this.client.userProfilesById(await this.client.appAccessToken(), userIds)
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

  isModerator(accessToken: string, broadcasterId: string, userId: string): Promise<boolean> {
    return this.client.isModerator(accessToken, broadcasterId, userId)
  }

  subscriberTiers(
    accessToken: string,
    broadcasterId: string,
    userIds: readonly string[],
  ): Promise<SubscriberTiers> {
    return this.client.subscriberTiers(accessToken, broadcasterId, userIds)
  }

  /** Twitch gives channel points to Affiliates and Partners only. */
  async hasChannelPoints(broadcasterId: string): Promise<boolean> {
    const type = await this.client.broadcasterType(
      await this.client.appAccessToken(),
      broadcasterId,
    )
    return type === "affiliate" || type === "partner"
  }

  pointsRewards(accessToken: string, broadcasterId: string): Promise<readonly PointsReward[]> {
    return this.client.customRewards(accessToken, broadcasterId)
  }

  /** Lower case, as Twitch stores logins; a leading `@`, as chat writes names, is dropped. */
  parseLogin(text: string): string | null {
    const login = text.trim().replace(/^@/, "")
    return twitchLoginPattern.test(login) ? login.toLowerCase() : null
  }

  async accountByLogin(login: string): Promise<PlatformAccount | null> {
    const ids = await this.client.userIdsByLogin(await this.client.appAccessToken(), [login])
    const id = ids.get(login)
    return id === undefined ? null : { id, login }
  }

  /** An EventSub WebSocket whose sessions are subscribed to the channel's topics with the streamer's token. */
  chatSource(context: ChatContext): ChatSourceFactory {
    return eventSubChat({
      connector: context.connector,
      clock: context.clock,
      config: this.config,
      subscribe: async (sessionId, topics) => {
        const { accessToken, broadcasterId } = await context.streamerAccess()
        await this.client.subscribeEvents(accessToken, broadcasterId, sessionId, topics)
      },
    })
  }
}
