import { describe, expect, it } from "bun:test"
import { twitchImageUrl } from "./image-url.ts"

describe("twitchImageUrl", () => {
  it("accepts an https URL on Twitch's image host", () => {
    const url = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png"

    expect(twitchImageUrl(url)).toBe(url)
  })

  it.each([
    ["http scheme", "http://static-cdn.jtvnw.net/a.png"],
    ["another host", "https://example.com/a.png"],
    ["a lookalike host", "https://static-cdn.jtvnw.net.evil.example/a.png"],
    ["a subdomain", "https://x.static-cdn.jtvnw.net/a.png"],
    ["credentials", "https://user:pass@static-cdn.jtvnw.net/a.png"],
    ["a port", "https://static-cdn.jtvnw.net:8443/a.png"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a relative path", "/a.png"],
    ["an empty string", ""],
  ])("rejects %s", (_name, value) => {
    expect(twitchImageUrl(value)).toBeNull()
  })

  it("rejects a value that is not a string", () => {
    expect(twitchImageUrl(undefined)).toBeNull()
    expect(twitchImageUrl(null)).toBeNull()
    expect(twitchImageUrl(42)).toBeNull()
  })
})
