import { describe, expect, it } from "bun:test"
import type { ErrorEvent, EventHint, Integration } from "@sentry/core"
import { TwitchRateLimited } from "../twitch/errors.ts"
import { scrubEvent, sentryOptions } from "./error-reporting.ts"

const config = {
  sentryDsn: "https://public@o1.ingest.de.sentry.io/2",
  sentryEnvironment: "staging",
  sentryRelease: "abc123",
  sentrySamplePercent: 25,
}

function named(name: string): Integration {
  return { name, setupOnce: () => {} }
}

function errorEvent(fields: Omit<ErrorEvent, "type">): ErrorEvent {
  return { type: undefined, ...fields }
}

describe("sentryOptions", () => {
  it("starts no SDK without a DSN", () => {
    expect(sentryOptions({ ...config, sentryDsn: null })).toBeNull()
  })

  it("reports errors only, with the release, the environment and the sample rate", () => {
    const options = sentryOptions(config)

    expect(options).toMatchObject({
      dsn: config.sentryDsn,
      environment: "staging",
      release: "abc123",
      sampleRate: 0.25,
      tracesSampleRate: 0,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] },
    })
  })

  it("leaves the release to the SDK when none is set", () => {
    expect(sentryOptions({ ...config, sentryRelease: null })).not.toHaveProperty("release")
  })

  it("drops a platform 429, which its caller retries, and sends other errors scrubbed and without messages", async () => {
    const beforeSend = sentryOptions(config)?.beforeSend
    const event = () =>
      errorEvent({
        message: "failed for streamer_login",
        exception: { values: [{ type: "TypeError", value: "no row for streamer_login" }] },
        request: { cookies: { s: "1" } },
      })
    const rateLimited: EventHint = { originalException: new TwitchRateLimited("token") }
    const unexpected: EventHint = { originalException: new TypeError("x") }

    expect(await beforeSend?.(event(), rateLimited)).toBeNull()
    expect(await beforeSend?.(event(), unexpected)).toEqual(
      errorEvent({ exception: { values: [{ type: "TypeError" }] }, request: {} }),
    )
  })
})

describe("scrubEvent", () => {
  it("removes cookies, the Authorization header and the request body", () => {
    const event = errorEvent({
      request: {
        method: "POST",
        cookies: { session: "secret-cookie" },
        data: { answers: { address: "Main Street 1" } },
        headers: {
          Cookie: "session=secret-cookie",
          authorization: "Bearer secret-token",
          "user-agent": "browser",
        },
      },
    })

    expect(scrubEvent(event).request).toEqual({
      method: "POST",
      headers: { "user-agent": "browser" },
    })
  })

  it("filters the OAuth code and state in the URL, the query string and breadcrumbs", () => {
    const callback =
      "https://rafflink.example/auth/twitch/callback?code=oauth-code&state=oauth-state&lang=sk"
    const event = errorEvent({
      request: { url: callback, query_string: "code=oauth-code&state=oauth-state&lang=sk" },
      breadcrumbs: [
        { category: "navigation", data: { from: "/", to: callback } },
        { category: "fetch", data: { url: callback, method: "GET" } },
      ],
    })

    const scrubbed = JSON.stringify(scrubEvent(event))

    expect(scrubbed).not.toContain("oauth-code")
    expect(scrubbed).not.toContain("oauth-state")
    expect(scrubbed).toContain("lang=sk")
  })

  it.each([
    [
      "the overlay page",
      "https://rafflink.example/overlay/gid-1/secret-1?scale=2",
      "https://rafflink.example/overlay/gid-1/[Filtered]?scale=2",
    ],
    ["the overlay socket", "/api/overlay/gid-1/secret-1", "/api/overlay/gid-1/[Filtered]"],
    [
      "the overlay theme",
      "/api/overlay/gid-1/secret-1/theme",
      "/api/overlay/gid-1/[Filtered]/theme",
    ],
    ["a queued entry's poll", "/api/g/ABCDE/pending/secret-1", "/api/g/ABCDE/pending/[Filtered]"],
    [
      "a queued entry's page",
      "/ABCDE?entry=pending&ticket=secret-1",
      "/ABCDE?entry=pending&ticket=[Filtered]",
    ],
    [
      "a moderator link",
      "https://rafflink.example/mod#secret-1",
      "https://rafflink.example/mod#[Filtered]",
    ],
  ])("filters the secret in the address of %s", (_, address, expected) => {
    const event = errorEvent({
      transaction: `GET ${address}`,
      message: `failed at ${address}`,
      request: { url: address, headers: { referer: address } },
      breadcrumbs: [
        { category: "navigation", data: { from: "/", to: address } },
        { category: "fetch", data: { url: address } },
      ],
    })

    const scrubbed = scrubEvent(event)

    expect(JSON.stringify(scrubbed)).not.toContain("secret-1")
    expect(scrubbed.request?.url).toBe(expected)
    expect(scrubbed.transaction).toBe(`GET ${expected}`)
    expect(scrubbed.breadcrumbs?.[0]?.data?.to).toBe(expected)
  })

  it("keeps the ids of addresses whose segments are no secret", () => {
    const event = errorEvent({
      request: { url: "/api/live/gid-1/entrants?after=0" },
      message: "index.html has no #root",
    })

    expect(scrubEvent(event)).toMatchObject({
      request: { url: "/api/live/gid-1/entrants?after=0" },
      message: "index.html has no #root",
    })
  })

  it("drops console breadcrumbs, whose arguments can quote a login, and keeps the others", () => {
    const event = errorEvent({
      breadcrumbs: [
        { category: "console", message: "lookup failed", data: { arguments: ["login foo"] } },
        { category: "navigation", data: { from: "/", to: "/dashboard" } },
      ],
    })

    expect(scrubEvent(event).breadcrumbs).toEqual([
      { category: "navigation", data: { from: "/", to: "/dashboard" } },
    ])
  })

  it("leaves the console integration out of the server SDKs", () => {
    const integrations = sentryOptions(config)?.integrations
    const kept =
      typeof integrations === "function" ? integrations([named("Console"), named("Http")]) : []

    expect(kept.map(({ name }) => name)).toEqual(["Http"])
  })

  it("filters the same parameter names in a query string as in pairs", () => {
    const names = [
      "code",
      "state",
      "ticket",
      "access_token",
      "password",
      "client_secret",
      "pass",
      "signature",
      "api_key",
      "x-api-key",
      "answers",
    ]
    const asText = errorEvent({
      request: { query_string: names.map((n) => `${n}=v-${n}`).join("&") + "&lang=sk" },
    })
    const asPairs = errorEvent({
      request: {
        query_string: [...names.map((n): [string, string] => [n, `v-${n}`]), ["lang", "sk"]],
      },
    })

    const text = JSON.stringify(scrubEvent(asText))
    const pairs = JSON.stringify(scrubEvent(asPairs))

    for (const name of names) {
      expect(text).not.toContain(`v-${name}`)
      expect(pairs).not.toContain(`v-${name}`)
    }
    expect(text).toContain("lang=sk")
  })

  it("filters JWTs and token-shaped runs in messages but keeps words, frames and the release", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIz"
    const event = errorEvent({
      release: "0123456789abcdef0123456789abcdef01234567",
      message: `refresh failed for a1B2c3D4e5F6g7H8i9J0k1L2m3`,
      exception: {
        values: [
          {
            type: "ConfigError",
            value: `QUEUE_X: not-below-eventsub-connection-max with ${jwt}`,
            stacktrace: {
              frames: [{ filename: "/app/worker-0123456789abcdef0123456789.js", lineno: 12 }],
            },
          },
        ],
      },
      breadcrumbs: [{ message: "token 0123456789abcdef0123456789abcdef" }],
    })

    const scrubbed = scrubEvent(event)

    expect(scrubbed.message).toBe("refresh failed for [Filtered]")
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      "QUEUE_X: not-below-eventsub-connection-max with [Filtered]",
    )
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: "/app/worker-0123456789abcdef0123456789.js",
      lineno: 12,
    })
    expect(scrubbed.release).toBe("0123456789abcdef0123456789abcdef01234567")
    expect(scrubbed.breadcrumbs?.[0]?.message).toBe("token [Filtered]")
  })

  it("filters query parameters given as an object or as pairs", () => {
    const asObject = errorEvent({
      request: { query_string: { code: "c", state: "s", lang: "sk" } },
    })
    const asPairs = errorEvent({
      request: {
        query_string: [
          ["code", "c"],
          ["lang", "sk"],
        ],
      },
    })

    expect(scrubEvent(asObject).request?.query_string).toEqual({
      code: "[Filtered]",
      state: "[Filtered]",
      lang: "sk",
    })
    expect(scrubEvent(asPairs).request?.query_string).toEqual([
      ["code", "[Filtered]"],
      ["lang", "sk"],
    ])
  })

  it("filters winner form answers and platform tokens in extra data and contexts", () => {
    const event = errorEvent({
      extra: {
        giveawayId: "g-1",
        winnerAnswers: { email: "winner@example.com" },
        nested: [{ refresh_token: "refresh-secret", accessToken: "access-secret" }],
      },
      contexts: { twitch: { client_secret: "client-secret", endpoint: "helix" } },
    })

    const scrubbed = scrubEvent(event)

    expect(scrubbed.extra).toEqual({
      giveawayId: "g-1",
      winnerAnswers: "[Filtered]",
      nested: [{ refresh_token: "[Filtered]", accessToken: "[Filtered]" }],
    })
    expect(scrubbed.contexts).toEqual({
      twitch: { client_secret: "[Filtered]", endpoint: "helix" },
    })
  })

  it("filters Bearer, Basic and OAuth credentials and secret parameters in messages and breadcrumbs", () => {
    const event = errorEvent({
      message: "Authorization: Bearer secret-1 failed",
      exception: {
        values: [
          {
            type: "Error",
            value: "validate with OAuth secret-2 at https://id.twitch.tv/x?access_token=secret-3",
          },
        ],
      },
      breadcrumbs: [
        { message: "retry with Bearer secret-4" },
        { message: "proxy said Basic secret-5, then password=secret-6 api_key=secret-7" },
      ],
    })

    const scrubbed = JSON.stringify(scrubEvent(event))

    for (const secret of [
      "secret-1",
      "secret-2",
      "secret-3",
      "secret-4",
      "secret-5",
      "secret-6",
      "secret-7",
    ]) {
      expect(scrubbed).not.toContain(secret)
    }
    expect(scrubbed).toContain("Bearer [Filtered] failed")
  })
})
