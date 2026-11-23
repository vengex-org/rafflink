import { describe, expect, it } from "bun:test"
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
  const all = {
    followerCheck: true,
    subTiers: true,
    vip: true,
    accountAge: true,
    pageEntry: true,
    chatEntry: true,
    subEntry: true,
    pointsEntry: true,
  }

  it("keeps every group on a platform that can tell them all", () => {
    expect(supportedGroups(all)).toEqual([
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
    expect(supportedGroups({ ...all, followerCheck: false, subTiers: false, vip: false })).toEqual([
      "viewer",
      "moderator",
    ])
  })
})
