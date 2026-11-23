import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig } from "@rafflink/core/config"
import { apiPrefixes } from "@rafflink/core/http/api-paths"
import { historyPagePattern } from "@rafflink/core/http/static-headers"
import { localizedPath } from "@rafflink/core/lib/page-paths"
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
  // A page or file that reaches the Worker first is a billed request; the home page needs it for the referral count.
  it("runs the Worker first only for the API, sign-in, home and history paths and serves the rest from the assets with the SPA fallback", async () => {
    const { runWorkerFirst, notFoundHandling, assetsBinding } = await readWranglerConfig()

    expect(runWorkerFirst).toEqual([
      ...apiPrefixes.map((prefix) => `${prefix}*`),
      localizedPath("en", "home"),
      historyPagePattern,
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
      presenceIpLimitPerMinute,
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
    expect(rateLimits.PRESENCE_IP_LIMITER).toMatchObject({
      limit: presenceIpLimitPerMinute,
      period: 60,
    })
  })

  // Wrangler appends its own INSERT to the file text, so a last statement without `;` runs into it.
  it("ends every accounts migration with a semicolon", () => {
    for (const text of accountsMigrations()) {
      expect(text.trimEnd().endsWith(";")).toBe(true)
    }
  })

  // D1 splits a migration at every `;`, also one inside a comment, and runs the rest of the comment as SQL.
  it("has no semicolon in a comment of an accounts migration", () => {
    for (const text of accountsMigrations()) {
      const comments = text.split("\n").filter((line) => line.trimStart().startsWith("--"))
      expect(comments.filter((line) => line.includes(";"))).toEqual([])
    }
  })
})

/** The text of each accounts migration of core, the files `wrangler d1 migrations` applies. */
function accountsMigrations(): string[] {
  const corePackage = fileURLToPath(import.meta.resolve("@rafflink/core/package.json"))
  const dir = join(dirname(corePackage), "schema", "accounts")
  const names = readdirSync(dir).filter((name) => name.endsWith(".sql"))
  expect(names.length).toBeGreaterThan(0)
  return names.map((name) => readFileSync(join(dir, name), "utf8"))
}
