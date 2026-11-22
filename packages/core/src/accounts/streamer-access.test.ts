import { describe, expect, it } from "bun:test"
import { canCreateGiveaways } from "./streamer-access.ts"

const streamer = { platform: "twitch", platformUserId: "200", approvedAt: null }
const noAdmins = { isAdmin: async () => false }
const admins = {
  isAdmin: async (platform: string, id: string) => platform === "twitch" && id === "200",
}

describe("canCreateGiveaways", () => {
  it("allows everyone while signup is open", async () => {
    expect(await canCreateGiveaways({ openSignup: true }, noAdmins, streamer)).toBe(true)
  })

  it("refuses an unapproved streamer while signup is closed", async () => {
    expect(await canCreateGiveaways({ openSignup: false }, noAdmins, streamer)).toBe(false)
  })

  it("allows an approved streamer while signup is closed", async () => {
    expect(
      await canCreateGiveaways({ openSignup: false }, noAdmins, { ...streamer, approvedAt: 0 }),
    ).toBe(true)
  })

  it("allows an admin while signup is closed", async () => {
    expect(await canCreateGiveaways({ openSignup: false }, admins, streamer)).toBe(true)
  })
})
