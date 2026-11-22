import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig } from "@rafflink/core/config"
import { apiPrefixes } from "@rafflink/core/http/api-paths"
import { indexablePaths } from "@rafflink/core/http/static-headers"
import { readWranglerConfig } from "./wrangler-config.ts"

const required = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
}

describe("wrangler.jsonc", () => {
  // A page or file that reaches the Worker first is a billed request; only the indexable pages need their absolute URLs.
  it("runs the Worker first only for the API, sign-in and indexable paths and serves the rest from the assets with the SPA fallback", async () => {
    const { runWorkerFirst, notFoundHandling, assetsBinding } = await readWranglerConfig()

    expect(runWorkerFirst).toEqual([
      ...apiPrefixes.map((prefix) => `${prefix}*`),
      ...indexablePaths,
    ])
    expect(notFoundHandling).toBe("single-page-application")
    expect(assetsBinding).toBe("ASSETS")
  })

  it("cron string matches config validate period", async () => {
    const { crons } = await readWranglerConfig()
    const { validatePeriodSeconds } = resolveConfig(required)
    const hours = validatePeriodSeconds / 3600

    expect(Number.isInteger(hours)).toBe(true)
    expect(crons).toEqual([hours === 1 ? "0 * * * *" : `0 */${hours} * * *`])
  })

  it("sets the rate limits to the config defaults per minute", async () => {
    const { rateLimits } = await readWranglerConfig()
    const {
      entryUserLimitPerMinute,
      entryIpLimitPerMinute,
      leavesIpLimitPerMinute,
      moderatorIpLimitPerMinute,
    } = resolveConfig(required)

    expect(rateLimits.ENTRY_USER_LIMITER).toMatchObject({
      limit: entryUserLimitPerMinute,
      period: 60,
    })
    expect(rateLimits.ENTRY_IP_LIMITER).toMatchObject({ limit: entryIpLimitPerMinute, period: 60 })
    expect(rateLimits.LEAVES_IP_LIMITER).toMatchObject({
      limit: leavesIpLimitPerMinute,
      period: 60,
    })
    expect(rateLimits.MODERATOR_IP_LIMITER).toMatchObject({
      limit: moderatorIpLimitPerMinute,
      period: 60,
    })
  })

  // Wrangler appends its own INSERT to the file text, so a last statement without `;` runs into it.
  it("ends every accounts migration with a semicolon", () => {
    const corePackage = fileURLToPath(import.meta.resolve("@rafflink/core/package.json"))
    const dir = join(dirname(corePackage), "schema", "accounts")
    const names = readdirSync(dir).filter((name) => name.endsWith(".sql"))

    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(readFileSync(join(dir, name), "utf8").trimEnd().endsWith(";")).toBe(true)
    }
  })
})
