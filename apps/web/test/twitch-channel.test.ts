import { describe, expect, it } from "bun:test"
import { twitchChannelUrl } from "../src/lib/twitch-channel.ts"

describe("twitchChannelUrl", () => {
  it("lowercases a valid login into the channel address", () => {
    expect(twitchChannelUrl("Kovac_Plays")).toBe("https://www.twitch.tv/kovac_plays")
  })

  it.each(["", " ", "two words", "配信者", "a".repeat(26), "semi;colon", "a/b"])(
    "gives no address for %p",
    (name) => {
      expect(twitchChannelUrl(name)).toBeNull()
    },
  )

  it("accepts the longest login", () => {
    expect(twitchChannelUrl("a".repeat(25))).toBe(`https://www.twitch.tv/${"a".repeat(25)}`)
  })
})
