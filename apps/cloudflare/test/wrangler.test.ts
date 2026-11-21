import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig } from "@rafflink/core/config"
import { apiPrefixes } from "@rafflink/core/http/api-paths"
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
  // A page or file that reaches the Worker first is a billed request, and the Worker no longer answers pages.
  it("runs the Worker first only for the API and sign-in paths and serves pages from the assets with the SPA fallback", async () => {
    const { runWorkerFirst, notFoundHandling } = await readWranglerConfig()

    expect(runWorkerFirst).toEqual(apiPrefixes.map((prefix) => `${prefix}*`))
    expect(notFoundHandling).toBe("single-page-application")
  })

  it("cron string matches config validate period", async () => {
    const { crons } = await readWranglerConfig()
    const { validatePeriodSeconds } = resolveConfig(required)
    const hours = validatePeriodSeconds / 3600

    expect(Number.isInteger(hours)).toBe(true)
    expect(crons).toEqual([hours === 1 ? "0 * * * *" : `0 */${hours} * * *`])
  })

  it("sets the entry rate limits to the config defaults per minute", async () => {
    const { rateLimits } = await readWranglerConfig()
    const { entryUserLimitPerMinute, entryIpLimitPerMinute } = resolveConfig(required)

    expect(rateLimits.ENTRY_USER_LIMITER).toMatchObject({
      limit: entryUserLimitPerMinute,
      period: 60,
    })
    expect(rateLimits.ENTRY_IP_LIMITER).toMatchObject({ limit: entryIpLimitPerMinute, period: 60 })
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
