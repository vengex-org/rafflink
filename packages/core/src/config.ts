import { publicDrandUrls, quicknet } from "./lib/drand.ts"
import type { Parsed } from "./lib/parsed.ts"
import type { Platform } from "./platform/provider.ts"
import { cloudflarePlans, type CloudflarePlan } from "./plan/plan-limits.ts"
import { twitchLoginPattern } from "./twitch/lib/login.ts"
import {
  queuedEntryTwitchRequests,
  queuedEntryTwitchSubrequests,
} from "./twitch/queued-entry-requests.ts"

export type ConfigReason =
  | "missing"
  | "blank"
  | "not-a-boolean"
  | "not-an-integer"
  | "out-of-range"
  | "not-a-url"
  | "not-an-https-url"
  | "not-an-email"
  | "not-an-iso-date"
  | "requires-operator-name"
  | "not-a-header-name"
  | "not-a-chain-hash"
  | "not-at-least-drand-period"
  | "not-an-admin-entry"
  | "not-an-optional-platform"
  | "faked-platform-disabled"
  | "not-below-queue-code-max-age"
  | "above-queue-max-rate"
  | "not-below-eventsub-connection-max"
  | "not-above-queued-entry-twitch-time"
  | "below-claim-and-reroll-windows"
  | "fake-twitch-needs-local-public-url"
  | "fake-kick-needs-local-public-url"
  | "fake-youtube-needs-local-public-url"
  | "not-a-cloudflare-plan"
  | "not-a-login"
  | "not-a-sentry-dsn"

/** Why a setting failed; a list entry that is not a secret also names itself. */
export type ConfigIssue =
  | ConfigReason
  | {
      readonly reason: "not-an-admin-entry" | "not-an-optional-platform" | "faked-platform-disabled"
      readonly entry: string
    }

/** An invalid or missing setting. Carries the env key and a reason, never the value (it may be a secret); only a named list entry is quoted. */
export class ConfigError extends Error {
  readonly reason: ConfigReason
  readonly entry: string | null

  constructor(
    readonly env: string,
    issue: ConfigIssue,
  ) {
    const named = typeof issue === "string" ? { reason: issue, entry: null } : issue
    super(
      named.entry === null
        ? `${env}: ${named.reason}`
        : `${env}: ${named.reason} (${JSON.stringify(named.entry)})`,
    )
    this.reason = named.reason
    this.entry = named.entry
  }
}

/** One `ADMIN_TWITCH_IDS` entry: a Twitch user id, or a login that is resolved to an id on first use. */
export type AdminEntry =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "login"; readonly login: string }

/** The platforms an install can run without; Twitch is required, see `TWITCH_CLIENT_ID`. */
const optionalPlatforms = ["kick", "youtube"] as const satisfies readonly Platform[]

type OptionalPlatform = (typeof optionalPlatforms)[number]

/**
 * One setting: its env key, how to parse the raw string, its default as the raw string a deployment
 * would write (null means required), and where the number or choice comes from.
 */
export interface ConfigField<T> {
  readonly env: string
  readonly parse: (raw: string) => Parsed<T, ConfigIssue>
  readonly default: string | null
  readonly origin: string
}

export type ResolvedConfig = {
  readonly [K in keyof typeof configSchema]: (typeof configSchema)[K] extends ConfigField<infer T>
    ? T
    : never
}

// Spec Privacy promises deletion within 30 days.
const maxEntryRetentionSeconds = 2_592_000

type Env = Readonly<Record<string, string | undefined>>

export const configSchema = {
  twitchClientId: required(
    "TWITCH_CLIENT_ID",
    text,
    "Twitch app registration, see docs/self-hosting.md",
  ),
  twitchClientSecret: required(
    "TWITCH_CLIENT_SECRET",
    text,
    "Twitch app registration, see docs/self-hosting.md",
  ),
  kickClientId: withDefault(
    "KICK_CLIENT_ID",
    optional(text),
    "",
    "Kick app registration, see docs/self-hosting.md; blank turns Kick sign-in off, set together with KICK_CLIENT_SECRET",
  ),
  kickClientSecret: withDefault(
    "KICK_CLIENT_SECRET",
    optional(text),
    "",
    "Kick app registration, see docs/self-hosting.md; set together with KICK_CLIENT_ID",
  ),
  youtubeClientId: withDefault(
    "YOUTUBE_CLIENT_ID",
    optional(text),
    "",
    "Google OAuth web client of the YouTube Data API, see docs/self-hosting.md; blank turns YouTube sign-in off, set together with YOUTUBE_CLIENT_SECRET",
  ),
  youtubeClientSecret: withDefault(
    "YOUTUBE_CLIENT_SECRET",
    optional(text),
    "",
    "Google OAuth web client of the YouTube Data API, see docs/self-hosting.md; set together with YOUTUBE_CLIENT_ID",
  ),
  signInDisabledPlatforms: withDefault(
    "SIGN_IN_DISABLED_PLATFORMS",
    optionalPlatformList,
    "",
    "Platforms switched off for now, comma separated: kick, youtube; a listed platform behaves as if its client id were blank, for streamer sign-in and viewer entry, while its id and secret stay set; twitch cannot be listed; blank switches none off",
  ),
  tokenSealKeys: required(
    "TOKEN_SEAL_KEYS",
    list(text),
    "Key ring, comma separated, that seals stored streamer refresh tokens and winners' form answers",
  ),
  sessionSecret: required("SESSION_SECRET", text, "Signs the session cookie"),
  admins: required(
    "ADMIN_TWITCH_IDS",
    adminList,
    "Who may open the admin page, comma separated: numeric Twitch user ids, logins, or channel links such as https://twitch.tv/<login>; pin the ids, because logins are looked up at Twitch on first use",
  ),
  publicUrl: required("PUBLIC_URL", url, "Public origin of the service, used for OAuth redirects"),
  openSignup: withDefault(
    "OPEN_SIGNUP",
    bool,
    "false",
    "true lets every Twitch account that signs in create giveaways, as on the hosted service; false makes a new streamer wait until an admin approves the account on the admin page. Accounts in ADMIN_TWITCH_IDS are always allowed",
  ),
  streamerAccessListMax: withDefault(
    "STREAMER_ACCESS_LIST_MAX",
    int(1),
    "200",
    "Most pending and most approved streamers the admin page lists, newest first; starting guess, one screen of names",
  ),
  devFakeTwitch: withDefault(
    "DEV_FAKE_TWITCH",
    bool,
    "false",
    "Mounts the fake Twitch routes and the dev SPA; never true in production",
  ),
  devFakeKick: withDefault(
    "DEV_FAKE_KICK",
    bool,
    "false",
    "Mounts the fake Kick routes, whose app is KICK_CLIENT_ID and KICK_CLIENT_SECRET; never true in production",
  ),
  devFakeYouTube: withDefault(
    "DEV_FAKE_YOUTUBE",
    bool,
    "false",
    "Mounts the fake Google OAuth and YouTube routes, whose client is YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET; never true in production",
  ),
  defaultClaimSeconds: withDefault(
    "DEFAULT_CLAIM_SECONDS",
    int(1),
    "300",
    "Claim time after a draw when the giveaway sets none",
  ),
  roleRefreshSeconds: withDefault(
    "ROLE_REFRESH_SECONDS",
    int(1),
    "300",
    "Refresh of the VIP and moderator lists while entries are open",
  ),
  chatEntryCheckSeconds: withDefault(
    "CHAT_ENTRY_CHECK_SECONDS",
    int(1),
    "3",
    "Wait between two checks of the chatters who typed the entry keyword: each check reads their profiles and up to CHAT_ENTRY_FOLLOWER_CHECKS follows; starting guess",
  ),
  chatEntryFollowerChecks: withDefault(
    "CHAT_ENTRY_FOLLOWER_CHECKS",
    int(1),
    "15",
    "Most follow reads one check of chat entrants sends with the streamer's token; 15 every 3 seconds is 300 of the 800 Helix points a minute the streamer's token has, and with a retried 503 each, a token refresh and the profile read it stays inside the 45 subrequests of a Cloudflare Free invocation",
  ),
  liveIntervalMs: withDefault(
    "LIVE_INTERVAL_MS",
    int(1),
    "1000",
    "Shortest time between live page pushes",
  ),
  liveLastNames: withDefault(
    "LIVE_LAST_NAMES",
    int(0),
    "20",
    "Latest entrant names on the live page",
  ),
  liveShuffleNames: withDefault(
    "LIVE_SHUFFLE_NAMES",
    int(1),
    "50",
    "Random entrant names a live push carries while a draw is pending, for the shuffle animation; starting guess, about 1 KB per push",
  ),
  liveWinnerImages: withDefault(
    "LIVE_WINNER_IMAGES",
    int(0),
    "24",
    "Newest picks whose profile picture a live push carries; older picks go without, so a batch of 500 winners stays near 70 KB per push instead of 125 KB; the stage shows the newest pick",
  ),
  liveEntrantsPerPush: withDefault(
    "LIVE_ENTRANTS_PER_PUSH",
    int(1),
    "200",
    "Most new entrants one live push carries; a bigger backlog makes the page fetch the gap over HTTP; starting guess, about 20 KB of JSON per push at 100 bytes per entrant",
  ),
  liveWinnerChatMax: withDefault(
    "LIVE_WINNER_CHAT_MAX",
    int(1),
    "20",
    "Newest chat messages kept per winner for the live page; starting guess: 20 messages of at most 500 characters is about 10 KB per push, throttled by LIVE_INTERVAL_MS",
  ),
  entrantsPageMax: withDefault(
    "ENTRANTS_PAGE_MAX",
    int(1),
    "5000",
    "Most entrants one entrants request returns, so 12,000 entrants load in three requests; starting guess, about 500 KB of JSON per page",
  ),
  channelBadgesTtlSeconds: withDefault(
    "CHANNEL_BADGES_TTL_SECONDS",
    int(1),
    "3600",
    "How long a process keeps a channel's subscriber badge images before it asks Twitch again; a channel changes its badges rarely and one read costs two Helix calls, so starting guess, one hour",
  ),
  queuePollSeconds: withDefault(
    "QUEUE_POLL_SECONDS",
    int(1),
    "3",
    "Page poll interval for a queued entry",
  ),
  queuePollMaxSeconds: withDefault(
    "QUEUE_POLL_MAX_SECONDS",
    int(1),
    "120",
    "Page stops polling a queued entry after this",
  ),
  queueCodeMaxAgeSeconds: withDefault(
    "QUEUE_CODE_MAX_AGE_SECONDS",
    int(1),
    "300",
    "Queued authorization codes older than this are dropped",
  ),
  queueProcessingTimeoutSeconds: withDefault(
    "QUEUE_PROCESSING_TIMEOUT_SECONDS",
    int(1),
    "60",
    "A queued code claimed for processing returns to the queue after this long without a result, so a crashed pass does not strand it; must exceed the sequential Twitch requests of one code times TWITCH_TIMEOUT_MS, 60 is a starting guess",
  ),
  queueCooldownSeconds: withDefault(
    "QUEUE_COOLDOWN_SECONDS",
    int(0),
    "2",
    "Pause after a token endpoint 429 before the queue calls the endpoint again; a few seconds so a short Twitch window can reset without stalling the drain, starting guess",
  ),
  queueMinRatePerSecond: withDefault(
    "QUEUE_MIN_RATE_PER_SECOND",
    int(1),
    "1",
    "Floor of the queue's drain rate, a safety rail for a 429 with no measured rate; starting guess",
  ),
  queueMaxRatePerSecond: withDefault(
    "QUEUE_MAX_RATE_PER_SECOND",
    int(1),
    "500",
    "Ceiling of the queue's drain rate, a safety rail: one pass processes this many codes at once, each with the Twitch requests of one entry and a room write; starting guess above 400 sign-ins per second",
  ),
  queueDecreasePercent: withDefault(
    "QUEUE_DECREASE_PERCENT",
    int(1, 99),
    "67",
    "After a 429 the queue drains at this percent of the rate that triggered it",
  ),
  queueIncreaseStepPerSecond: withDefault(
    "QUEUE_INCREASE_STEP_PER_SECOND",
    int(1),
    "10",
    "The drain rate grows by this many calls per second every QUEUE_INCREASE_INTERVAL_SECONDS until the next 429; starting guess",
  ),
  queueIncreaseIntervalSeconds: withDefault(
    "QUEUE_INCREASE_INTERVAL_SECONDS",
    int(1),
    "1",
    "How often the drain rate grows by QUEUE_INCREASE_STEP_PER_SECOND; starting guess",
  ),
  queueBacklogLeaseSeconds: withDefault(
    "QUEUE_BACKLOG_LEASE_SECONDS",
    int(1),
    "3",
    "Longest one enqueue answer keeps an app instance sending new codes to the queue; every later enqueue renews it, so routing follows the backlog within seconds; starting guess",
  ),
  queueSubrequestsPerInvocation: withDefault(
    "QUEUE_SUBREQUESTS_PER_INVOCATION",
    optional(int(queuedEntryTwitchSubrequests)),
    "",
    "External subrequests one queue alarm invocation may send on Cloudflare; a pass larger than the codes that fit spreads over several invocations. Blank takes the value of the current Cloudflare plan (Free 45 of 50, Paid 9000 of 10000, see packages/core/src/plan/plan-limits.ts); set it only when the Worker's subrequest limit differs, for example a lower `limits.subrequests` in wrangler; the Bun target ignores it",
  ),
  queueRateWindowSeconds: withDefault(
    "QUEUE_RATE_WINDOW_SECONDS",
    int(1),
    "1",
    "At a 429 on the direct path the queue takes the entries the giveaway's room wrote in this many seconds before it as the rate that triggered the 429; one second matches a per-second limit, starting guess",
  ),
  entryWriteRetryDelaysMs: withDefault(
    "ENTRY_WRITE_RETRY_DELAYS_MS",
    list(int(0)),
    "200,500,1000",
    "Delay before each retry of a failed room write, so also the retry count",
  ),
  entryWriteJitterPercent: withDefault(
    "ENTRY_WRITE_JITTER_PERCENT",
    int(0, 100),
    "50",
    "Random share added to or removed from each retry delay; starting guess",
  ),
  helixRetryDelayMs: withDefault(
    "HELIX_RETRY_DELAY_MS",
    int(0),
    "500",
    "Wait before the single retry of a Helix 503; the delay is a starting guess",
  ),
  twitchIdBaseUrl: withDefault(
    "TWITCH_ID_BASE_URL",
    url,
    "https://id.twitch.tv",
    "Origin of Twitch OAuth (authorize, token, keys, validate); only tests and the fake Twitch change it",
  ),
  twitchHelixBaseUrl: withDefault(
    "TWITCH_HELIX_BASE_URL",
    url,
    "https://api.twitch.tv",
    "Origin of the Twitch Helix API; only tests and the fake Twitch change it",
  ),
  twitchTimeoutMs: withDefault(
    "TWITCH_TIMEOUT_MS",
    int(1),
    "5000",
    "Timeout of every outbound Twitch call; starting guess",
  ),
  kickIdBaseUrl: withDefault(
    "KICK_ID_BASE_URL",
    url,
    "https://id.kick.com",
    "Origin of Kick OAuth (authorize, token); only tests and the fake Kick change it",
  ),
  kickApiBaseUrl: withDefault(
    "KICK_API_BASE_URL",
    url,
    "https://api.kick.com",
    "Origin of the Kick public API (users, channels, event subscriptions, webhook public key); only tests and the fake Kick change it",
  ),
  kickTimeoutMs: withDefault(
    "KICK_TIMEOUT_MS",
    int(1),
    "5000",
    "Timeout of every outbound Kick call; starting guess, the same as TWITCH_TIMEOUT_MS",
  ),
  kickWebhookMaxAgeSeconds: withDefault(
    "KICK_WEBHOOK_MAX_AGE_SECONDS",
    int(1),
    "300",
    "A Kick webhook whose signed timestamp is further than this from now, either way, is refused as a replay; Kick names no window, five minutes is a starting guess that allows clock skew",
  ),
  kickPublicKeyRefreshSeconds: withDefault(
    "KICK_PUBLIC_KEY_REFRESH_SECONDS",
    int(1),
    "60",
    "Least time between two reads of Kick's webhook public key after a signature fails, so forged webhooks cannot make the Worker fetch the key on every request; starting guess",
  ),
  kickOrphanRetrySeconds: withDefault(
    "KICK_ORPHAN_RETRY_SECONDS",
    int(1),
    "300",
    "Least time between two attempts to cancel a Kick chat subscription whose webhooks find no watching giveaway; each attempt is one Kick call, so a busy chat sends at most one per this time; starting guess",
  ),
  kickSubscribeRetryDelaySeconds: withDefault(
    "KICK_SUBSCRIBE_RETRY_DELAY_SECONDS",
    int(1),
    "5",
    "Wait before the next attempt to subscribe to a channel's Kick chat after one failed; starting guess, Kick publishes no rate limits",
  ),
  kickSubscribeMaxAttempts: withDefault(
    "KICK_SUBSCRIBE_MAX_ATTEMPTS",
    int(1),
    "3",
    "Attempts to subscribe to a channel's Kick chat before the room shows chat claim unavailable; starting guess",
  ),
  youtubeAuthBaseUrl: withDefault(
    "YOUTUBE_AUTH_BASE_URL",
    url,
    "https://accounts.google.com",
    "Origin of Google's OAuth consent page; only tests change it",
  ),
  youtubeTokenBaseUrl: withDefault(
    "YOUTUBE_TOKEN_BASE_URL",
    url,
    "https://oauth2.googleapis.com",
    "Origin of Google's OAuth token and token info endpoints; only tests change it",
  ),
  youtubeApiBaseUrl: withDefault(
    "YOUTUBE_API_BASE_URL",
    url,
    "https://www.googleapis.com",
    "Origin of the YouTube Data API v3 (channels, live broadcasts, live chat messages); only tests change it",
  ),
  youtubeTimeoutMs: withDefault(
    "YOUTUBE_TIMEOUT_MS",
    int(1),
    "5000",
    "Timeout of every outbound Google and YouTube call; starting guess, the same as TWITCH_TIMEOUT_MS",
  ),
  youtubeDailyQuotaUnits: withDefault(
    "YOUTUBE_DAILY_QUOTA_UNITS",
    int(1),
    "10000",
    "YouTube Data API units the install spends per Pacific day, counted per call in the accounts database; a chat watch stops and a giveaway that would pass it is refused; 10,000 is Google's default quota of a project, raise it only after Google granted more",
  ),
  youtubeQuotaAlertPercent: withDefault(
    "YOUTUBE_QUOTA_ALERT_PERCENT",
    int(1, 100),
    "70",
    "The admin page warns once today's YouTube units reach this percent of YOUTUBE_DAILY_QUOTA_UNITS, so there is time to ask Google for more quota",
  ),
  youtubeChatPollMinMs: withDefault(
    "YOUTUBE_CHAT_POLL_MIN_MS",
    int(1000),
    "5000",
    "Least wait between two reads of a YouTube live chat, whatever shorter interval YouTube suggests; each read costs 5 units, so 5 seconds is 60 units a minute, which is also the rate the create form estimates with; starting guess",
  ),
  youtubeWinnerPollMinMs: withDefault(
    "YOUTUBE_WINNER_POLL_MIN_MS",
    int(1000),
    "30000",
    "Least wait between two reads of a YouTube live chat after the draw, while only winners' claims are read: 30 seconds is 10 units a minute, and a claim still lands well within a claim time of minutes; starting guess",
  ),
  youtubeChatRetryDelaySeconds: withDefault(
    "YOUTUBE_CHAT_RETRY_DELAY_SECONDS",
    int(1),
    "5",
    "Wait before the next read of a YouTube live chat after one failed; starting guess",
  ),
  youtubeChatMaxAttempts: withDefault(
    "YOUTUBE_CHAT_MAX_ATTEMPTS",
    int(1),
    "3",
    "Failed reads of a YouTube live chat in a row before the room shows chat entry or chat claim unavailable; starting guess",
  ),
  youtubeBroadcastRetrySeconds: withDefault(
    "YOUTUBE_BROADCAST_RETRY_SECONDS",
    int(1),
    "60",
    "Wait between two looks for the streamer's active YouTube broadcast while a giveaway waits for its chat, so a giveaway made before the stream starts finds the chat once it does; each look costs 1 unit; starting guess",
  ),
  eventSubUrl: withDefault(
    "EVENTSUB_URL",
    socketUrl,
    "wss://eventsub.wss.twitch.tv/ws",
    "Twitch EventSub WebSocket endpoint; only tests and the fake Twitch change it",
  ),
  eventSubSubscribeSeconds: withDefault(
    "EVENTSUB_SUBSCRIBE_SECONDS",
    int(1),
    "10",
    "Time after the connection opens to subscribe before Twitch closes it; Twitch limit",
  ),
  eventSubConnectionMaxSeconds: withDefault(
    "EVENTSUB_CONNECTION_MAX_SECONDS",
    int(1),
    "900",
    "Longest a connection is kept before it is replaced; a Cloudflare Durable Object keeps an outbound WebSocket about 15 minutes",
  ),
  eventSubReconnectMarginSeconds: withDefault(
    "EVENTSUB_RECONNECT_MARGIN_SECONDS",
    int(0),
    "60",
    "Replace a connection this long before EVENTSUB_CONNECTION_MAX_SECONDS, so 14 of the 15 minutes; starting guess",
  ),
  eventSubKeepaliveGraceSeconds: withDefault(
    "EVENTSUB_KEEPALIVE_GRACE_SECONDS",
    int(0),
    "5",
    "Wait beyond the keepalive timeout Twitch announces before the connection counts as lost; starting guess",
  ),
  eventSubReconnectDelaySeconds: withDefault(
    "EVENTSUB_RECONNECT_DELAY_SECONDS",
    int(0),
    "2",
    "Wait before reconnecting after a failed or lost connection; starting guess",
  ),
  eventSubReconnectMaxAttempts: withDefault(
    "EVENTSUB_RECONNECT_MAX_ATTEMPTS",
    int(1),
    "5",
    "Reconnects in a row before the live page shows Chat claim unavailable; starting guess",
  ),
  validatePeriodSeconds: withDefault(
    "VALIDATE_PERIOD_SECONDS",
    int(1),
    "3600",
    "Streamer token validation period; Twitch requires hourly",
  ),
  sessionTtlSeconds: withDefault(
    "SESSION_TTL_SECONDS",
    int(1),
    "604800",
    "Lifetime of the streamer session cookie; starting guess, 7 days",
  ),
  viewerSessionTtlSeconds: withDefault(
    "VIEWER_SESSION_TTL_SECONDS",
    int(1),
    "2592000",
    "Lifetime of the viewer cookie that lets a returning viewer see their result without signing in again; starting guess, 30 days",
  ),
  stateCookieTtlSeconds: withDefault(
    "STATE_COOKIE_TTL_SECONDS",
    int(1),
    "600",
    "Lifetime of the OAuth state cookie; OAuth advises at most 10 minutes for a code",
  ),
  ticketsPerGroupMax: withDefault(
    "TICKETS_PER_GROUP_MAX",
    int(1),
    "1000",
    "Most tickets a streamer can give one group, which keeps ticket totals far inside safe integers; starting guess; a lower value makes stored giveaways above it unreadable",
  ),
  claimSecondsMax: withDefault(
    "CLAIM_SECONDS_MAX",
    int(1),
    "86400",
    "Longest claim time a streamer can set; starting guess, one day",
  ),
  drawMaxWinners: withDefault(
    "DRAW_MAX_WINNERS",
    int(1),
    "500",
    "Most picks one giveaway holds, rerolled ones included, and the most planned winners a streamer can set; starting guess, every pick is a row the verify page replays",
  ),
  publicGiveawayCacheSeconds: withDefault(
    "PUBLIC_GIVEAWAY_CACHE_SECONDS",
    int(0),
    "5",
    "How long the public part of a giveaway page response is reused, so an anonymous refresh reads neither the account store nor the room; the entrant count can be this stale, 0 turns the cache off; starting guess",
  ),
  publicHistoryCacheSeconds: withDefault(
    "PUBLIC_HISTORY_CACHE_SECONDS",
    int(0),
    "300",
    "How long a streamer's public history page answer is reused, so a repeated view reads no D1; turning the page off, hiding or deleting a giveaway drops the copy of the data centre that saved it at once, while other data centres and a newly drawn giveaway show the change after at most this long; 0 turns the cache off; the Cloudflare Cache API stores nothing on a workers.dev address; starting guess, a history changes rarely",
  ),
  publicHistoryMax: withDefault(
    "PUBLIC_HISTORY_MAX",
    int(1),
    "20",
    "Most giveaways, latest close first, a streamer's public history page lists; they come from one D1 query with the counts the rooms mirrored, so the bound only keeps the page short; starting guess",
  ),
  publicCacheMaxEntries: withDefault(
    "PUBLIC_CACHE_MAX_ENTRIES",
    int(1),
    "64",
    "Most entries the Bun server keeps in its in-memory public cache; the oldest is dropped beyond it; a leaf list is up to about a megabyte, so the default holds about 64 MB at worst; starting guess; the Cloudflare target uses the Cache API and ignores it",
  ),
  recentWinnersGiveawaysMax: withDefault(
    "RECENT_WINNERS_GIVEAWAYS_MAX",
    int(1, 20),
    "10",
    "Most earlier giveaways a streamer can keep the winners of out of a new giveaway, and the most rooms the days option reads; creating such a giveaway reads the winners of each from its room, one Durable Object subrequest apiece, so the bound of 20 stays inside the Free plan's 50 subrequests next to the creation's own calls; 10 is a starting guess",
  ),
  recentWinnersDaysMax: withDefault(
    "RECENT_WINNERS_DAYS_MAX",
    int(1),
    "90",
    "Most days back a streamer can keep earlier winners out of a new giveaway; winners of giveaways deleted by HISTORY_RETENTION_DAYS or by the streamer are gone; starting guess, a season of streams",
  ),
  chatBotLogins: withDefault(
    "CHAT_BOT_LOGINS",
    loginList,
    "nightbot,streamelements,moobot,fossabot,streamlabs,wizebot,sery_bot,soundalerts",
    "Twitch logins of chat bots that are never entered into any giveaway, comma separated, case-insensitive; blank enters every account; the default lists widely used bots; a streamer's own bots go on their block list",
  ),
  blockListMax: withDefault(
    "BLOCK_LIST_MAX",
    int(1),
    "500",
    "Most accounts one streamer can block; a room gets the whole list at each edit; starting guess, far above a list kept by hand",
  ),
  blockListPushMax: withDefault(
    "BLOCK_LIST_PUSH_MAX",
    int(0, 45),
    "40",
    "Most open giveaways, newest first, a block list edit sends the list to, one Durable Object subrequest apiece; the others get it from the entry flow before their next entry; the bound of 45 leaves the edit's own calls room inside the Free plan's 50 subrequests, 40 is a starting guess",
  ),
  claimKeywordMaxLength: withDefault(
    "CLAIM_KEYWORD_MAX_LENGTH",
    int(1),
    "32",
    "Longest claim keyword and chat entry keyword a streamer can set; starting guess",
  ),
  excludedCountriesMaxLength: withDefault(
    "EXCLUDED_COUNTRIES_MAX_LENGTH",
    int(1),
    "200",
    "Longest list of places whose residents cannot win that a streamer can type into a giveaway's rules; starting guess, a sentence",
  ),
  extraTermsMaxLength: withDefault(
    "EXTRA_TERMS_MAX_LENGTH",
    int(1),
    "1000",
    "Longest extra terms a streamer can add under a giveaway's generated rules; starting guess, a few short paragraphs",
  ),
  codeInsertRetries: withDefault(
    "CODE_INSERT_RETRIES",
    int(1),
    "5",
    "New short codes tried after a UNIQUE violation; starting guess",
  ),
  usageWarningThreshold: withDefault(
    "USAGE_WARNING_THRESHOLD",
    int(0),
    "25000",
    "Warn at giveaway creation below this many Worker requests left",
  ),
  liveRateWindowSeconds: withDefault(
    "LIVE_RATE_WINDOW_SECONDS",
    int(1),
    "10",
    "Entries are counted over this window for the entries per second on the live page; starting guess",
  ),
  mirrorRetrySeconds: withDefault(
    "MIRROR_RETRY_SECONDS",
    int(1),
    "30",
    "Wait before the room alarm retries a status mirror to the account store; starting guess",
  ),
  rerollWindowSeconds: withDefault(
    "REROLL_WINDOW_SECONDS",
    int(0),
    "3600",
    "How long after the last claim time a streamer can still reroll an unclaimed pick; after it the giveaway is finished and viewers stop listening; starting guess, one hour",
  ),
  entryRetentionSeconds: withDefault(
    "ENTRY_RETENTION_SECONDS",
    int(1, maxEntryRetentionSeconds),
    "2592000",
    "How long after a giveaway closes its entrants' personal data (login, display name, profile picture URL, group, tickets, channel role lists) is kept before the room alarm deletes it; the privacy policy promises 30 days, so more than that is rejected; it must not be below CLAIM_SECONDS_MAX plus REROLL_WINDOW_SECONDS, or a winner could still be claimed or rerolled after the entrants are gone",
  ),
  entryRetentionSweepBatch: withDefault(
    "ENTRY_RETENTION_SWEEP_BATCH",
    int(1),
    "100",
    "Most closed giveaways the hourly Cloudflare cron wakes to arm their retention deletion; each costs one Durable Object request; starting guess, a backlog of 1000 closed giveaways clears in ten runs",
  ),
  entryRetentionSweepMaxAttempts: withDefault(
    "ENTRY_RETENTION_SWEEP_MAX_ATTEMPTS",
    int(1),
    "5",
    "Failed sweeps after which the hourly cron stops waking the room of a closed giveaway and logs an error; a failing room sorts behind the others meanwhile; starting guess, about five hours of hourly runs",
  ),
  historyRetentionDays: withDefault(
    "HISTORY_RETENTION_DAYS",
    optional(int(1)),
    "",
    "Days after its close a drawn giveaway is deleted with its winners and draw proof by the hourly sweep; blank keeps every giveaway until its streamer deletes it and runs no sweep, which is what the privacy page promises by default",
  ),
  historyRetentionSweepBatch: withDefault(
    "HISTORY_RETENTION_SWEEP_BATCH",
    int(1),
    "100",
    "Most expired giveaways one hourly sweep deletes while HISTORY_RETENTION_DAYS is set; each costs one room request and one account store write; starting guess, the same as ENTRY_RETENTION_SWEEP_BATCH",
  ),
  winnerFormRetentionSeconds: withDefault(
    "WINNER_FORM_RETENTION_SECONDS",
    int(1, maxEntryRetentionSeconds),
    "2592000",
    "How long after the claim a winner's form answers (such as a shipping address) are kept before the room alarm deletes them, unless the streamer marks the prize delivered first; the winner can send the form only within this time; the privacy policy promises 30 days, so more than that is rejected",
  ),
  winnerAnswerMaxLength: withDefault(
    "WINNER_ANSWER_MAX_LENGTH",
    int(1),
    "300",
    "Longest answer in characters to one field of the winner form, an address included; starting guess, a postal address on four lines",
  ),
  entryUserLimitPerMinute: withDefault(
    "ENTRY_USER_LIMIT_PER_MINUTE",
    int(1),
    "10",
    "Verified sign-ins one platform user id may make per minute before the entry flow answers rate-limited; starting guess, a viewer needs one and a few retries; the Bun server reads it, the Cloudflare target takes the limit from wrangler.jsonc, where a test keeps the default equal",
  ),
  entryIpLimitPerMinute: withDefault(
    "ENTRY_IP_LIMIT_PER_MINUTE",
    int(1),
    "60",
    "Viewer sign-in callbacks one client address may make per minute; a loose backstop because mobile networks put many viewers behind one address; the Bun server reads it, the Cloudflare target takes the limit from wrangler.jsonc, where a test keeps the default equal",
  ),
  leavesIpLimitPerMinute: withDefault(
    "LEAVES_IP_LIMIT_PER_MINUTE",
    int(1),
    "20",
    'Leaf list downloads one client address may make per minute when the list is not in the cache, and apart from those as many "Am I in?" lookups by login; each wakes the giveaway\'s room and a leaf list carries up to a megabyte; a verify page loads it once and a viewer looks up a login a few times, so this is a loose backstop (starting guess); the Bun server reads it, the Cloudflare target takes the limit from wrangler.jsonc, where a test keeps the default equal',
  ),
  presenceIpLimitPerMinute: withDefault(
    "PRESENCE_IP_LIMIT_PER_MINUTE",
    int(1),
    "30",
    "Presence sockets one client address may open per minute; a tab opens one per page kind it shows and one per reconnect, so this only caps a client that reconnects in a loop (starting guess); the Bun server reads it, the Cloudflare target takes the limit from wrangler.jsonc, where a test keeps the default equal",
  ),
  moderatorIpLimitPerMinute: withDefault(
    "MODERATOR_IP_LIMIT_PER_MINUTE",
    int(1),
    "10",
    "Moderator links one client address may open per minute; opening one is a single call, and its 128-bit token is not guessable anyway, so this only caps the cost of attempts (starting guess); the Bun server reads it, the Cloudflare target takes the limit from wrangler.jsonc, where a test keeps the default equal",
  ),
  moderatorRecheckSeconds: withDefault(
    "MODERATOR_RECHECK_SECONDS",
    int(1),
    "600",
    "How long a moderator's button presses trust the last answer that they still moderate the channel, for links that require a moderator; each check is one Helix call with the streamer's token, and a demoted moderator keeps acting at most this long (starting guess)",
  ),
  leavesCacheSeconds: withDefault(
    "LEAVES_CACHE_SECONDS",
    int(0),
    "86400",
    "How long a committed leaf list is kept in the public cache, so a repeat download reads neither D1 nor a Durable Object; the list never changes once committed, a day is a starting guess; 0 turns it off; the Cloudflare Cache API stores nothing on a workers.dev address",
  ),
  clientIpHeader: withDefault(
    "CLIENT_IP_HEADER",
    optional(headerName),
    "",
    "Request header in which the reverse proxy in front of the Bun server puts the client address, such as CF-Connecting-IP behind Cloudflare or X-Forwarded-For behind Caddy; when the value lists several addresses the last one counts, which is the one the nearest proxy appended; blank uses the address of the connection, right when nothing sits in front of the server, and behind a proxy it is the proxy's address, so every viewer shares one ENTRY_IP_LIMIT_PER_MINUTE; set it only when a proxy overwrites that header, or a client can write its own address; the Cloudflare target ignores it",
  ),
  titleMaxLength: withDefault(
    "TITLE_MAX_LENGTH",
    int(1),
    "100",
    "Longest giveaway title in characters; starting guess, one line on the giveaway page and the overlay",
  ),
  prizeMaxLength: withDefault(
    "PRIZE_MAX_LENGTH",
    int(1),
    "200",
    "Longest giveaway prize in characters; starting guess, a sentence",
  ),
  drandUrl: withDefault(
    "DRAND_URL",
    url,
    publicDrandUrls[0],
    "Origin of the drand HTTP API the draw reads its round from; only tests change it",
  ),
  drandChainHash: withDefault(
    "DRAND_CHAIN_HASH",
    chainHash,
    quicknet.chainHash,
    "Hash of the drand chain the draw trusts, which is also the path of every round request; the default is the quicknet beacon",
  ),
  drandGenesisSeconds: withDefault(
    "DRAND_GENESIS_SECONDS",
    int(0),
    String(quicknet.genesisSeconds),
    "Unix time of round 1 of DRAND_CHAIN_HASH; the default is the quicknet beacon, read from its /info",
  ),
  drandPeriodSeconds: withDefault(
    "DRAND_PERIOD_SECONDS",
    int(1),
    String(quicknet.periodSeconds),
    "Seconds between rounds of DRAND_CHAIN_HASH; the default is the quicknet beacon, read from its /info",
  ),
  drandLeadSeconds: withDefault(
    "DRAND_LEAD_SECONDS",
    int(0),
    "6",
    "A giveaway commits to the first drand round at least this long after the commit, so nobody knows its value yet; two quicknet periods, a starting guess",
  ),
  drandPublishMarginSeconds: withDefault(
    "DRAND_PUBLISH_MARGIN_SECONDS",
    int(0),
    "30",
    "A drand round still missing this long after its time counts as a failed beacon, not as an early draw; ten rounds of quicknet, a starting guess",
  ),
  drandRetryDelaysMs: withDefault(
    "DRAND_RETRY_DELAYS_MS",
    list(int(0)),
    "200,500,1000",
    "Delay before each retry of a drand round that failed or is not published yet, so also the retry count; same shape as the entry write retry",
  ),
  drandRetryJitterPercent: withDefault(
    "DRAND_RETRY_JITTER_PERCENT",
    int(0, 100),
    "50",
    "Random share added to or removed from each drand retry delay; starting guess",
  ),
  drandTimeoutMs: withDefault(
    "DRAND_TIMEOUT_MS",
    int(1),
    "5000",
    "Timeout of every drand request; starting guess",
  ),
  commitRetrySeconds: withDefault(
    "COMMIT_RETRY_SECONDS",
    int(1),
    "30",
    "Wait before the room alarm retries a commitment (Merkle root and drand round) that failed; starting guess",
  ),
  commitMaxAttempts: withDefault(
    "COMMIT_MAX_ATTEMPTS",
    int(1, 20),
    "6",
    "Commit attempts of a closed room's alarm before it gives up and logs an error, so a commit that always fails stops waking the Durable Object; the wait doubles from COMMIT_RETRY_SECONDS, so the default gives up about 30 minutes after the close; the bound of 20 keeps the doubling wait below a year; a draw still tries to commit; starting guess",
  ),
  dataDir: withDefault(
    "DATA_DIR",
    text,
    "./data",
    "Folder of the Bun server's SQLite files (accounts, token queue, one per room); the Cloudflare target ignores it",
  ),
  port: withDefault(
    "PORT",
    int(0, 65_535),
    "3000",
    "Port the Bun server listens on, 0 picks a free one; the Cloudflare target ignores it",
  ),
  cloudflareAccountId: withDefault(
    "CLOUDFLARE_ACCOUNT_ID",
    optional(text),
    "",
    "Cloudflare account whose Worker and Durable Object requests the usage meter reads; with the API token unset the meter reports no limit; only the Cloudflare target reads it",
  ),
  cloudflareApiToken: withDefault(
    "CLOUDFLARE_API_TOKEN",
    optional(text),
    "",
    "Cloudflare API token with Account Analytics read permission; with the account id unset the meter reports no limit; only the Cloudflare target reads it",
  ),
  cloudflareUsageUrl: withDefault(
    "CLOUDFLARE_USAGE_URL",
    endpoint,
    "https://api.cloudflare.com/client/v4/graphql",
    "Cloudflare GraphQL Analytics endpoint; only tests change it",
  ),
  cloudflareUsageTimeoutMs: withDefault(
    "CLOUDFLARE_USAGE_TIMEOUT_MS",
    int(1),
    "5000",
    "Timeout of the Analytics call behind the admin page and the creation warning; starting guess",
  ),
  cloudflarePlan: withDefault(
    "CLOUDFLARE_PLAN",
    cloudflarePlan,
    "free",
    "Cloudflare Workers plan (free or paid) the usage meter and the token queue assume until an admin switches it on the admin page, which stores the choice in the accounts database; only the Cloudflare target reads it",
  ),
  workerRequestLimit: withDefault(
    "WORKER_REQUEST_LIMIT",
    optional(int(1)),
    "",
    "Worker requests per UTC day the usage meter compares against, overriding the plan (Free 100,000, Paid no daily limit); blank takes the plan's value; only the Cloudflare target reads it",
  ),
  durableObjectRequestLimit: withDefault(
    "DURABLE_OBJECT_REQUEST_LIMIT",
    optional(int(1)),
    "",
    "Durable Object requests per UTC day the usage meter compares against, overriding the plan (Free 100,000, Paid no daily limit); blank takes the plan's value; only the Cloudflare target reads it",
  ),
  usageAlertPercent: withDefault(
    "USAGE_ALERT_PERCENT",
    int(1, 100),
    "70",
    "The admin page warns once today's Worker or Durable Object requests reach this percent of the daily limit, so there is time to pay for Workers Paid and switch",
  ),
  adminStatsCacheSeconds: withDefault(
    "ADMIN_STATS_CACHE_SECONDS",
    int(0),
    "5",
    "How long the admin statistics answer is reused, so two admins with the page open cost one set of reads; the page polls every 10 seconds; 0 turns the cache off; starting guess",
  ),
  adminStatsLiveRoomsMax: withDefault(
    "ADMIN_STATS_LIVE_ROOMS_MAX",
    int(0, 30),
    "20",
    "Most open giveaways one admin statistics request asks for live counts, newest first; each costs one Durable Object subrequest on Cloudflare; a request makes 14 other subrequests (session, 2 open giveaways, queue, presence, plan, usage, minutes, 3 daily counts, referrals, 2 access lists), so the Free plan's 50 holds up to 30 and 20 leaves headroom; the rest show as a number",
  ),
  adminStatsSeriesMinutes: withDefault(
    "ADMIN_STATS_SERIES_MINUTES",
    int(1),
    "60",
    "Minutes the admin page's entries, claims and 429 chart covers",
  ),
  adminStatsDays: withDefault(
    "ADMIN_STATS_DAYS",
    int(1),
    "14",
    "Days the admin page's growth chart and referral list cover, and how long daily referral counts are kept",
  ),
  adminStatsReturnDays: withDefault(
    "ADMIN_STATS_RETURN_DAYS",
    int(1),
    "30",
    "A streamer counts as returning when their second giveaway came within this many days of their first",
  ),
  adminStatsRefsMax: withDefault(
    "ADMIN_STATS_REFS_MAX",
    int(1),
    "20",
    "Most referral sources the admin page lists, the busiest first; starting guess, one screen",
  ),
  metricsRetentionHours: withDefault(
    "METRICS_RETENTION_HOURS",
    int(1),
    "24",
    "How long the per-minute entry, claim and 429 counters are kept before the writer deletes them; the chart reads only the last ADMIN_STATS_SERIES_MINUTES",
  ),
  referralVisitsPerDayMax: withDefault(
    "REFERRAL_VISITS_PER_DAY_MAX",
    int(1),
    "2000",
    "Most ?ref= visits counted per UTC day in all; each costs a D1 write and the Free plan allows 100,000 row writes a day, so this bounds what a flood of visits can use; starting guess, far above the visits of a small site",
  ),
  referralSourcesPerDayMax: withDefault(
    "REFERRAL_SOURCES_PER_DAY_MAX",
    int(1),
    "100",
    "Most different ?ref= values counted per UTC day; a new value beyond it is ignored, so a visitor cannot grow the table by inventing values; starting guess",
  ),
  donateUrl: withDefault(
    "DONATE_URL",
    optional(httpsUrl),
    "",
    "HTTPS page where people can support this deployment; the home page, the dashboard, the account menu and the streamer's live page link to it, never a viewer page or the overlay; blank shows no link",
  ),
  operatorName: withDefault(
    "OPERATOR_NAME",
    optional(text),
    "",
    "Who runs this instance (a person or a company); the privacy policy and the terms name them as the controller of the data; OPERATOR_EMAIL is then required and the other OPERATOR_* keys and LEGAL_UPDATED only work with it; blank shows a generic text saying the operator has published no details; whoever runs an instance is responsible for these texts",
  ),
  operatorAddress: withDefault(
    "OPERATOR_ADDRESS",
    optional(text),
    "",
    "Postal address of the operator, shown in the privacy policy and the terms; blank leaves it out",
  ),
  operatorId: withDefault(
    "OPERATOR_ID",
    optional(text),
    "",
    "Business or company registration number of the operator, shown next to the name; blank leaves it out",
  ),
  operatorEmail: withDefault(
    "OPERATOR_EMAIL",
    optional(email),
    "",
    "Contact e-mail of the operator for data requests and questions about the terms; required with OPERATOR_NAME because the privacy policy must name a contact (GDPR Article 13(1)(a))",
  ),
  legalUpdated: withDefault(
    "LEGAL_UPDATED",
    optional(isoDate),
    "",
    "Date (YYYY-MM-DD) shown as the last update of the privacy policy and the terms; blank shows the date of the template text shipped with Rafflink",
  ),
  sentryDsn: withDefault(
    "SENTRY_DSN",
    optional(sentryDsn),
    "",
    "Sentry DSN the Worker or the Bun server reports its errors to; blank reports nothing. The browser's DSN is PUBLIC_SENTRY_DSN of the web build, see docs/self-hosting.md",
  ),
  sentryEnvironment: withDefault(
    "SENTRY_ENVIRONMENT",
    text,
    "production",
    "Environment the error reports carry, such as production or staging; the web build reads it too",
  ),
  sentryRelease: withDefault(
    "SENTRY_RELEASE",
    optional(text),
    "",
    "Release the error reports carry: the commit the deployment was built from, which must match the release CI uploaded the source maps for; the web build reads it too; blank sends none",
  ),
  sentrySamplePercent: withDefault(
    "SENTRY_SAMPLE_PERCENT",
    int(0, 100),
    "100",
    "Percent of errors sent to Sentry; lower it when one noisy error would use up the 5,000 errors a month of the Sentry free plan; the web build reads it too",
  ),
}

/** Settings only the web build reads: it writes them into the page, so they are fixed when the page is built. */
export const webBuildSchema = {
  sentryDsn: withDefault(
    "PUBLIC_SENTRY_DSN",
    optional(sentryDsn),
    "",
    "Sentry DSN the browser reports its errors to, written into the page by the web build, see docs/self-hosting.md; blank reports nothing. The web build reads SENTRY_ENVIRONMENT, SENTRY_RELEASE and SENTRY_SAMPLE_PERCENT for it too",
  ),
}

/** The settings of an error reporter: the server's from {@link resolveConfig}, the browser's from {@link resolveWebErrorReporting}. */
export type ErrorReportingConfig = Pick<
  ResolvedConfig,
  "sentryDsn" | "sentryEnvironment" | "sentryRelease" | "sentrySamplePercent"
>

/** The browser's error reporting settings, which the web build reads without the required server settings. */
export function resolveWebErrorReporting(env: Env): ErrorReportingConfig {
  return {
    sentryDsn: read(env, webBuildSchema.sentryDsn),
    sentryEnvironment: read(env, configSchema.sentryEnvironment),
    sentryRelease: read(env, configSchema.sentryRelease),
    sentrySamplePercent: read(env, configSchema.sentrySamplePercent),
  }
}

/** Who runs the instance, as the legal texts name them: the server's from {@link resolveConfig}, the web build's from {@link resolveWebPrerender}. */
export type OperatorConfig = Pick<
  ResolvedConfig,
  "operatorName" | "operatorAddress" | "operatorId" | "operatorEmail" | "legalUpdated"
>

/** What the web build prerenders the indexable pages with: their absolute address and the operator the legal texts name. */
export type WebPrerenderConfig = Pick<ResolvedConfig, "publicUrl"> & OperatorConfig

/**
 * The prerender settings of the web build, with the operator rules of the server; null without PUBLIC_URL, since
 * a page's canonical and hreflang addresses must be absolute. The build then writes the app's shell alone.
 */
export function resolveWebPrerender(env: Env): WebPrerenderConfig | null {
  if ((env[configSchema.publicUrl.env] ?? "").trim() === "") return null
  return { publicUrl: read(env, configSchema.publicUrl), ...resolveOperator(env) }
}

export function resolveConfig(env: Env): ResolvedConfig {
  const config = {
    twitchClientId: read(env, configSchema.twitchClientId),
    twitchClientSecret: read(env, configSchema.twitchClientSecret),
    kickClientId: read(env, configSchema.kickClientId),
    kickClientSecret: read(env, configSchema.kickClientSecret),
    youtubeClientId: read(env, configSchema.youtubeClientId),
    youtubeClientSecret: read(env, configSchema.youtubeClientSecret),
    signInDisabledPlatforms: read(env, configSchema.signInDisabledPlatforms),
    tokenSealKeys: read(env, configSchema.tokenSealKeys),
    sessionSecret: read(env, configSchema.sessionSecret),
    admins: read(env, configSchema.admins),
    publicUrl: read(env, configSchema.publicUrl),
    openSignup: read(env, configSchema.openSignup),
    streamerAccessListMax: read(env, configSchema.streamerAccessListMax),
    devFakeTwitch: read(env, configSchema.devFakeTwitch),
    devFakeKick: read(env, configSchema.devFakeKick),
    devFakeYouTube: read(env, configSchema.devFakeYouTube),
    defaultClaimSeconds: read(env, configSchema.defaultClaimSeconds),
    roleRefreshSeconds: read(env, configSchema.roleRefreshSeconds),
    chatEntryCheckSeconds: read(env, configSchema.chatEntryCheckSeconds),
    chatEntryFollowerChecks: read(env, configSchema.chatEntryFollowerChecks),
    liveIntervalMs: read(env, configSchema.liveIntervalMs),
    liveLastNames: read(env, configSchema.liveLastNames),
    liveShuffleNames: read(env, configSchema.liveShuffleNames),
    liveWinnerImages: read(env, configSchema.liveWinnerImages),
    liveEntrantsPerPush: read(env, configSchema.liveEntrantsPerPush),
    liveWinnerChatMax: read(env, configSchema.liveWinnerChatMax),
    entrantsPageMax: read(env, configSchema.entrantsPageMax),
    channelBadgesTtlSeconds: read(env, configSchema.channelBadgesTtlSeconds),
    queuePollSeconds: read(env, configSchema.queuePollSeconds),
    queuePollMaxSeconds: read(env, configSchema.queuePollMaxSeconds),
    queueCodeMaxAgeSeconds: read(env, configSchema.queueCodeMaxAgeSeconds),
    queueProcessingTimeoutSeconds: read(env, configSchema.queueProcessingTimeoutSeconds),
    queueCooldownSeconds: read(env, configSchema.queueCooldownSeconds),
    queueMinRatePerSecond: read(env, configSchema.queueMinRatePerSecond),
    queueMaxRatePerSecond: read(env, configSchema.queueMaxRatePerSecond),
    queueDecreasePercent: read(env, configSchema.queueDecreasePercent),
    queueIncreaseStepPerSecond: read(env, configSchema.queueIncreaseStepPerSecond),
    queueIncreaseIntervalSeconds: read(env, configSchema.queueIncreaseIntervalSeconds),
    queueBacklogLeaseSeconds: read(env, configSchema.queueBacklogLeaseSeconds),
    queueSubrequestsPerInvocation: read(env, configSchema.queueSubrequestsPerInvocation),
    queueRateWindowSeconds: read(env, configSchema.queueRateWindowSeconds),
    entryWriteRetryDelaysMs: read(env, configSchema.entryWriteRetryDelaysMs),
    entryWriteJitterPercent: read(env, configSchema.entryWriteJitterPercent),
    helixRetryDelayMs: read(env, configSchema.helixRetryDelayMs),
    twitchIdBaseUrl: read(env, configSchema.twitchIdBaseUrl),
    twitchHelixBaseUrl: read(env, configSchema.twitchHelixBaseUrl),
    twitchTimeoutMs: read(env, configSchema.twitchTimeoutMs),
    kickIdBaseUrl: read(env, configSchema.kickIdBaseUrl),
    kickApiBaseUrl: read(env, configSchema.kickApiBaseUrl),
    kickTimeoutMs: read(env, configSchema.kickTimeoutMs),
    kickWebhookMaxAgeSeconds: read(env, configSchema.kickWebhookMaxAgeSeconds),
    kickPublicKeyRefreshSeconds: read(env, configSchema.kickPublicKeyRefreshSeconds),
    kickOrphanRetrySeconds: read(env, configSchema.kickOrphanRetrySeconds),
    kickSubscribeRetryDelaySeconds: read(env, configSchema.kickSubscribeRetryDelaySeconds),
    kickSubscribeMaxAttempts: read(env, configSchema.kickSubscribeMaxAttempts),
    youtubeAuthBaseUrl: read(env, configSchema.youtubeAuthBaseUrl),
    youtubeTokenBaseUrl: read(env, configSchema.youtubeTokenBaseUrl),
    youtubeApiBaseUrl: read(env, configSchema.youtubeApiBaseUrl),
    youtubeTimeoutMs: read(env, configSchema.youtubeTimeoutMs),
    youtubeDailyQuotaUnits: read(env, configSchema.youtubeDailyQuotaUnits),
    youtubeQuotaAlertPercent: read(env, configSchema.youtubeQuotaAlertPercent),
    youtubeChatPollMinMs: read(env, configSchema.youtubeChatPollMinMs),
    youtubeWinnerPollMinMs: read(env, configSchema.youtubeWinnerPollMinMs),
    youtubeChatRetryDelaySeconds: read(env, configSchema.youtubeChatRetryDelaySeconds),
    youtubeChatMaxAttempts: read(env, configSchema.youtubeChatMaxAttempts),
    youtubeBroadcastRetrySeconds: read(env, configSchema.youtubeBroadcastRetrySeconds),
    eventSubUrl: read(env, configSchema.eventSubUrl),
    eventSubSubscribeSeconds: read(env, configSchema.eventSubSubscribeSeconds),
    eventSubConnectionMaxSeconds: read(env, configSchema.eventSubConnectionMaxSeconds),
    eventSubReconnectMarginSeconds: read(env, configSchema.eventSubReconnectMarginSeconds),
    eventSubKeepaliveGraceSeconds: read(env, configSchema.eventSubKeepaliveGraceSeconds),
    eventSubReconnectDelaySeconds: read(env, configSchema.eventSubReconnectDelaySeconds),
    eventSubReconnectMaxAttempts: read(env, configSchema.eventSubReconnectMaxAttempts),
    validatePeriodSeconds: read(env, configSchema.validatePeriodSeconds),
    sessionTtlSeconds: read(env, configSchema.sessionTtlSeconds),
    viewerSessionTtlSeconds: read(env, configSchema.viewerSessionTtlSeconds),
    stateCookieTtlSeconds: read(env, configSchema.stateCookieTtlSeconds),
    ticketsPerGroupMax: read(env, configSchema.ticketsPerGroupMax),
    claimSecondsMax: read(env, configSchema.claimSecondsMax),
    drawMaxWinners: read(env, configSchema.drawMaxWinners),
    publicGiveawayCacheSeconds: read(env, configSchema.publicGiveawayCacheSeconds),
    publicHistoryCacheSeconds: read(env, configSchema.publicHistoryCacheSeconds),
    publicHistoryMax: read(env, configSchema.publicHistoryMax),
    publicCacheMaxEntries: read(env, configSchema.publicCacheMaxEntries),
    recentWinnersGiveawaysMax: read(env, configSchema.recentWinnersGiveawaysMax),
    recentWinnersDaysMax: read(env, configSchema.recentWinnersDaysMax),
    chatBotLogins: read(env, configSchema.chatBotLogins),
    blockListMax: read(env, configSchema.blockListMax),
    blockListPushMax: read(env, configSchema.blockListPushMax),
    claimKeywordMaxLength: read(env, configSchema.claimKeywordMaxLength),
    excludedCountriesMaxLength: read(env, configSchema.excludedCountriesMaxLength),
    extraTermsMaxLength: read(env, configSchema.extraTermsMaxLength),
    codeInsertRetries: read(env, configSchema.codeInsertRetries),
    usageWarningThreshold: read(env, configSchema.usageWarningThreshold),
    liveRateWindowSeconds: read(env, configSchema.liveRateWindowSeconds),
    mirrorRetrySeconds: read(env, configSchema.mirrorRetrySeconds),
    rerollWindowSeconds: read(env, configSchema.rerollWindowSeconds),
    entryRetentionSeconds: read(env, configSchema.entryRetentionSeconds),
    entryRetentionSweepBatch: read(env, configSchema.entryRetentionSweepBatch),
    entryRetentionSweepMaxAttempts: read(env, configSchema.entryRetentionSweepMaxAttempts),
    historyRetentionDays: read(env, configSchema.historyRetentionDays),
    historyRetentionSweepBatch: read(env, configSchema.historyRetentionSweepBatch),
    winnerFormRetentionSeconds: read(env, configSchema.winnerFormRetentionSeconds),
    winnerAnswerMaxLength: read(env, configSchema.winnerAnswerMaxLength),
    entryUserLimitPerMinute: read(env, configSchema.entryUserLimitPerMinute),
    entryIpLimitPerMinute: read(env, configSchema.entryIpLimitPerMinute),
    leavesIpLimitPerMinute: read(env, configSchema.leavesIpLimitPerMinute),
    presenceIpLimitPerMinute: read(env, configSchema.presenceIpLimitPerMinute),
    moderatorIpLimitPerMinute: read(env, configSchema.moderatorIpLimitPerMinute),
    moderatorRecheckSeconds: read(env, configSchema.moderatorRecheckSeconds),
    leavesCacheSeconds: read(env, configSchema.leavesCacheSeconds),
    clientIpHeader: read(env, configSchema.clientIpHeader),
    titleMaxLength: read(env, configSchema.titleMaxLength),
    prizeMaxLength: read(env, configSchema.prizeMaxLength),
    drandUrl: read(env, configSchema.drandUrl),
    drandChainHash: read(env, configSchema.drandChainHash),
    drandGenesisSeconds: read(env, configSchema.drandGenesisSeconds),
    drandPeriodSeconds: read(env, configSchema.drandPeriodSeconds),
    drandLeadSeconds: read(env, configSchema.drandLeadSeconds),
    drandPublishMarginSeconds: read(env, configSchema.drandPublishMarginSeconds),
    drandRetryDelaysMs: read(env, configSchema.drandRetryDelaysMs),
    drandRetryJitterPercent: read(env, configSchema.drandRetryJitterPercent),
    drandTimeoutMs: read(env, configSchema.drandTimeoutMs),
    commitRetrySeconds: read(env, configSchema.commitRetrySeconds),
    commitMaxAttempts: read(env, configSchema.commitMaxAttempts),
    dataDir: read(env, configSchema.dataDir),
    port: read(env, configSchema.port),
    cloudflareAccountId: read(env, configSchema.cloudflareAccountId),
    cloudflareApiToken: read(env, configSchema.cloudflareApiToken),
    cloudflareUsageUrl: read(env, configSchema.cloudflareUsageUrl),
    cloudflareUsageTimeoutMs: read(env, configSchema.cloudflareUsageTimeoutMs),
    workerRequestLimit: read(env, configSchema.workerRequestLimit),
    durableObjectRequestLimit: read(env, configSchema.durableObjectRequestLimit),
    cloudflarePlan: read(env, configSchema.cloudflarePlan),
    usageAlertPercent: read(env, configSchema.usageAlertPercent),
    adminStatsCacheSeconds: read(env, configSchema.adminStatsCacheSeconds),
    adminStatsLiveRoomsMax: read(env, configSchema.adminStatsLiveRoomsMax),
    adminStatsSeriesMinutes: read(env, configSchema.adminStatsSeriesMinutes),
    adminStatsDays: read(env, configSchema.adminStatsDays),
    adminStatsReturnDays: read(env, configSchema.adminStatsReturnDays),
    adminStatsRefsMax: read(env, configSchema.adminStatsRefsMax),
    metricsRetentionHours: read(env, configSchema.metricsRetentionHours),
    referralVisitsPerDayMax: read(env, configSchema.referralVisitsPerDayMax),
    referralSourcesPerDayMax: read(env, configSchema.referralSourcesPerDayMax),
    donateUrl: read(env, configSchema.donateUrl),
    ...resolveOperator(env),
    sentryDsn: read(env, configSchema.sentryDsn),
    sentryEnvironment: read(env, configSchema.sentryEnvironment),
    sentryRelease: read(env, configSchema.sentryRelease),
    sentrySamplePercent: read(env, configSchema.sentrySamplePercent),
  }
  // A Kick app is its id and its secret; one without the other cannot sign anyone in.
  if ((config.kickClientId === null) !== (config.kickClientSecret === null)) {
    const missing =
      config.kickClientId === null ? configSchema.kickClientId : configSchema.kickClientSecret
    throw new ConfigError(missing.env, "missing")
  }
  // A Google client is its id and its secret as well.
  if ((config.youtubeClientId === null) !== (config.youtubeClientSecret === null)) {
    const missing =
      config.youtubeClientId === null
        ? configSchema.youtubeClientId
        : configSchema.youtubeClientSecret
    throw new ConfigError(missing.env, "missing")
  }
  // The page gives up polling before the code could expire, so a polling page never outlives its code.
  if (config.queuePollMaxSeconds >= config.queueCodeMaxAgeSeconds) {
    throw new ConfigError(configSchema.queuePollMaxSeconds.env, "not-below-queue-code-max-age")
  }
  // The rate rails clamp in both directions; a floor above the ceiling has no rate between them.
  if (config.queueMinRatePerSecond > config.queueMaxRatePerSecond) {
    throw new ConfigError(configSchema.queueMinRatePerSecond.env, "above-queue-max-rate")
  }
  // A connection is replaced before it reaches its maximum age, so the margin leaves it a positive life.
  if (config.eventSubReconnectMarginSeconds >= config.eventSubConnectionMaxSeconds) {
    throw new ConfigError(
      configSchema.eventSubReconnectMarginSeconds.env,
      "not-below-eventsub-connection-max",
    )
  }
  // A claimed code must stay claimed longer than the Twitch requests that process it can take in a row.
  if (
    config.queueProcessingTimeoutSeconds * 1000
    <= queuedEntryTwitchRequests * config.twitchTimeoutMs
  ) {
    throw new ConfigError(
      configSchema.queueProcessingTimeoutSeconds.env,
      "not-above-queued-entry-twitch-time",
    )
  }
  // Entrants' data must outlive every window in which a winner can still be claimed or rerolled.
  if (config.entryRetentionSeconds < config.claimSecondsMax + config.rerollWindowSeconds) {
    throw new ConfigError(configSchema.entryRetentionSeconds.env, "below-claim-and-reroll-windows")
  }
  // A lead shorter than one round could pick a round that is already known when the room commits.
  if (config.drandLeadSeconds < config.drandPeriodSeconds) {
    throw new ConfigError(configSchema.drandLeadSeconds.env, "not-at-least-drand-period")
  }
  // The fake Twitch signs in anyone, so it must never run behind a public origin.
  if (config.devFakeTwitch && !isLocalOrigin(config.publicUrl)) {
    throw new ConfigError(configSchema.devFakeTwitch.env, "fake-twitch-needs-local-public-url")
  }
  // The fake Kick signs anyone in as well.
  if (config.devFakeKick && !isLocalOrigin(config.publicUrl)) {
    throw new ConfigError(configSchema.devFakeKick.env, "fake-kick-needs-local-public-url")
  }
  // The fake Kick takes the Kick app's id and secret, so a fake without them would sign no one in.
  if (config.devFakeKick && config.kickClientId === null) {
    throw new ConfigError(configSchema.kickClientId.env, "missing")
  }
  // The fake YouTube signs anyone in as well, and takes the Google client's id and secret.
  if (config.devFakeYouTube && !isLocalOrigin(config.publicUrl)) {
    throw new ConfigError(configSchema.devFakeYouTube.env, "fake-youtube-needs-local-public-url")
  }
  if (config.devFakeYouTube && config.youtubeClientId === null) {
    throw new ConfigError(configSchema.youtubeClientId.env, "missing")
  }
  const off = new Set(config.signInDisabledPlatforms)
  // A fake stands in for its platform's app, so a fake of a switched off platform would serve nothing.
  const fakes = [
    [config.devFakeKick, "kick"],
    [config.devFakeYouTube, "youtube"],
  ] as const
  for (const [mounted, platform] of fakes) {
    if (mounted && off.has(platform)) {
      throw new ConfigError(configSchema.signInDisabledPlatforms.env, {
        reason: "faked-platform-disabled",
        entry: platform,
      })
    }
  }
  // A switched off platform takes the path of a blank app, so every caller of kickAppOf and youtubeAppOf drops it.
  return {
    ...config,
    ...(off.has("kick") ? { kickClientId: null, kickClientSecret: null } : {}),
    ...(off.has("youtube") ? { youtubeClientId: null, youtubeClientSecret: null } : {}),
  }
}

function resolveOperator(env: Env): OperatorConfig {
  const operator = {
    operatorName: read(env, configSchema.operatorName),
    operatorAddress: read(env, configSchema.operatorAddress),
    operatorId: read(env, configSchema.operatorId),
    operatorEmail: read(env, configSchema.operatorEmail),
    legalUpdated: read(env, configSchema.legalUpdated),
  }
  // The texts name the controller with a contact, and the other keys describe the named operator.
  if (operator.operatorName === null) {
    const orphans: [string, string | null][] = [
      [configSchema.operatorAddress.env, operator.operatorAddress],
      [configSchema.operatorId.env, operator.operatorId],
      [configSchema.operatorEmail.env, operator.operatorEmail],
      [configSchema.legalUpdated.env, operator.legalUpdated],
    ]
    for (const [key, value] of orphans) {
      if (value !== null) throw new ConfigError(key, "requires-operator-name")
    }
  } else if (operator.operatorEmail === null) {
    throw new ConfigError(configSchema.operatorEmail.env, "missing")
  }
  return operator
}

function isLocalOrigin(origin: string): boolean {
  const { hostname } = new URL(origin)
  return hostname === "localhost" || hostname === "127.0.0.1"
}

function read<T>(env: Env, field: ConfigField<T>): T {
  const raw = env[field.env] ?? field.default
  if (raw === null) throw new ConfigError(field.env, "missing")
  const parsed = field.parse(raw)
  if (!parsed.ok) throw new ConfigError(field.env, parsed.issue)
  return parsed.value
}

function required<T>(env: string, parse: ConfigField<T>["parse"], origin: string): ConfigField<T> {
  return { env, parse, default: null, origin }
}

function withDefault<T>(
  env: string,
  parse: ConfigField<T>["parse"],
  defaultRaw: string,
  origin: string,
): ConfigField<T> {
  return { env, parse, default: defaultRaw, origin }
}

function ok<T>(value: T): Parsed<T, ConfigReason> {
  return { ok: true, value }
}

function fail(reason: ConfigReason): Parsed<never, ConfigReason> {
  return { ok: false, issue: reason }
}

function text(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  return value === "" ? fail("blank") : ok(value)
}

/** A blank value means the setting is not used. */
function optional<T>(item: (raw: string) => Parsed<T, ConfigReason>) {
  return (raw: string): Parsed<T | null, ConfigReason> => (raw.trim() === "" ? ok(null) : item(raw))
}

function cloudflarePlan(raw: string): Parsed<CloudflarePlan, ConfigReason> {
  const value = raw.trim()
  const plan = cloudflarePlans.find((candidate) => candidate === value)
  return plan === undefined ? fail("not-a-cloudflare-plan") : ok(plan)
}

function bool(raw: string): Parsed<boolean, ConfigReason> {
  if (raw === "true") return ok(true)
  return raw === "false" ? ok(false) : fail("not-a-boolean")
}

function int(min: number, max = Number.MAX_SAFE_INTEGER) {
  return (raw: string): Parsed<number, ConfigReason> => {
    const digits = raw.trim()
    if (digits === "") return fail("blank")
    if (!/^\d+$/.test(digits)) return fail("not-an-integer")
    const value = Number(digits)
    if (!Number.isSafeInteger(value) || value < min || value > max) return fail("out-of-range")
    return ok(value)
  }
}

function url(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  if (!URL.canParse(value)) return fail("not-a-url")
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("not-a-url")
  return ok(parsed.origin)
}

/** A header name is an HTTP token; names are case-insensitive, so it is kept in lower case. */
function headerName(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  return /^[A-Za-z0-9-]+$/.test(value) ? ok(value.toLowerCase()) : fail("not-a-header-name")
}

function chainHash(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  return /^[0-9a-f]{64}$/.test(value) ? ok(value) : fail("not-a-chain-hash")
}

function endpoint(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  if (!URL.canParse(value)) return fail("not-a-url")
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("not-a-url")
  return ok(parsed.href)
}

function httpsUrl(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  if (!URL.canParse(value)) return fail("not-a-url")
  const parsed = new URL(value)
  return parsed.protocol === "https:" ? ok(parsed.href) : fail("not-an-https-url")
}

function email(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) ? ok(value) : fail("not-an-email")
}

function isoDate(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  const parsed = new Date(`${value}T00:00:00Z`)
  const real = Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(`${value}T`)
  return real ? ok(value) : fail("not-an-iso-date")
}

function socketUrl(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  if (!URL.canParse(value)) return fail("not-a-url")
  const parsed = new URL(value)
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return fail("not-a-url")
  return ok(parsed.href)
}

// A DSN is the ingest origin with the project's public key as the user and the project id as the path.
function sentryDsn(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  if (!URL.canParse(value)) return fail("not-a-url")
  const { protocol, username, pathname } = new URL(value)
  const ingest = (protocol === "https:" || protocol === "http:") && username !== ""
  return ingest && /^\/\d+$/.test(pathname) ? ok(value) : fail("not-a-sentry-dsn")
}

/** Entries are told apart by shape: digits are an id, `twitch.tv/<login>` links and bare names are logins. */
function adminList(raw: string): Parsed<[AdminEntry, ...AdminEntry[]], ConfigIssue> {
  const [head = "", ...tail] = raw.split(",")
  const first = adminEntry(head)
  if (!first.ok) return first
  const entries: [AdminEntry, ...AdminEntry[]] = [first.value]
  for (const part of tail) {
    const parsed = adminEntry(part)
    if (!parsed.ok) return parsed
    entries.push(parsed.value)
  }
  return ok(entries)
}

function adminEntry(raw: string): Parsed<AdminEntry, ConfigIssue> {
  const value = raw.trim()
  if (value === "") return fail("blank")
  if (/^\d+$/.test(value)) return ok({ kind: "id", id: value })
  const login = loginOf(value)
  return login === null
    ? { ok: false, issue: { reason: "not-an-admin-entry", entry: value } }
    : ok({ kind: "login", login })
}

// Twitch logins are case-insensitive and stored in lower case; a link carries exactly one path segment.
function loginOf(value: string): string | null {
  if (twitchLoginPattern.test(value)) return value.toLowerCase()
  if (!URL.canParse(value)) return null
  const { protocol, hostname, pathname } = new URL(value)
  if (protocol !== "https:" || (hostname !== "twitch.tv" && hostname !== "www.twitch.tv")) {
    return null
  }
  const segment = pathname.replace(/^\//, "").replace(/\/$/, "")
  return twitchLoginPattern.test(segment) ? segment.toLowerCase() : null
}

/** Comma separated Twitch logins in lower case; blank is none. */
function loginList(raw: string): Parsed<readonly string[], ConfigReason> {
  if (raw.trim() === "") return ok([])
  return list((part: string): Parsed<string, ConfigReason> => {
    const value = part.trim()
    return twitchLoginPattern.test(value) ? ok(value.toLowerCase()) : fail("not-a-login")
  })(raw)
}

/** Comma separated platforms of {@link optionalPlatforms}, case-insensitive; blank is none. */
function optionalPlatformList(raw: string): Parsed<readonly OptionalPlatform[], ConfigIssue> {
  if (raw.trim() === "") return ok([])
  const platforms: OptionalPlatform[] = []
  for (const part of raw.split(",")) {
    const value = part.trim().toLowerCase()
    const platform = optionalPlatforms.find((candidate) => candidate === value)
    if (platform === undefined) {
      return { ok: false, issue: { reason: "not-an-optional-platform", entry: value } }
    }
    platforms.push(platform)
  }
  return ok(platforms)
}

function list<T>(item: (raw: string) => Parsed<T, ConfigReason>) {
  return (raw: string): Parsed<[T, ...T[]], ConfigReason> => {
    const [head = "", ...tail] = raw.split(",")
    const first = item(head)
    if (!first.ok) return first
    const values: [T, ...T[]] = [first.value]
    for (const part of tail) {
      const parsed = item(part)
      if (!parsed.ok) return parsed
      values.push(parsed.value)
    }
    return ok(values)
  }
}
