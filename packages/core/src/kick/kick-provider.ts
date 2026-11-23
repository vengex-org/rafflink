import type { ChatSourceFactory } from "../platform/chat-source.ts"
import type {
  AuthorizeParams,
  ChannelRoles,
  ChatContext,
  ChatDelivery,
  ExchangedCode,
  PlatformAccount,
  PlatformCapabilities,
  PlatformProvider,
  SubscriberBadges,
  SubscriptionGroup,
  TokenValidation,
  UserProfile,
} from "../platform/provider.ts"
import type { AsyncSql, Clock } from "../ports.ts"
import { KickChatWatches } from "./chat-watches.ts"
import { KickInvalid, KickRateLimited, KickUnavailable } from "./errors.ts"
import { kickChat, type KickChatConfig } from "./kick-chat.ts"
import { KickClient, kickAppOf, type KickClientConfig, type KickFetch } from "./kick-client.ts"
import type { KickUser } from "./lib/parse-response.ts"
import { KickWebhookKey, receiveKickWebhook, type KickWebhookConfig } from "./webhook.ts"

export type KickProviderConfig = KickChatConfig & KickWebhookConfig

// Kick's public API tells no follows, subscriptions, VIPs, moderators or account ages, so a Kick giveaway
// can only weigh everyone as a viewer. Chat entry waits for the badges of #61.
const kickCapabilities: PlatformCapabilities = {
  followerCheck: false,
  subTiers: false,
  vip: false,
  accountAge: false,
  moderatorRole: false,
  pageEntry: true,
  chatEntry: false,
}

const noBadges: SubscriberBadges = { sub_t1: null, sub_t2: null, sub_t3: null }

// Usernames on Kick are letters, digits and underscores; Kick treats them case-insensitively.
const kickLoginPattern = /^[a-z0-9_]{3,25}$/i

/**
 * The `kick` entry of a target's providers: empty when the install has no Kick app, so Kick sign-in and its
 * webhook route do not exist there.
 */
export function kickPlatform(
  config: KickProviderConfig & KickClientConfig & Parameters<typeof kickAppOf>[0],
  fetchImpl: KickFetch,
  clock: Clock,
  accountsSql: AsyncSql,
): { readonly kick?: KickProvider } {
  const app = kickAppOf(config)
  if (app === null) return {}
  const client = new KickClient(app, config, fetchImpl)
  return { kick: new KickProvider(client, new KickChatWatches(accountsSql), clock, config) }
}

/** Kick behind the platform seam: OAuth 2.1 with PKCE, the public API, and chat over webhooks. */
export class KickProvider implements PlatformProvider {
  readonly platform = "kick"
  readonly capabilities = kickCapabilities
  // `events:subscribe` lets the app subscribe to the streamer's chat with the streamer's token.
  readonly scopes = {
    streamer: ["user:read", "events:subscribe"],
    viewer: ["user:read"],
    moderator: ["user:read"],
  } as const
  readonly chatEntryScopes = [] as const
  private readonly key: KickWebhookKey

  constructor(
    private readonly client: KickClient,
    private readonly watches: KickChatWatches,
    private readonly clock: Clock,
    private readonly config: KickProviderConfig,
  ) {
    this.key = new KickWebhookKey(client, clock, config)
  }

  authorizeUrl(params: AuthorizeParams): string {
    return this.client.authorizeUrl(params)
  }

  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<ExchangedCode> {
    return this.client.exchangeCode(code, redirectUri, codeVerifier)
  }

  /** Kick has no OpenID Connect: the user the fresh access token belongs to is the one who signed in. */
  async verifySignIn(tokens: ExchangedCode): Promise<string> {
    return (await this.client.currentUser(tokens.accessToken)).id
  }

  refreshTokens(refreshToken: string): Promise<ExchangedCode> {
    return this.client.refreshTokens(refreshToken)
  }

  async userProfile(accessToken: string): Promise<UserProfile> {
    return profileOf(await this.client.currentUser(accessToken))
  }

  /** Kick deprecated its token introspection, so the token is checked by reading its own user. */
  async validate(accessToken: string): Promise<TokenValidation> {
    try {
      return { status: "valid", userId: (await this.client.currentUser(accessToken)).id }
    } catch (error) {
      if (error instanceof KickInvalid && error.status === 401) return { status: "invalid" }
      if (error instanceof KickRateLimited || error instanceof KickUnavailable) {
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

  async userProfiles(userIds: readonly string[]): Promise<readonly UserProfile[]> {
    return (await this.client.users(userIds)).map(profileOf)
  }

  async subscriptionTier(): Promise<SubscriptionGroup | null> {
    return null
  }

  async subscriberBadges(): Promise<SubscriberBadges> {
    return noBadges
  }

  async channelRoles(): Promise<ChannelRoles> {
    return { vips: [], moderators: [] }
  }

  async isModerator(): Promise<boolean> {
    return false
  }

  /** Lower case; a leading `@`, as chat writes names, is dropped. */
  parseLogin(text: string): string | null {
    const login = text.trim().replace(/^@/, "")
    return kickLoginPattern.test(login) ? login.toLowerCase() : null
  }

  /** Kick's public API finds an account only by its channel slug, which for most accounts is the username in lower case. */
  async accountByLogin(login: string): Promise<PlatformAccount | null> {
    const id = await this.client.channelIdBySlug(login)
    return id === null ? null : { id, login }
  }

  /** A watch in the account store that the webhook route reads, and the channel's subscription at Kick. */
  chatSource(context: ChatContext): ChatSourceFactory {
    return kickChat({
      giveawayId: context.giveawayId,
      client: this.client,
      watches: this.watches,
      clock: context.clock,
      config: this.config,
      streamerAccess: context.streamerAccess,
    })
  }

  readonly receiveWebhook = (request: Request, deliver: ChatDelivery): Promise<Response> =>
    receiveKickWebhook(
      { key: this.key, watches: this.watches, clock: this.clock, config: this.config },
      request,
      deliver,
    )
}

// Kick serves pictures from its own host, which the pages' CSP does not allow, so none is kept.
function profileOf(user: KickUser): UserProfile {
  return {
    id: user.id,
    login: user.name.toLowerCase(),
    displayName: user.name,
    createdAt: null,
    profileImageUrl: null,
  }
}
