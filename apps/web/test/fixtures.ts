import type { GiveawayRules } from "@rafflink/core/domain/rules"
import type { DashboardGiveaway, ViewerState } from "@rafflink/core/http/json"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import type { GiveawayView } from "../src/api/client.ts"

export const rules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
}

/** The body of `GET /api/g/ABCDE` for a viewer who has not signed in. */
export const giveaway: GiveawayView & { readonly me: ViewerState } = {
  code: "ABCDE",
  title: "Summer giveaway",
  prize: "A gaming chair",
  streamerName: "Streamy",
  rules,
  status: "open",
  closesAt: null,
  claimSeconds: 300,
  entrantCount: 42,
  finished: false,
  poll: { intervalMs: 10, maxMs: 80 },
  me: { kind: "signed-out" },
}

export const dashboardGiveaway: DashboardGiveaway = {
  id: "gid-1",
  code: "ABCDE",
  title: "Summer giveaway",
  prize: "A gaming chair",
  rules,
  status: "open",
  closesAt: null,
  claimSeconds: 300,
  overlayToken: "tok-1",
  createdAt: 1_700_000_000_000,
}

export const liveSnapshot: LiveSnapshot = {
  title: "Summer giveaway",
  code: "ABCDE",
  status: "open",
  closesAt: null,
  entrantCount: 3,
  ticketTotal: 5,
  entriesPerSecond: 1.5,
  lastNames: ["Ada", "Bob"],
  winners: [],
  winnerChat: [],
  rerollOpen: false,
  rerollBlocked: null,
  roleRefreshFailures: 0,
  eventSubFailures: 0,
  chatClaimUnavailable: false,
}
