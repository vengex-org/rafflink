import type { Parsed } from "./lib/parsed.ts"

export type ConfigReason =
  | "missing"
  | "blank"
  | "not-a-boolean"
  | "not-an-integer"
  | "out-of-range"
  | "not-a-url"
  | "not-below-queue-code-max-age"

/** An invalid or missing setting. Carries the env key and a reason, never the value (it may be a secret). */
export class ConfigError extends Error {
  constructor(
    readonly env: string,
    readonly reason: ConfigReason,
  ) {
    super(`${env}: ${reason}`)
  }
}

/**
 * One setting: its env key, how to parse the raw string, its default as the raw string a deployment
 * would write (null means required), and where the number or choice comes from.
 */
export interface ConfigField<T> {
  readonly env: string
  readonly parse: (raw: string) => Parsed<T, ConfigReason>
  readonly default: string | null
  readonly origin: string
}

export type ResolvedConfig = {
  readonly [K in keyof typeof configSchema]: (typeof configSchema)[K] extends ConfigField<infer T>
    ? T
    : never
}

type Env = Readonly<Record<string, string | undefined>>

export const configSchema = {
  twitchClientId: required("TWITCH_CLIENT_ID", text, "Twitch app registration, see the README"),
  twitchClientSecret: required(
    "TWITCH_CLIENT_SECRET",
    text,
    "Twitch app registration, see the README",
  ),
  tokenSealKeys: required(
    "TOKEN_SEAL_KEYS",
    list(text),
    "Key ring, comma separated, that seals stored streamer refresh tokens (spec AC-1)",
  ),
  sessionSecret: required("SESSION_SECRET", text, "Signs the session cookie (spec AC-1)"),
  adminTwitchIds: required(
    "ADMIN_TWITCH_IDS",
    list(text),
    "Twitch user ids, comma separated, allowed on the admin page (spec AC-23)",
  ),
  publicUrl: required("PUBLIC_URL", url, "Public origin of the service, used for OAuth redirects"),
  devFakeTwitch: withDefault(
    "DEV_FAKE_TWITCH",
    bool,
    "false",
    "Mounts the fake Twitch routes and the dev SPA; never true in production",
  ),
  defaultClaimSeconds: withDefault(
    "DEFAULT_CLAIM_SECONDS",
    int(1),
    "300",
    "Claim time after a draw when the giveaway sets none; spec AC-2",
  ),
  roleRefreshSeconds: withDefault(
    "ROLE_REFRESH_SECONDS",
    int(1),
    "300",
    "Refresh of the VIP and moderator lists while entries are open; spec AC-13",
  ),
  liveIntervalMs: withDefault(
    "LIVE_INTERVAL_MS",
    int(1),
    "1000",
    "Shortest time between live page pushes; spec AC-4",
  ),
  liveLastNames: withDefault(
    "LIVE_LAST_NAMES",
    int(0),
    "20",
    "Latest entrant names on the live page; spec AC-4",
  ),
  queuePollSeconds: withDefault(
    "QUEUE_POLL_SECONDS",
    int(1),
    "3",
    "Page poll interval for a queued entry; spec AC-14",
  ),
  queuePollMaxSeconds: withDefault(
    "QUEUE_POLL_MAX_SECONDS",
    int(1),
    "120",
    "Page stops polling a queued entry after this; spec AC-14",
  ),
  queueCodeMaxAgeSeconds: withDefault(
    "QUEUE_CODE_MAX_AGE_SECONDS",
    int(1),
    "300",
    "Queued authorization codes older than this are dropped; spec AC-14",
  ),
  queueCooldownSeconds: withDefault(
    "QUEUE_COOLDOWN_SECONDS",
    int(0),
    "30",
    "Every new code is queued this long after the first token endpoint 429; spec AC-15",
  ),
  queueStartRatePerSecond: withDefault(
    "QUEUE_START_RATE_PER_SECOND",
    int(1),
    "10",
    "Token endpoint calls per second the queue starts at; starting guess, the real limit is unknown",
  ),
  queueMinRatePerSecond: withDefault(
    "QUEUE_MIN_RATE_PER_SECOND",
    int(1),
    "1",
    "Lowest rate the queue slows down to after 429s; starting guess",
  ),
  queueMaxRatePerSecond: withDefault(
    "QUEUE_MAX_RATE_PER_SECOND",
    int(1),
    "50",
    "Highest rate the queue speeds up to after successes; starting guess",
  ),
  entryWriteRetryDelaysMs: withDefault(
    "ENTRY_WRITE_RETRY_DELAYS_MS",
    list(int(0)),
    "200,500,1000",
    "Delay before each retry of a failed room write, so also the retry count; spec AC-16",
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
    "Wait before the single retry of a Helix 503; delay is a starting guess, one retry is spec AC-17",
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
  eventSubSubscribeSeconds: withDefault(
    "EVENTSUB_SUBSCRIBE_SECONDS",
    int(1),
    "10",
    "Time after the welcome message to subscribe; Twitch limit",
  ),
  eventSubReconnectMarginSeconds: withDefault(
    "EVENTSUB_RECONNECT_MARGIN_SECONDS",
    int(0),
    "10",
    "Reconnect this long before Twitch drops the old session; starting guess",
  ),
  eventSubReconnectMaxAttempts: withDefault(
    "EVENTSUB_RECONNECT_MAX_ATTEMPTS",
    int(1),
    "5",
    "Reconnects before the live page shows Chat claim unavailable; starting guess",
  ),
  validatePeriodSeconds: withDefault(
    "VALIDATE_PERIOD_SECONDS",
    int(1),
    "3600",
    "Streamer token validation period; Twitch requires hourly, spec AC-22",
  ),
  sessionTtlSeconds: withDefault(
    "SESSION_TTL_SECONDS",
    int(1),
    "604800",
    "Lifetime of the streamer session cookie; starting guess, 7 days",
  ),
  stateCookieTtlSeconds: withDefault(
    "STATE_COOKIE_TTL_SECONDS",
    int(1),
    "600",
    "Lifetime of the OAuth state cookie; OAuth advises at most 10 minutes for a code",
  ),
  claimKeywordMaxLength: withDefault(
    "CLAIM_KEYWORD_MAX_LENGTH",
    int(1),
    "32",
    "Longest claim keyword a streamer can set; starting guess",
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
    "Warn at giveaway creation below this many Worker requests left; spec AC-23",
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
  workerRequestLimit: withDefault(
    "WORKER_REQUEST_LIMIT",
    int(1),
    "100000",
    "Worker requests per UTC day the usage meter compares against; Cloudflare Workers Free plan limit, raise it on a paid plan",
  ),
  durableObjectRequestLimit: withDefault(
    "DURABLE_OBJECT_REQUEST_LIMIT",
    int(1),
    "100000",
    "Durable Object requests per UTC day the usage meter compares against; Cloudflare Free plan limit, raise it on a paid plan",
  ),
}

export function resolveConfig(env: Env): ResolvedConfig {
  const config = {
    twitchClientId: read(env, configSchema.twitchClientId),
    twitchClientSecret: read(env, configSchema.twitchClientSecret),
    tokenSealKeys: read(env, configSchema.tokenSealKeys),
    sessionSecret: read(env, configSchema.sessionSecret),
    adminTwitchIds: read(env, configSchema.adminTwitchIds),
    publicUrl: read(env, configSchema.publicUrl),
    devFakeTwitch: read(env, configSchema.devFakeTwitch),
    defaultClaimSeconds: read(env, configSchema.defaultClaimSeconds),
    roleRefreshSeconds: read(env, configSchema.roleRefreshSeconds),
    liveIntervalMs: read(env, configSchema.liveIntervalMs),
    liveLastNames: read(env, configSchema.liveLastNames),
    queuePollSeconds: read(env, configSchema.queuePollSeconds),
    queuePollMaxSeconds: read(env, configSchema.queuePollMaxSeconds),
    queueCodeMaxAgeSeconds: read(env, configSchema.queueCodeMaxAgeSeconds),
    queueCooldownSeconds: read(env, configSchema.queueCooldownSeconds),
    queueStartRatePerSecond: read(env, configSchema.queueStartRatePerSecond),
    queueMinRatePerSecond: read(env, configSchema.queueMinRatePerSecond),
    queueMaxRatePerSecond: read(env, configSchema.queueMaxRatePerSecond),
    entryWriteRetryDelaysMs: read(env, configSchema.entryWriteRetryDelaysMs),
    entryWriteJitterPercent: read(env, configSchema.entryWriteJitterPercent),
    helixRetryDelayMs: read(env, configSchema.helixRetryDelayMs),
    twitchIdBaseUrl: read(env, configSchema.twitchIdBaseUrl),
    twitchHelixBaseUrl: read(env, configSchema.twitchHelixBaseUrl),
    twitchTimeoutMs: read(env, configSchema.twitchTimeoutMs),
    eventSubSubscribeSeconds: read(env, configSchema.eventSubSubscribeSeconds),
    eventSubReconnectMarginSeconds: read(env, configSchema.eventSubReconnectMarginSeconds),
    eventSubReconnectMaxAttempts: read(env, configSchema.eventSubReconnectMaxAttempts),
    validatePeriodSeconds: read(env, configSchema.validatePeriodSeconds),
    sessionTtlSeconds: read(env, configSchema.sessionTtlSeconds),
    stateCookieTtlSeconds: read(env, configSchema.stateCookieTtlSeconds),
    claimKeywordMaxLength: read(env, configSchema.claimKeywordMaxLength),
    codeInsertRetries: read(env, configSchema.codeInsertRetries),
    usageWarningThreshold: read(env, configSchema.usageWarningThreshold),
    liveRateWindowSeconds: read(env, configSchema.liveRateWindowSeconds),
    mirrorRetrySeconds: read(env, configSchema.mirrorRetrySeconds),
    titleMaxLength: read(env, configSchema.titleMaxLength),
    prizeMaxLength: read(env, configSchema.prizeMaxLength),
    dataDir: read(env, configSchema.dataDir),
    port: read(env, configSchema.port),
    cloudflareAccountId: read(env, configSchema.cloudflareAccountId),
    cloudflareApiToken: read(env, configSchema.cloudflareApiToken),
    cloudflareUsageUrl: read(env, configSchema.cloudflareUsageUrl),
    cloudflareUsageTimeoutMs: read(env, configSchema.cloudflareUsageTimeoutMs),
    workerRequestLimit: read(env, configSchema.workerRequestLimit),
    durableObjectRequestLimit: read(env, configSchema.durableObjectRequestLimit),
  }
  // The page gives up polling before the code could expire, so a polling page never outlives its code.
  if (config.queuePollMaxSeconds >= config.queueCodeMaxAgeSeconds) {
    throw new ConfigError(configSchema.queuePollMaxSeconds.env, "not-below-queue-code-max-age")
  }
  return config
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
function optional(item: (raw: string) => Parsed<string, ConfigReason>) {
  return (raw: string): Parsed<string | null, ConfigReason> =>
    raw.trim() === "" ? ok(null) : item(raw)
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

function endpoint(raw: string): Parsed<string, ConfigReason> {
  const value = raw.trim()
  if (!URL.canParse(value)) return fail("not-a-url")
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("not-a-url")
  return ok(parsed.href)
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
