import { describe, expect, it } from "bun:test"
import { ConfigError, configSchema, resolveConfig, resolveWebErrorReporting } from "./config.ts"
import { queuedEntryTwitchRequests } from "./twitch/queued-entry-requests.ts"

const required = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k1, k2",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1,2",
  PUBLIC_URL: "https://rafflink.app/some/path",
}

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    resolveConfig(env)
  } catch (error) {
    if (error instanceof ConfigError) return error
    throw error
  }
  throw new Error("expected resolveConfig to throw")
}

describe("resolveConfig", () => {
  it("fills every default and parses the required keys", () => {
    const config = resolveConfig(required)
    expect(config.twitchClientId).toBe("client")
    expect(config.tokenSealKeys).toEqual(["k1", "k2"])
    expect(config.admins).toEqual([
      { kind: "id", id: "1" },
      { kind: "id", id: "2" },
    ])
    expect(config.viewerSessionTtlSeconds).toBe(2_592_000)
    expect(config.publicUrl).toBe("https://rafflink.app")
    expect(config.devFakeTwitch).toBe(false)
    expect(config.twitchIdBaseUrl).toBe("https://id.twitch.tv")
    expect(config.twitchHelixBaseUrl).toBe("https://api.twitch.tv")
    expect(config.defaultClaimSeconds).toBe(300)
    expect(config.queuePollMaxSeconds).toBe(120)
    expect(config.queueCodeMaxAgeSeconds).toBe(300)
    expect(config.queueCooldownSeconds).toBe(2)
    expect(config.queueDecreasePercent).toBe(67)
    expect(config.queueMaxRatePerSecond).toBe(500)
    expect(config.entryWriteRetryDelaysMs).toEqual([200, 500, 1000])
    expect(config.usageWarningThreshold).toBe(25_000)
    expect(config.cloudflarePlan).toBe("free")
    expect(config.usageAlertPercent).toBe(70)
    expect(config.workerRequestLimit).toBeNull()
    expect(config.durableObjectRequestLimit).toBeNull()
    expect(config.queueSubrequestsPerInvocation).toBeNull()
    expect(config.titleMaxLength).toBe(100)
    expect(config.prizeMaxLength).toBe(200)
    expect(config.dataDir).toBe("./data")
    expect(config.port).toBe(3000)
  })

  it("keeps the live rooms of the admin statistics within the Free plan's subrequests", () => {
    expect(resolveConfig(required).adminStatsLiveRoomsMax).toBe(20)
    expect(
      resolveConfig({ ...required, ADMIN_STATS_LIVE_ROOMS_MAX: "30" }).adminStatsLiveRoomsMax,
    ).toBe(30)
    expect(failure({ ...required, ADMIN_STATS_LIVE_ROOMS_MAX: "31" })).toMatchObject({
      env: "ADMIN_STATS_LIVE_ROOMS_MAX",
      reason: "out-of-range",
    })
    expect(resolveConfig(required).referralVisitsPerDayMax).toBe(2000)
  })

  it("takes an override over the default", () => {
    const config = resolveConfig({
      ...required,
      DEFAULT_CLAIM_SECONDS: "60",
      DEV_FAKE_TWITCH: "true",
      PUBLIC_URL: "http://localhost:3000",
    })
    expect(config.defaultClaimSeconds).toBe(60)
    expect(config.devFakeTwitch).toBe(true)
  })

  it("refuses the fake Twitch unless the public URL is a localhost or 127.0.0.1 origin", () => {
    for (const local of ["http://localhost", "http://localhost:3000", "http://127.0.0.1:8787"]) {
      expect(
        resolveConfig({ ...required, DEV_FAKE_TWITCH: "true", PUBLIC_URL: local }).devFakeTwitch,
      ).toBe(true)
    }
    for (const remote of [
      "https://rafflink.app",
      "http://localhost.evil.example",
      "http://192.168.1.5:3000",
      "http://[::1]:3000",
    ]) {
      expect(failure({ ...required, DEV_FAKE_TWITCH: "true", PUBLIC_URL: remote })).toMatchObject({
        env: "DEV_FAKE_TWITCH",
        reason: "fake-twitch-needs-local-public-url",
      })
    }
    expect(resolveConfig({ ...required, PUBLIC_URL: "https://rafflink.app" }).devFakeTwitch).toBe(
      false,
    )
  })

  it("refuses the fake Kick behind a public URL or without a Kick app", () => {
    const kickApp = { KICK_CLIENT_ID: "kick-id", KICK_CLIENT_SECRET: "kick-secret" }
    const local = { ...required, DEV_FAKE_KICK: "true", PUBLIC_URL: "http://localhost:3000" }

    expect(resolveConfig({ ...local, ...kickApp }).devFakeKick).toBe(true)
    expect(failure({ ...local, ...kickApp, PUBLIC_URL: "https://rafflink.app" })).toMatchObject({
      env: "DEV_FAKE_KICK",
      reason: "fake-kick-needs-local-public-url",
    })
    expect(failure(local)).toMatchObject({ env: "KICK_CLIENT_ID", reason: "missing" })
    expect(resolveConfig(required).devFakeKick).toBe(false)
  })

  it("rejects a processing timeout that does not exceed the Twitch requests of one queued code in a row", () => {
    const limitSeconds = queuedEntryTwitchRequests * 5
    for (const seconds of [limitSeconds - 1, limitSeconds]) {
      expect(
        failure({
          ...required,
          TWITCH_TIMEOUT_MS: "5000",
          QUEUE_PROCESSING_TIMEOUT_SECONDS: String(seconds),
        }),
      ).toMatchObject({
        env: "QUEUE_PROCESSING_TIMEOUT_SECONDS",
        reason: "not-above-queued-entry-twitch-time",
      })
    }
    expect(
      resolveConfig({
        ...required,
        TWITCH_TIMEOUT_MS: "5000",
        QUEUE_PROCESSING_TIMEOUT_SECONDS: String(limitSeconds + 1),
      }).queueProcessingTimeoutSeconds,
    ).toBe(limitSeconds + 1)
  })

  it("keeps winner form answers 30 days by default and refuses more", () => {
    expect(resolveConfig(required).winnerFormRetentionSeconds).toBe(2_592_000)
    expect(failure({ ...required, WINNER_FORM_RETENTION_SECONDS: "2592001" })).toMatchObject({
      env: "WINNER_FORM_RETENTION_SECONDS",
      reason: "out-of-range",
    })
  })

  it("rejects a retention time below the claim and reroll windows or above 30 days", () => {
    const windows = { CLAIM_SECONDS_MAX: "100", REROLL_WINDOW_SECONDS: "50" }
    expect(failure({ ...required, ...windows, ENTRY_RETENTION_SECONDS: "149" })).toMatchObject({
      env: "ENTRY_RETENTION_SECONDS",
      reason: "below-claim-and-reroll-windows",
    })
    expect(
      resolveConfig({ ...required, ...windows, ENTRY_RETENTION_SECONDS: "150" })
        .entryRetentionSeconds,
    ).toBe(150)
    expect(
      resolveConfig({ ...required, ENTRY_RETENTION_SECONDS: "2592000" }).entryRetentionSeconds,
    ).toBe(2_592_000)
    expect(failure({ ...required, ENTRY_RETENTION_SECONDS: "2592001" })).toMatchObject({
      env: "ENTRY_RETENTION_SECONDS",
      reason: "out-of-range",
    })
    expect(failure({ ...required, ENTRY_RETENTION_SECONDS: "0" })).toMatchObject({
      env: "ENTRY_RETENTION_SECONDS",
      reason: "out-of-range",
    })
  })

  it("reads the client address header as lower case, blank as unset, and rejects what is no header name", () => {
    expect(resolveConfig(required).clientIpHeader).toBeNull()
    expect(resolveConfig({ ...required, CLIENT_IP_HEADER: "  " }).clientIpHeader).toBeNull()
    expect(
      resolveConfig({ ...required, CLIENT_IP_HEADER: "CF-Connecting-IP" }).clientIpHeader,
    ).toBe("cf-connecting-ip")
    for (const value of ["X Forwarded", "x-forwarded-for:", "a,b"]) {
      expect(failure({ ...required, CLIENT_IP_HEADER: value })).toMatchObject({
        env: "CLIENT_IP_HEADER",
        reason: "not-a-header-name",
      })
    }
  })

  it("reads the limits of tickets, claim time, winners and the public cache", () => {
    const config = resolveConfig(required)

    expect(config).toMatchObject({
      ticketsPerGroupMax: 1000,
      claimSecondsMax: 86_400,
      drawMaxWinners: 500,
      publicGiveawayCacheSeconds: 5,
      queueProcessingTimeoutSeconds: 60,
    })
    expect(resolveConfig({ ...required, PUBLIC_GIVEAWAY_CACHE_SECONDS: "0" })).toMatchObject({
      publicGiveawayCacheSeconds: 0,
    })
    expect(failure({ ...required, DRAW_MAX_WINNERS: "0" })).toMatchObject({
      env: "DRAW_MAX_WINNERS",
      reason: "out-of-range",
    })
  })

  it("names each missing required key", () => {
    for (const field of Object.values(configSchema).filter((f) => f.default === null)) {
      const rest: Record<string, string> = { ...required }
      delete rest[field.env]
      expect(failure(rest)).toMatchObject({ env: field.env, reason: "missing" })
    }
  })

  it("turns Kick off without a Kick app and reads one given as id and secret", () => {
    const off = resolveConfig(required)
    const on = resolveConfig({
      ...required,
      KICK_CLIENT_ID: " kid ",
      KICK_CLIENT_SECRET: "ksecret",
    })

    expect([off.kickClientId, off.kickClientSecret]).toEqual([null, null])
    expect([on.kickClientId, on.kickClientSecret]).toEqual(["kid", "ksecret"])
  })

  it("names the missing half of a Kick app", () => {
    expect(failure({ ...required, KICK_CLIENT_ID: "kid" })).toMatchObject({
      env: "KICK_CLIENT_SECRET",
      reason: "missing",
    })
    expect(
      failure({ ...required, KICK_CLIENT_SECRET: "ksecret", KICK_CLIENT_ID: " " }),
    ).toMatchObject({ env: "KICK_CLIENT_ID", reason: "missing" })
  })

  it("turns YouTube off without a Google client and names its missing half", () => {
    const off = resolveConfig(required)
    const on = resolveConfig({
      ...required,
      YOUTUBE_CLIENT_ID: " yid ",
      YOUTUBE_CLIENT_SECRET: "ys",
    })

    expect([off.youtubeClientId, off.youtubeClientSecret]).toEqual([null, null])
    expect([on.youtubeClientId, on.youtubeClientSecret]).toEqual(["yid", "ys"])
    expect(off.youtubeDailyQuotaUnits).toBe(10_000)
    expect(failure({ ...required, YOUTUBE_CLIENT_ID: "yid" })).toMatchObject({
      env: "YOUTUBE_CLIENT_SECRET",
      reason: "missing",
    })
    expect(
      failure({ ...required, YOUTUBE_CLIENT_SECRET: "ys", YOUTUBE_CLIENT_ID: " " }),
    ).toMatchObject({ env: "YOUTUBE_CLIENT_ID", reason: "missing" })
  })

  it("rejects a blank required key", () => {
    expect(failure({ ...required, SESSION_SECRET: "  " })).toMatchObject({
      env: "SESSION_SECRET",
      reason: "blank",
    })
  })

  it("reads chat bot logins in lower case, blank as none, and refuses a non-login", () => {
    expect(resolveConfig(required).chatBotLogins).toContain("nightbot")
    expect(
      resolveConfig({ ...required, CHAT_BOT_LOGINS: " NightBot , my_bot " }).chatBotLogins,
    ).toEqual(["nightbot", "my_bot"])
    expect(resolveConfig({ ...required, CHAT_BOT_LOGINS: " " }).chatBotLogins).toEqual([])
    for (const value of ["night bot", "a,,b", "https://twitch.tv/x"]) {
      expect(failure({ ...required, CHAT_BOT_LOGINS: value })).toMatchObject({
        env: "CHAT_BOT_LOGINS",
        reason: "not-a-login",
      })
    }
  })

  it("bounds the recent winners giveaways by the Free plan's subrequests", () => {
    expect(resolveConfig(required)).toMatchObject({
      recentWinnersGiveawaysMax: 10,
      recentWinnersDaysMax: 90,
      blockListMax: 500,
    })
    expect(failure({ ...required, RECENT_WINNERS_GIVEAWAYS_MAX: "21" })).toMatchObject({
      env: "RECENT_WINNERS_GIVEAWAYS_MAX",
      reason: "out-of-range",
    })
  })

  it("keeps at least one giveaway on the public history page", () => {
    expect(resolveConfig(required)).toMatchObject({
      publicHistoryMax: 20,
      publicHistoryCacheSeconds: 300,
    })
    expect(failure({ ...required, PUBLIC_HISTORY_MAX: "0" })).toMatchObject({
      env: "PUBLIC_HISTORY_MAX",
      reason: "out-of-range",
    })
  })

  it("rejects an empty entry in a list", () => {
    expect(failure({ ...required, TOKEN_SEAL_KEYS: "a,,b" })).toMatchObject({
      env: "TOKEN_SEAL_KEYS",
      reason: "blank",
    })
    expect(failure({ ...required, ADMIN_TWITCH_IDS: "" })).toMatchObject({
      env: "ADMIN_TWITCH_IDS",
      reason: "blank",
    })
  })

  it("reads admins as ids, logins and channel links", () => {
    const config = resolveConfig({
      ...required,
      ADMIN_TWITCH_IDS: [
        " 12345 ",
        "Some_Login",
        "https://twitch.tv/Linked",
        "https://www.twitch.tv/slashed/",
        "https://www.twitch.tv/queried?sr=a#top",
        "a",
      ].join(","),
    })
    expect(config.admins).toEqual([
      { kind: "id", id: "12345" },
      { kind: "login", login: "some_login" },
      { kind: "login", login: "linked" },
      { kind: "login", login: "slashed" },
      { kind: "login", login: "queried" },
      { kind: "login", login: "a" },
    ])
  })

  it("names the admin entry that is neither an id, a login nor a channel link", () => {
    const bad = [
      "two words",
      "https://twitch.tv/",
      "https://twitch.tv/one/two",
      "http://twitch.tv/login",
      "https://example.com/login",
      "https://twitch.tv.evil.com/login",
      "twitch.tv/login",
      "has-dash",
      "x".repeat(26),
    ]
    for (const entry of bad) {
      const error = failure({ ...required, ADMIN_TWITCH_IDS: `1,${entry}` })
      expect(error).toMatchObject({ env: "ADMIN_TWITCH_IDS", reason: "not-an-admin-entry", entry })
      expect(error.message).toContain(JSON.stringify(entry))
    }
  })

  it("rejects a public url that is not http or https", () => {
    for (const bad of ["rafflink.app", "ftp://rafflink.app", ""]) {
      expect(failure({ ...required, PUBLIC_URL: bad })).toMatchObject({
        env: "PUBLIC_URL",
        reason: "not-a-url",
      })
    }
  })

  it("rejects a boolean that is not exactly true or false", () => {
    for (const bad of ["TRUE", "1", "yes", ""]) {
      expect(failure({ ...required, DEV_FAKE_TWITCH: bad })).toMatchObject({
        env: "DEV_FAKE_TWITCH",
        reason: "not-a-boolean",
      })
    }
  })

  it("rejects a number that is not a plain non-negative integer", () => {
    for (const bad of ["abc", "-1", "1.5", "NaN", "Infinity", "1e3", "0x10"]) {
      expect(failure({ ...required, DEFAULT_CLAIM_SECONDS: bad })).toMatchObject({
        env: "DEFAULT_CLAIM_SECONDS",
        reason: "not-an-integer",
      })
    }
    expect(failure({ ...required, DEFAULT_CLAIM_SECONDS: " " })).toMatchObject({ reason: "blank" })
  })

  it("rejects 0 where the minimum is 1 and accepts it where the minimum is 0", () => {
    expect(failure({ ...required, DEFAULT_CLAIM_SECONDS: "0" })).toMatchObject({
      env: "DEFAULT_CLAIM_SECONDS",
      reason: "out-of-range",
    })
    expect(resolveConfig({ ...required, QUEUE_COOLDOWN_SECONDS: "0" }).queueCooldownSeconds).toBe(0)
  })

  it("keeps the queue's decrease a real decrease: below 100 percent and above 0", () => {
    for (const percent of ["0", "100"]) {
      expect(failure({ ...required, QUEUE_DECREASE_PERCENT: percent })).toMatchObject({
        env: "QUEUE_DECREASE_PERCENT",
        reason: "out-of-range",
      })
    }
    expect(resolveConfig({ ...required, QUEUE_DECREASE_PERCENT: "99" }).queueDecreasePercent).toBe(
      99,
    )
  })

  it("rejects an integer beyond the safe range and a percent above 100", () => {
    expect(failure({ ...required, DEFAULT_CLAIM_SECONDS: "9007199254740993" })).toMatchObject({
      reason: "out-of-range",
    })
    expect(failure({ ...required, ENTRY_WRITE_JITTER_PERCENT: "101" })).toMatchObject({
      env: "ENTRY_WRITE_JITTER_PERCENT",
      reason: "out-of-range",
    })
  })

  it("takes the Cloudflare plan free or paid and rejects any other name", () => {
    expect(resolveConfig({ ...required, CLOUDFLARE_PLAN: "paid" }).cloudflarePlan).toBe("paid")
    for (const bad of ["Paid", "pro", ""]) {
      expect(failure({ ...required, CLOUDFLARE_PLAN: bad })).toMatchObject({
        env: "CLOUDFLARE_PLAN",
        reason: "not-a-cloudflare-plan",
      })
    }
  })

  it("keeps the usage alert a percent from 1 to 100", () => {
    expect(resolveConfig({ ...required, USAGE_ALERT_PERCENT: "100" }).usageAlertPercent).toBe(100)
    for (const bad of ["0", "101"]) {
      expect(failure({ ...required, USAGE_ALERT_PERCENT: bad })).toMatchObject({
        env: "USAGE_ALERT_PERCENT",
        reason: "out-of-range",
      })
    }
  })

  it("reads a limit override when set and rejects a subrequest budget below one queued code", () => {
    const config = resolveConfig({
      ...required,
      WORKER_REQUEST_LIMIT: "90000",
      QUEUE_SUBREQUESTS_PER_INVOCATION: "8",
    })
    expect(config.workerRequestLimit).toBe(90_000)
    expect(config.queueSubrequestsPerInvocation).toBe(8)
    expect(failure({ ...required, QUEUE_SUBREQUESTS_PER_INVOCATION: "7" })).toMatchObject({
      env: "QUEUE_SUBREQUESTS_PER_INVOCATION",
      reason: "out-of-range",
    })
  })

  it("accepts port 0 and 65535 and rejects 65536", () => {
    expect(resolveConfig({ ...required, PORT: "0" }).port).toBe(0)
    expect(resolveConfig({ ...required, PORT: "65535" }).port).toBe(65_535)
    expect(failure({ ...required, PORT: "65536" })).toMatchObject({
      env: "PORT",
      reason: "out-of-range",
    })
  })

  it("leaves the Cloudflare credentials null when unset or blank and keeps the endpoint path", () => {
    for (const env of [
      required,
      { ...required, CLOUDFLARE_ACCOUNT_ID: "  ", CLOUDFLARE_API_TOKEN: "" },
    ]) {
      const config = resolveConfig(env)
      expect(config.cloudflareAccountId).toBeNull()
      expect(config.cloudflareApiToken).toBeNull()
    }
    const config = resolveConfig({
      ...required,
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_API_TOKEN: "tok",
      CLOUDFLARE_USAGE_URL: "http://localhost:9/graphql",
    })
    expect(config.cloudflareAccountId).toBe("acc")
    expect(config.cloudflareApiToken).toBe("tok")
    expect(config.cloudflareUsageUrl).toBe("http://localhost:9/graphql")
    expect(failure({ ...required, CLOUDFLARE_USAGE_URL: "graphql" })).toMatchObject({
      env: "CLOUDFLARE_USAGE_URL",
      reason: "not-a-url",
    })
  })

  it("keeps signup closed unless OPEN_SIGNUP is true and rejects any other value", () => {
    expect(resolveConfig(required).openSignup).toBe(false)
    expect(resolveConfig({ ...required, OPEN_SIGNUP: "true" }).openSignup).toBe(true)
    expect(resolveConfig({ ...required, OPEN_SIGNUP: "false" }).openSignup).toBe(false)
    expect(failure({ ...required, OPEN_SIGNUP: "yes" })).toMatchObject({
      env: "OPEN_SIGNUP",
      reason: "not-a-boolean",
    })
  })

  it("leaves the support link null when unset or blank and accepts only an https URL", () => {
    expect(resolveConfig(required).donateUrl).toBeNull()
    expect(resolveConfig({ ...required, DONATE_URL: "  " }).donateUrl).toBeNull()
    expect(
      resolveConfig({ ...required, DONATE_URL: " https://ko-fi.com/rafflink " }).donateUrl,
    ).toBe("https://ko-fi.com/rafflink")
    expect(failure({ ...required, DONATE_URL: "http://ko-fi.com/rafflink" })).toMatchObject({
      env: "DONATE_URL",
      reason: "not-an-https-url",
    })
    expect(failure({ ...required, DONATE_URL: "ko-fi.com/rafflink" })).toMatchObject({
      env: "DONATE_URL",
      reason: "not-a-url",
    })
  })

  it("reports no errors by default and reads a Sentry DSN, its environment, release and sample percent", () => {
    const off = resolveConfig({ ...required, SENTRY_DSN: "  ", SENTRY_RELEASE: "" })
    const on = resolveConfig({
      ...required,
      SENTRY_DSN: " https://key@o1.ingest.de.sentry.io/42 ",
      SENTRY_ENVIRONMENT: "staging",
      SENTRY_RELEASE: "abc123",
      SENTRY_SAMPLE_PERCENT: "0",
    })

    expect(off).toMatchObject({
      sentryDsn: null,
      sentryEnvironment: "production",
      sentryRelease: null,
      sentrySamplePercent: 100,
    })
    expect(on).toMatchObject({
      sentryDsn: "https://key@o1.ingest.de.sentry.io/42",
      sentryEnvironment: "staging",
      sentryRelease: "abc123",
      sentrySamplePercent: 0,
    })
  })

  it.each([
    ["no URL", "o1.ingest.de.sentry.io/42", "not-a-url"],
    ["no public key", "https://o1.ingest.de.sentry.io/42", "not-a-sentry-dsn"],
    ["no project id", "https://key@o1.ingest.de.sentry.io/", "not-a-sentry-dsn"],
    [
      "a project path that is not a number",
      "https://key@o1.ingest.de.sentry.io/web",
      "not-a-sentry-dsn",
    ],
    ["another scheme", "ftp://key@o1.ingest.de.sentry.io/42", "not-a-sentry-dsn"],
  ])("rejects a Sentry DSN with %s", (_, dsn, reason) => {
    expect(failure({ ...required, SENTRY_DSN: dsn })).toMatchObject({ env: "SENTRY_DSN", reason })
  })

  it("keeps the Sentry sample a percent from 0 to 100", () => {
    expect(failure({ ...required, SENTRY_SAMPLE_PERCENT: "101" })).toMatchObject({
      env: "SENTRY_SAMPLE_PERCENT",
      reason: "out-of-range",
    })
  })

  it("reads the browser's DSN from PUBLIC_SENTRY_DSN, not the server's, without the server settings", () => {
    const web = resolveWebErrorReporting({
      SENTRY_DSN: "https://server@o1.ingest.de.sentry.io/1",
      PUBLIC_SENTRY_DSN: "https://browser@o1.ingest.de.sentry.io/2",
      SENTRY_RELEASE: "abc123",
    })

    expect(web).toEqual({
      sentryDsn: "https://browser@o1.ingest.de.sentry.io/2",
      sentryEnvironment: "production",
      sentryRelease: "abc123",
      sentrySamplePercent: 100,
    })
    expect(resolveWebErrorReporting({}).sentryDsn).toBeNull()
  })

  it("leaves the operator settings null when unset or blank", () => {
    const config = resolveConfig({ ...required, OPERATOR_NAME: "  ", OPERATOR_EMAIL: "" })

    expect(config).toMatchObject({
      operatorName: null,
      operatorAddress: null,
      operatorId: null,
      operatorEmail: null,
      legalUpdated: null,
    })
  })

  it("reads the operator settings trimmed", () => {
    const config = resolveConfig({
      ...required,
      OPERATOR_NAME: " Example Operator ",
      OPERATOR_ADDRESS: " 1 Example Street, Example City ",
      OPERATOR_ID: " 12345678 ",
      OPERATOR_EMAIL: " legal@example.com ",
      LEGAL_UPDATED: " 2026-02-28 ",
    })

    expect(config).toMatchObject({
      operatorName: "Example Operator",
      operatorAddress: "1 Example Street, Example City",
      operatorId: "12345678",
      operatorEmail: "legal@example.com",
      legalUpdated: "2026-02-28",
    })
  })

  it("requires the operator e-mail when the operator is named", () => {
    expect(failure({ ...required, OPERATOR_NAME: "Example Operator" })).toMatchObject({
      env: "OPERATOR_EMAIL",
      reason: "missing",
    })
    expect(
      failure({ ...required, OPERATOR_NAME: "Example Operator", OPERATOR_EMAIL: "  " }),
    ).toMatchObject({ env: "OPERATOR_EMAIL", reason: "missing" })
  })

  it("rejects operator details and a legal date without an operator name", () => {
    const orphans = {
      OPERATOR_ADDRESS: "1 Example Street",
      OPERATOR_ID: "12345678",
      OPERATOR_EMAIL: "legal@example.com",
      LEGAL_UPDATED: "2026-02-28",
    }
    for (const [env, value] of Object.entries(orphans)) {
      expect(failure({ ...required, [env]: value })).toMatchObject({
        env,
        reason: "requires-operator-name",
      })
    }
  })

  it("rejects an operator e-mail that is not an address", () => {
    const invalid = [
      "legal",
      "legal@",
      "@example.com",
      "legal@example",
      "a b@example.com",
      "legal@example.com.",
      "legal@example..com",
    ]
    for (const value of invalid) {
      expect(
        failure({ ...required, OPERATOR_NAME: "Example Operator", OPERATOR_EMAIL: value }),
      ).toMatchObject({
        env: "OPERATOR_EMAIL",
        reason: "not-an-email",
      })
    }
  })

  it("rejects a legal update date that is not a real ISO date", () => {
    const invalid = [
      "2026-02-30",
      "2026-2-3",
      "21.11.2026",
      "2026-13-01",
      "tomorrow",
      "2026-02-28T10:00",
      "2026-02-28T10:00:00Z",
    ]
    for (const value of invalid) {
      expect(
        failure({
          ...required,
          OPERATOR_NAME: "Example Operator",
          OPERATOR_EMAIL: "legal@example.com",
          LEGAL_UPDATED: value,
        }),
      ).toMatchObject({
        env: "LEGAL_UPDATED",
        reason: "not-an-iso-date",
      })
    }
  })

  it("defaults the drand settings to the quicknet beacon and a lead of 6 seconds", () => {
    const config = resolveConfig(required)

    expect(config).toMatchObject({
      drandUrl: "https://api.drand.sh",
      drandChainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
      drandGenesisSeconds: 1_692_803_367,
      drandPeriodSeconds: 3,
      drandLeadSeconds: 6,
      drandRetryDelaysMs: [200, 500, 1000],
      commitRetrySeconds: 30,
      commitMaxAttempts: 6,
    })
  })

  it("rejects a drand chain hash that is not 64 lower-case hex characters", () => {
    for (const hash of [
      "abc",
      "G".repeat(64),
      "A".repeat(64),
      `${"a".repeat(63)} `,
      "a".repeat(65),
    ]) {
      const error = failure({ ...required, DRAND_CHAIN_HASH: hash })
      expect([error.env, error.reason]).toEqual(["DRAND_CHAIN_HASH", "not-a-chain-hash"])
    }
  })

  it("rejects a drand period of 0 and a lead shorter than one period, and accepts a lead of one period", () => {
    expect(failure({ ...required, DRAND_PERIOD_SECONDS: "0" }).reason).toBe("out-of-range")
    const short = failure({ ...required, DRAND_LEAD_SECONDS: "2", DRAND_PERIOD_SECONDS: "3" })
    expect([short.env, short.reason]).toEqual(["DRAND_LEAD_SECONDS", "not-at-least-drand-period"])
    expect(
      resolveConfig({ ...required, DRAND_LEAD_SECONDS: "3", DRAND_PERIOD_SECONDS: "3" })
        .drandLeadSeconds,
    ).toBe(3)
  })

  it("rejects a poll maximum equal to or above the code maximum age", () => {
    for (const poll of ["300", "301"]) {
      expect(failure({ ...required, QUEUE_POLL_MAX_SECONDS: poll })).toMatchObject({
        env: "QUEUE_POLL_MAX_SECONDS",
        reason: "not-below-queue-code-max-age",
      })
    }
    expect(resolveConfig({ ...required, QUEUE_POLL_MAX_SECONDS: "299" }).queuePollMaxSeconds).toBe(
      299,
    )
  })

  it("rejects a queue rate floor above the ceiling and accepts them equal", () => {
    expect(
      failure({ ...required, QUEUE_MIN_RATE_PER_SECOND: "11", QUEUE_MAX_RATE_PER_SECOND: "10" }),
    ).toMatchObject({ env: "QUEUE_MIN_RATE_PER_SECOND", reason: "above-queue-max-rate" })
    expect(
      resolveConfig({
        ...required,
        QUEUE_MIN_RATE_PER_SECOND: "10",
        QUEUE_MAX_RATE_PER_SECOND: "10",
      }).queueMinRatePerSecond,
    ).toBe(10)
  })

  it("accepts a ws or wss EventSub URL with its path and rejects any other scheme", () => {
    expect(resolveConfig(required).eventSubUrl).toBe("wss://eventsub.wss.twitch.tv/ws")
    expect(
      resolveConfig({ ...required, EVENTSUB_URL: "ws://localhost:3000/eventsub/ws" }).eventSubUrl,
    ).toBe("ws://localhost:3000/eventsub/ws")
    for (const bad of ["https://eventsub.wss.twitch.tv/ws", "eventsub.wss.twitch.tv", ""]) {
      expect(failure({ ...required, EVENTSUB_URL: bad })).toMatchObject({
        env: "EVENTSUB_URL",
        reason: "not-a-url",
      })
    }
  })

  it("rejects a reconnect margin equal to or above the connection maximum age", () => {
    for (const margin of ["900", "901"]) {
      expect(failure({ ...required, EVENTSUB_RECONNECT_MARGIN_SECONDS: margin })).toMatchObject({
        env: "EVENTSUB_RECONNECT_MARGIN_SECONDS",
        reason: "not-below-eventsub-connection-max",
      })
    }
    expect(
      resolveConfig({ ...required, EVENTSUB_RECONNECT_MARGIN_SECONDS: "899" })
        .eventSubReconnectMarginSeconds,
    ).toBe(899)
  })

  it("accepts a viewer cookie lifetime of 1 and rejects 0", () => {
    expect(
      resolveConfig({ ...required, VIEWER_SESSION_TTL_SECONDS: "1" }).viewerSessionTtlSeconds,
    ).toBe(1)
    expect(failure({ ...required, VIEWER_SESSION_TTL_SECONDS: "0" })).toMatchObject({
      env: "VIEWER_SESSION_TTL_SECONDS",
      reason: "out-of-range",
    })
  })

  it("keeps the secret value out of the error", () => {
    const error = failure({ ...required, TOKEN_SEAL_KEYS: "topsecret,," })
    expect(error.message).not.toContain("topsecret")
  })
})
