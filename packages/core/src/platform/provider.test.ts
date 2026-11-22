import { describe, expect, it } from "bun:test"
import { providerFor, UnknownPlatform, type PlatformProvider } from "./provider.ts"

// Only identity is compared, so no method is reached.
const twitch = { platform: "twitch" } as PlatformProvider

describe("providerFor", () => {
  it("finds the provider of a stored platform", () => {
    expect(providerFor({ twitch }, "twitch")).toBe(twitch)
  })

  it("throws for a platform without a provider", () => {
    expect(() => providerFor({ twitch }, "kick")).toThrow(UnknownPlatform)
  })
})
