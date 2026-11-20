import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveConfig } from "@rafflink/core/config"
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
  // A built file that reaches the Worker first is a billed request and, for a missing one, an HTML answer.
  it("leaves every file type of the web app's public folder to the assets and sends every page to the Worker", async () => {
    const { runWorkerFirst } = await readWranglerConfig()
    const publicDir = fileURLToPath(new URL("../../web/public", import.meta.url))
    const extensions = new Set(readdirSync(publicDir).map((name) => name.split(".").pop()))

    expect(runWorkerFirst[0]).toBe("/*")
    for (const extension of extensions) {
      expect(runWorkerFirst).toContain(`!/*.${extension}`)
    }
    expect(runWorkerFirst).toContain("!/*.js")
    expect(runWorkerFirst).toContain("!/*.css")
    expect(runWorkerFirst).not.toContain("!/*.txt")
    expect(runWorkerFirst).not.toContain("!/*.xml")
  })

  it("cron string matches config validate period", async () => {
    const { crons } = await readWranglerConfig()
    const { validatePeriodSeconds } = resolveConfig(required)
    const hours = validatePeriodSeconds / 3600

    expect(Number.isInteger(hours)).toBe(true)
    expect(crons).toEqual([hours === 1 ? "0 * * * *" : `0 */${hours} * * *`])
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
