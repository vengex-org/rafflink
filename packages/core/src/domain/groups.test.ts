import { describe, expect, it } from "bun:test"
import type { PlatformCapabilities } from "../platform/provider.ts"
import { bestGroup, supportedGroups, type Tickets } from "./groups.ts"

const tickets: Tickets = {
  viewer: 1,
  follower: 2,
  sub_t1: 5,
  sub_t2: 6,
  sub_t3: 7,
  vip: 3,
  moderator: 4,
}

describe("bestGroup", () => {
  it("takes the group with the most tickets, not the sum", () => {
    expect(bestGroup(tickets, ["viewer", "follower", "vip"])).toEqual({ group: "vip", tickets: 3 })
  })

  it("ignores groups the viewer is not a member of", () => {
    expect(bestGroup(tickets, ["viewer"])).toEqual({ group: "viewer", tickets: 1 })
  })

  it("resolves a tie to the later group", () => {
    const tied: Tickets = { ...tickets, follower: 3, vip: 3 }
    expect(bestGroup(tied, ["viewer", "follower", "vip"])).toEqual({ group: "vip", tickets: 3 })
  })

  it("returns 0 tickets when every member group has 0", () => {
    const none: Tickets = { ...tickets, viewer: 0, follower: 0 }
    expect(bestGroup(none, ["viewer", "follower"]).tickets).toBe(0)
  })
})

describe("supportedGroups", () => {
  const all: PlatformCapabilities = {
    followerCheck: true,
    subTiers: true,
    vip: true,
    accountAge: true,
    moderatorRole: true,
    pageEntry: true,
    chatEntry: true,
    subEntry: true,
    pointsEntry: true,
    chatBadgeGroups: [],
  }

  it("keeps every group on a platform that can tell them all", () => {
    expect(supportedGroups(all, false)).toEqual([
      "viewer",
      "follower",
      "sub_t1",
      "sub_t2",
      "sub_t3",
      "vip",
      "moderator",
    ])
  })

  it("drops the groups the platform cannot tell, keeping viewers and moderators", () => {
    expect(
      supportedGroups({ ...all, followerCheck: false, subTiers: false, vip: false }, false),
    ).toEqual(["viewer", "moderator"])
  })

  it("keeps only viewers on a platform that tells no channel role either", () => {
    expect(
      supportedGroups(
        {
          ...all,
          followerCheck: false,
          subTiers: false,
          vip: false,
          moderatorRole: false,
        },
        false,
      ),
    ).toEqual(["viewer"])
  })

  it("adds the chat badge groups only when every entrant shows a badge or a sub event", () => {
    const kick: PlatformCapabilities = {
      ...all,
      followerCheck: false,
      subTiers: false,
      vip: false,
      moderatorRole: false,
      chatBadgeGroups: ["sub_t1", "moderator"],
    }

    expect(supportedGroups(kick, true)).toEqual(["viewer", "sub_t1", "moderator"])
    expect(supportedGroups(kick, false)).toEqual(["viewer"])
  })
})
