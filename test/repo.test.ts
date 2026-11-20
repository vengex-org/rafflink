import { describe, expect, it } from "bun:test"

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
})
