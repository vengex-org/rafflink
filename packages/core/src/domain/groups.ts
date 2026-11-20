/** The ticket groups of a giveaway, in the order a tie between equal ticket counts resolves (later wins). */
export const groups = [
  "viewer",
  "follower",
  "sub_t1",
  "sub_t2",
  "sub_t3",
  "vip",
  "moderator",
] as const

export type Group = (typeof groups)[number]

/** Tickets per group; 0 means the group cannot enter. */
export type Tickets = Readonly<Record<Group, number>>

/** The group an entrant belongs to for ticket purposes, with its ticket count. */
export interface BestGroup {
  readonly group: Group
  readonly tickets: number
}

/** The member group with the most tickets, not their sum; a tie goes to the later group in `groups`. */
export function bestGroup(tickets: Tickets, memberOf: readonly Group[]): BestGroup {
  let best: BestGroup = { group: "viewer", tickets: tickets.viewer }
  for (const group of groups) {
    if (memberOf.includes(group) && tickets[group] >= best.tickets) {
      best = { group, tickets: tickets[group] }
    }
  }
  return best
}
