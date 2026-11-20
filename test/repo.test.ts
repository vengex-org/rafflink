import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)

describe("repository", () => {
  it("is licensed under AGPL-3.0", async () => {
    const license = await Bun.file(new URL("LICENSE", root)).text()
    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE")
    expect(license).toContain("Version 3, 19 November 2007")
  })

  it("documents Twitch app registration and self-hosting in the README", async () => {
    const readme = await Bun.file(new URL("README.md", root)).text()
    expect(readme).toMatch(/^## Twitch app registration$/m)
    expect(readme).toMatch(/^## Self-hosting$/m)
  })

  // A relative asset URL resolves against /g/<code> and the SPA fallback answers it with HTML: a blank page.
  it("builds the web app with root-relative asset URLs so nested routes load", async () => {
    const web = new URL("apps/web/", root)
    const build = Bun.spawnSync(["bun", "run", "build"], { cwd: fileURLToPath(web) })
    expect(build.exitCode).toBe(0)
    const html = await Bun.file(new URL("dist/index.html", web)).text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) expect(asset).toStartWith("/")
  }, 60_000)
})
