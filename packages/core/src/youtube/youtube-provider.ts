import type { PointsReward } from "../domain/rules.ts"
import { PlatformNoChannel } from "../platform/errors.ts"
import type { ChatSourceFactory } from "../platform/chat-source.ts"
import type {
  AuthorizeParams,
  ChannelRoles,
  ChatContext,
  ExchangedCode,
  PlatformAccount,
  PlatformCapabilities,
  PlatformProvider,
  SubscriberBadges,
  SubscriberTiers,
  SubscriptionGroup,
  TokenValidation,
  UserProfile,
} from "../platform/provider.ts"
import type { AsyncSql, Clock } from "../ports.ts"
import { YouTubeInvalid, YouTubeRateLimited, YouTubeUnavailable } from "./errors.ts"
import type { YouTubeChannel } from "./lib/parse-response.ts"
import { youtubeLogin } from "./lib/login.ts"
import { YouTubeQuota, type YouTubeQuotaConfig } from "./quota.ts"
import {
  YouTubeClient,
  youtubeAppOf,
  type YouTubeClientConfig,
  type YouTubeFetch,
} from "./youtube-client.ts"
import { youtubeChat, type YouTubeChatConfig } from "./youtube-chat.ts"

export type YouTubeProviderConfig = YouTubeClientConfig & YouTubeQuotaConfig & YouTubeChatConfig

/**
 * Viewers enter only by chat keyword: a viewer sign-in would ask them for a sensitive Google scope. The
 * chat tells a member (`isChatSponsor`) and a moderator; YouTube has no followers and no VIPs.
 */
export const youtubeCapabilities: PlatformCapabilities = {
  followerCheck: false,
  subTiers: false,
  vip: false,
  accountAge: false,
  moderatorRole: false,
  pageEntry: false,
  chatEntry: true,
  subEntry: false,
  pointsEntry: false,
  chatBadgeGroups: ["member", "moderator"],
}

const noBadges: SubscriberBadges = { sub_t1: null, sub_t2: null, sub_t3: null }

const readonlyScope = "https://www.googleapis.com/auth/youtube.readonly"

/**
 * The `youtube` entry of a target's providers, with the quota meter the admin page and the create form
 * read: empty when the install has no Google client, so YouTube sign-in does not exist there.
 */
export function youtubePlatform(
  config: YouTubeProviderConfig & Parameters<typeof youtubeAppOf>[0],
  fetchImpl: YouTubeFetch,
  clock: Clock,
  accountsSql: AsyncSql,
): { readonly youtube?: YouTubeProvider } {
  const app = youtubeAppOf(config)
  if (app === null) return {}
  const quota = new YouTubeQuota(accountsSql, config)
  const client = new YouTubeClient(app, config, quota, clock, fetchImpl)
  return { youtube: new YouTubeProvider(client, quota, app, config) }
}

/** YouTube behind the platform seam: Google OAuth with PKCE for the streamer, and the live chat read by polling. */
export class YouTubeProvider implements PlatformProvider {
  readonly platform = "youtube"
  readonly capabilities = youtubeCapabilities
  // Only the streamer signs in; viewer and moderator sign-in routes do not exist for a platform without page entry or moderator roles.
  readonly scopes = {
    streamer: [readonlyScope],
    viewer: [readonlyScope],
    moderator: [readonlyScope],
  } as const
  readonly viewerRuleScopes = { follow: [], tier: [] } as const
  readonly featureScopes = {
    followers: [],
    subs: [],
    redemptions: [],
    roles: [],
    modlinks: [],
  } as const

  constructor(
    private readonly client: YouTubeClient,
    /** Today's units, for the admin page and the create form. */
    readonly quota: YouTubeQuota,
    private readonly app: { readonly clientId: string },
    private readonly config: YouTubeChatConfig,
  ) {}

  authorizeUrl(params: AuthorizeParams): string {
    return this.client.authorizeUrl(params)
  }

  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<ExchangedCode> {
    return this.client.exchangeCode(code, redirectUri, codeVerifier)
  }

  /**
   * The streamer is their channel, not their Google account: one account can own several channels, and
   * Google's picker binds the token to one of them. An account without a channel is refused.
   */
  async verifySignIn(tokens: ExchangedCode): Promise<string> {
    return (await this.channelOf(tokens.accessToken)).id
  }

  refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    return this.client.refreshTokens(refreshToken)
  }

  async userProfile(accessToken: string): Promise<UserProfile> {
    return profileOf(await this.channelOf(accessToken))
  }

  /**
   * Google's token info costs no quota, unlike a channel read every hour per streamer. The caller has
   * just refreshed the token, which already fails for a revoked grant.
   */
  async validate(accessToken: string): Promise<TokenValidation> {
    try {
      const audience = await this.client.tokenAudience(accessToken)
      return audience === this.app.clientId ? { status: "valid" } : { status: "invalid" }
    } catch (error) {
      if (error instanceof YouTubeInvalid) return { status: "invalid" }
      if (error instanceof YouTubeRateLimited || error instanceof YouTubeUnavailable) {
        return { status: "unavailable" }
      }
      throw error
    }
  }

  async follows(): Promise<boolean> {
    return false
  }

  async channelFollower(): Promise<boolean> {
    return false
  }

  /** Chat messages carry the name; a channel read per entrant would cost a unit each for an account age the rules cannot use. */
  async userProfiles(): Promise<readonly UserProfile[]> {
    return []
  }

  async subscriptionTier(): Promise<SubscriptionGroup | null> {
    return null
  }

  async subscriberBadges(): Promise<SubscriberBadges> {
    return noBadges
  }

  async subscriberTiers(): Promise<SubscriberTiers> {
    return new Map()
  }

  async hasChannelPoints(): Promise<boolean> {
    return false
  }

  async pointsRewards(): Promise<readonly PointsReward[]> {
    return []
  }

  async channelRoles(): Promise<ChannelRoles> {
    return { vips: [], moderators: [] }
  }

  async isModerator(): Promise<boolean> {
    return false
  }

  /** A handle in lower case, without its `@`. */
  parseLogin(text: string): string | null {
    return youtubeLogin(text)
  }

  /**
   * Google has no app-only credentials, so no account can be looked up without a user's token: a YouTube
   * block list finds no one by name.
   */
  async accountByLogin(): Promise<PlatformAccount | null> {
    return null
  }

  chatSource(context: ChatContext): ChatSourceFactory {
    return youtubeChat({
      giveawayId: context.giveawayId,
      client: this.client,
      clock: context.clock,
      config: this.config,
      streamerAccess: context.streamerAccess,
    })
  }

  private async channelOf(accessToken: string): Promise<YouTubeChannel> {
    const [channel] = await this.client.myChannels(accessToken)
    if (channel === undefined) throw new PlatformNoChannel("no YouTube channel", "channels", 200)
    return channel
  }
}

// YouTube serves pictures from its own hosts, which the pages' CSP does not allow, so none is kept. A
// channel without a handle goes by its id as its login.
// TODO(#106): the stored handle and title are refreshed only at the next sign-in, not within 30 days.
function profileOf(channel: YouTubeChannel): UserProfile {
  return {
    id: channel.id,
    login: youtubeLogin(channel.handle ?? "") ?? channel.id.toLowerCase(),
    displayName: channel.title,
    createdAt: null,
    profileImageUrl: null,
  }
}
