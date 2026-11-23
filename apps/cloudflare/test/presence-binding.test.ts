import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startFakeSentry, type FakeSentry } from "@rafflink/core/test/contract"
import type { Miniflare } from "miniflare"
import { startMiniflare } from "./start-worker.ts"

const env = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  // Key id, then 32 zero bytes in base64.
  TOKEN_SEAL_KEYS: "test:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "http://localhost",
}

let sentry: FakeSentry
let webDir: string
let miniflare: Miniflare | null

beforeEach(async () => {
  sentry = await startFakeSentry()
  webDir = mkdtempSync(join(tmpdir(), "rafflink-web-"))
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Rafflink</title>")
  miniflare = null
})

afterEach(async () => {
  await miniflare?.dispose()
  await sentry.stop()
  rmSync(webDir, { recursive: true, force: true })
})

describe("a Worker deployed without the presence bindings", () => {
  it("answers the presence upgrade 404, serves the pages and reports nothing", async () => {
    const started = await startMiniflare(
      { ...env, SENTRY_DSN: sentry.dsn },
      webDir,
      "without-presence",
    )
    miniflare = started.miniflare

    const presence = await fetch(new URL("/api/presence?kind=home", started.url), {
      headers: { upgrade: "websocket", connection: "Upgrade", origin: env.PUBLIC_URL },
    })
    const home = await fetch(new URL("/", started.url))
    await Bun.sleep(500)

    expect(presence.status).toBe(404)
    expect(home.status).toBe(200)
    expect(sentry.requests()).toBe(0)
  })
})
