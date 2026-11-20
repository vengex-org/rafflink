import type { Group } from "@rafflink/core/domain/groups"
import type { IneligibleReason } from "@rafflink/core/domain/rules"
import type { ClaimedVia, RoomStatus } from "@rafflink/core/room/rows"
import type { ClaimKind, CloseKind, DrawKind, RerollKind } from "../api/client.ts"
import type { CreateIssue } from "@rafflink/core/http/create-input"

export const reasonText: Readonly<Record<IneligibleReason, string>> = {
  broadcaster: "The broadcaster cannot enter their own giveaway.",
  "subs-only": "This giveaway is for subscribers only.",
  "followers-only": "This giveaway is for followers only.",
  "account-too-young": "Your Twitch account is too new for this giveaway.",
  "no-tickets": "Your group gets no tickets in this giveaway.",
}

/** What would let the viewer in, shown under the reason. */
export const reasonHelp: Readonly<Record<IneligibleReason, string>> = {
  broadcaster: "Sign in with a different Twitch account to enter.",
  "subs-only": "Subscribe to the channel on Twitch, then open this link again.",
  "followers-only": "Follow the channel on Twitch, then open this link again.",
  "account-too-young":
    "Come back when your account is older. Entering from another account will not help.",
  "no-tickets": "The streamer gave your group no tickets, so you cannot win this one.",
}

export const groupLabel: Readonly<Record<Group, string>> = {
  viewer: "Viewers",
  follower: "Followers",
  sub_t1: "Subscribers, tier 1",
  sub_t2: "Subscribers, tier 2",
  sub_t3: "Subscribers, tier 3",
  vip: "VIPs",
  moderator: "Moderators",
}

/** What a giveaway is called on screen; the streamer may leave the title empty. */
export function giveawayName(title: string | null, code: string): string {
  return title ?? `Giveaway ${code}`
}

export const statusLabel: Readonly<Record<RoomStatus, string>> = {
  open: "Entries open",
  closed: "Entries closed",
  drawn: "Winners drawn",
}

export const viewerClaimText: Readonly<Record<ClaimKind | "rejected", string>> = {
  claimed: "Claimed! The streamer will contact you.",
  "already-claimed": "This prize is already claimed.",
  expired: "The claim time ran out.",
  rerolled: "The streamer picked another winner.",
  "not-a-winner": "You are not a winner of this giveaway.",
  rejected: "Your claim did not go through. Sign in with Twitch again and press Claim my prize.",
}

export const closeText: Readonly<Record<CloseKind | "rejected", string>> = {
  closed: "Entries closed.",
  "not-open": "Entries were already closed.",
  rejected: "Could not close entries. Reload the page and try again.",
}

export const drawText: Readonly<Record<DrawKind | "rejected", string>> = {
  drawn: "Winners drawn.",
  "not-closed": "Close entries before drawing.",
  "already-drawn": "Winners are already drawn. Pick another winner instead.",
  rejected: "Could not draw. Enter a whole number of winners, at least 1.",
}

export const rerollText: Readonly<Record<RerollKind | "rejected", string>> = {
  rerolled: "Another winner was picked.",
  "already-rerolled": "Another winner was already picked for this place.",
  "already-claimed": "This winner already claimed.",
  "unknown-pick": "There is no such winner.",
  "not-drawn": "Draw winners first.",
  "no-entrants-left": "No entrants are left to pick.",
  "try-again": "That did not work. Try again.",
  rejected: "Could not pick another winner.",
}

export const markClaimedText: Readonly<Record<ClaimKind | "rejected", string>> = {
  claimed: "Marked as claimed.",
  "already-claimed": "This winner already claimed.",
  expired: "The claim time ran out.",
  rerolled: "This winner was replaced by another one.",
  "not-a-winner": "There is no such winner.",
  rejected: "Could not mark the claim.",
}

export const issueText: Readonly<Record<CreateIssue["code"], string>> = {
  "not-an-object": "Invalid request.",
  missing: "This field is required.",
  "not-a-boolean": "Invalid value.",
  "not-a-string": "Enter text.",
  "not-a-non-negative-integer": "Enter a whole number, 0 or more.",
  "not-a-positive-integer": "Enter a whole number, 1 or more.",
  blank: "This field cannot be empty.",
  "too-long": "This is too long. Make it shorter.",
  "not-a-timestamp": "Enter a valid date and time.",
  "in-the-past": "The end time must be in the future.",
}

export const viaLabel: Readonly<Record<ClaimedVia, string>> = {
  rafflink: "Claimed on Rafflink",
  chat: "Claimed in chat",
  manual: "Marked claimed by hand",
}
