import type { ChatSourceFactory } from "../platform/chat-source.ts"
import { PlatformIdentityRejected } from "../platform/errors.ts"
import type {
  AuthorizeParams,
  ChannelRoles,
  ChatContext,
  ExchangedCode,
  PlatformCapabilities,
  PlatformProvider,
  SignInProof,
  SubscriberBadges,
  SubscriptionGroup,
  TokenValidation,
  UserProfile,
} from "../platform/provider.ts"
import type { Clock } from "../ports.ts"
import { ChannelBadges, type ChannelBadgesConfig } from "./channel-badges.ts"
import { eventSubChat, type ChatWatcherConfig } from "./chat-watcher.ts"
import { TwitchInvalid, type TwitchClient } from "./twitch-client.ts"

export type TwitchProviderConfig = ChannelBadgesConfig & ChatWatcherConfig

const twitchCapabilities: PlatformCapabilities = {
  followerCheck: true,
  subTiers: true,
  vip: true,
  accountAge: true,
  pageEntry: true,
  chatEntry: false,
}

/** Twitch behind the platform seam: the Helix client, the scopes of both sign-ins, the badge cache and EventSub chat. */
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

  /** An EventSub WebSocket whose sessions are subscribed to the channel's chat with the streamer's token. */
  chatSource(context: ChatContext): ChatSourceFactory {
    return eventSubChat({
      connector: context.connector,
      clock: context.clock,
      config: this.config,
      subscribe: async (sessionId) => {
        const { accessToken, broadcasterId } = await context.streamerAccess()
        await this.client.subscribeChatMessages(accessToken, broadcasterId, sessionId)
      },
    })
  }
}
