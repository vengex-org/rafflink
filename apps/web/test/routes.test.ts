import { describe, expect, it } from "bun:test"
import { readNotice } from "../src/lib/dashboard-notice.ts"
import {
  dashboardCreatedPath,
  dashboardNewPath,
  giveawayPath,
  livePath,
  overlayPath,
  streamerSignInPath,
  verifyPath,
  viewerSignInPath,
} from "../src/lib/routes.ts"

describe("route paths", () => {
  it("writes the public pages of a giveaway by its code", () => {
    expect(giveawayPath("ABCDE")).toBe("/ABCDE")
    expect(verifyPath("ABCDE")).toBe("/ABCDE/verify")
  })

  it("encodes an id or code that holds a reserved character", () => {
    expect(livePath("a/b c")).toBe("/live/a%2Fb%20c")
    expect(giveawayPath("A?B")).toBe("/A%3FB")
    expect(dashboardCreatedPath("x#1")).toBe("/dashboard/created/x%231")
    expect(overlayPath("i/d", "t k")).toBe("/overlay/i%2Fd/t%20k")
  })

  it("writes only the overlay options that differ from the defaults", () => {
    expect(overlayPath("i", "t")).toBe("/overlay/i/t")
    expect(overlayPath("i", "t", { mode: "auto", qr: false })).toBe("/overlay/i/t")
    expect(overlayPath("i", "t", { mode: "compact", qr: true })).toBe(
      "/overlay/i/t?mode=compact&qr=1",
    )
    expect(overlayPath("i", "t", { mode: "auto", qr: true })).toBe("/overlay/i/t?qr=1")
  })

  it("writes the wizard with the giveaway to copy and the step", () => {
    expect(dashboardNewPath()).toBe("/dashboard/new")
    expect(dashboardNewPath({ from: "g 1" })).toBe("/dashboard/new?from=g+1")
    expect(dashboardNewPath({ from: "g1", step: 2 })).toBe("/dashboard/new?from=g1&step=2")
  })

  it("asks the streamer sign-in to return to a page, and to the dashboard when none is named", () => {
    expect(streamerSignInPath("/dashboard")).toBe("/auth/twitch/streamer/start")
    expect(streamerSignInPath("/live/g1?q=a&clean=1")).toBe(
      "/auth/twitch/streamer/start?return=%2Flive%2Fg1%3Fq%3Da%26clean%3D1",
    )
  })

  it("starts the viewer sign-in for a giveaway code", () => {
    expect(viewerSignInPath("ABCDE")).toBe("/auth/twitch/viewer/start?giveaway=ABCDE")
  })
})

describe("dashboard notice", () => {
  it("reads the notices a dashboard screen leaves in the history entry", () => {
    expect(readNotice({ kind: "not-approved" })).toEqual({ kind: "not-approved" })
    expect(readNotice({ kind: "created", roomReady: false, usageLow: 3 })).toEqual({
      kind: "created",
      roomReady: false,
      usageLow: 3,
    })
    expect(readNotice({ kind: "created", roomReady: true, usageLow: null })).toEqual({
      kind: "created",
      roomReady: true,
      usageLow: null,
    })
  })

  it.each([
    null,
    undefined,
    "created",
    42,
    {},
    { kind: "other" },
    { kind: "created" },
    { kind: "created", roomReady: "yes", usageLow: null },
    { kind: "created", roomReady: true, usageLow: "3" },
    { kind: "created", roomReady: true },
  ])("reads %p as no notice", (state) => {
    expect(readNotice(state)).toBeNull()
  })
})
