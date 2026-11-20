import { describe, expect, it } from "bun:test"
import { ConfigError, configSchema, resolveConfig } from "./config.ts"

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
    expect(config.adminTwitchIds).toEqual(["1", "2"])
    expect(config.publicUrl).toBe("https://rafflink.app")
    expect(config.devFakeTwitch).toBe(false)
    expect(config.twitchIdBaseUrl).toBe("https://id.twitch.tv")
    expect(config.twitchHelixBaseUrl).toBe("https://api.twitch.tv")
    expect(config.defaultClaimSeconds).toBe(300)
    expect(config.queuePollMaxSeconds).toBe(120)
    expect(config.queueCodeMaxAgeSeconds).toBe(300)
    expect(config.queueCooldownSeconds).toBe(30)
    expect(config.entryWriteRetryDelaysMs).toEqual([200, 500, 1000])
    expect(config.usageWarningThreshold).toBe(25_000)
    expect(config.titleMaxLength).toBe(100)
    expect(config.prizeMaxLength).toBe(200)
    expect(config.dataDir).toBe("./data")
    expect(config.port).toBe(3000)
  })

  it("takes an override over the default", () => {
    const config = resolveConfig({
      ...required,
      DEFAULT_CLAIM_SECONDS: "60",
      DEV_FAKE_TWITCH: "true",
    })
    expect(config.defaultClaimSeconds).toBe(60)
    expect(config.devFakeTwitch).toBe(true)
  })

  it("names each missing required key", () => {
    for (const field of Object.values(configSchema).filter((f) => f.default === null)) {
      const rest: Record<string, string> = { ...required }
      delete rest[field.env]
      expect(failure(rest)).toMatchObject({ env: field.env, reason: "missing" })
    }
  })

  it("rejects a blank required key", () => {
    expect(failure({ ...required, SESSION_SECRET: "  " })).toMatchObject({
      env: "SESSION_SECRET",
      reason: "blank",
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

  it("rejects an integer beyond the safe range and a percent above 100", () => {
    expect(failure({ ...required, DEFAULT_CLAIM_SECONDS: "9007199254740993" })).toMatchObject({
      reason: "out-of-range",
    })
    expect(failure({ ...required, ENTRY_WRITE_JITTER_PERCENT: "101" })).toMatchObject({
      env: "ENTRY_WRITE_JITTER_PERCENT",
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

  it("keeps the secret value out of the error", () => {
    const error = failure({ ...required, TOKEN_SEAL_KEYS: "topsecret,," })
    expect(error.message).not.toContain("topsecret")
  })
})
