import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type ResolvedConfig } from "@rafflink/core/config"
import type { GiveawayRules } from "@rafflink/core/domain/rules"
import { toBase64 } from "@rafflink/core/lib/encoding"
import type { GiveawayInit } from "@rafflink/core/room/giveaway-room"

export const sealKey = `test:${toBase64(new Uint8Array(32).fill(3))}`

export function testConfig(env: Readonly<Record<string, string>> = {}): ResolvedConfig {
  return resolveConfig({
    TWITCH_CLIENT_ID: "client-1",
    TWITCH_CLIENT_SECRET: "secret-1",
    TOKEN_SEAL_KEYS: sealKey,
    SESSION_SECRET: "session-secret",
    ADMIN_TWITCH_IDS: "200",
    PUBLIC_URL: "http://localhost",
    PORT: "0",
    PUBLIC_GIVEAWAY_CACHE_SECONDS: "0",
    ...env,
  })
}

export const validRules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
  excludeRecentWinners: null,
  chatKeyword: null,
  pageEntry: true,
  minAge: null,
  excludedCountries: null,
  extraTerms: null,
}

export function giveawayInit(id: string, closesAt: number | null = null): GiveawayInit {
  return {
    id,
    platform: "twitch",
    broadcasterId: "200",
    title: "Giveaway",
    code: "ABCDE",
    rules: validRules,
    winnerCount: 1,
    claimSeconds: 300,
    closesAt,
  }
}

/** A fresh temporary folder; the returned function removes it. */
export function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "rafflink-server-"))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}
