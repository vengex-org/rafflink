import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { Entrant } from "@rafflink/core/room/rows"
import { fuzzyMatch, type Match } from "./fuzzy-match.ts"

/** One row of the entrants table: the entrant, their pick when they won, and what a search matched. */
export interface ListedEntrant {
  readonly entrant: Entrant
  readonly winner: LiveWinner | null
  readonly login: Match | null
  readonly displayName: Match | null
}

/** Winners first, then everyone else, newest first: the winners whose claim is open on top, the settled ones after, each group by place. `entrants` come in the order they entered. */
export function orderEntrants(
  entrants: readonly Entrant[],
  winners: readonly LiveWinner[],
): ListedEntrant[] {
  const picked = new Set<number>()
  const winnerRows: ListedEntrant[] = []
  for (const winner of winners.toSorted(
    (a, b) => claimOpenRank(a) - claimOpenRank(b) || a.n - b.n,
  )) {
    const entrant = winner.entrySeq === null ? undefined : findBySeq(entrants, winner.entrySeq)
    if (entrant === undefined) continue
    picked.add(entrant.seq)
    winnerRows.push({ entrant, winner, login: null, displayName: null })
  }
  const others: ListedEntrant[] = []
  for (let index = entrants.length - 1; index >= 0; index--) {
    const entrant = entrants[index]
    if (entrant !== undefined && !picked.has(entrant.seq)) {
      others.push({ entrant, winner: null, login: null, displayName: null })
    }
  }
  return [...winnerRows, ...others]
}

const claimOpenRank = (winner: LiveWinner) => (winner.claim.state === "waiting" ? 0 : 1)

/** The rows whose login or display name match `query`, best match first and the given order among equals. A blank query keeps every row. */
export function searchEntrants(rows: readonly ListedEntrant[], query: string): ListedEntrant[] {
  const needle = query.trim()
  if (needle === "") return [...rows]
  const hits: { readonly row: ListedEntrant; readonly score: number }[] = []
  for (const row of rows) {
    const login = fuzzyMatch(needle, row.entrant.login)
    const displayName = fuzzyMatch(needle, row.entrant.displayName)
    if (login === null && displayName === null) continue
    const score = Math.max(login?.score ?? 0, displayName?.score ?? 0)
    hits.push({ row: { ...row, login, displayName }, score })
  }
  return hits.toSorted((a, b) => b.score - a.score).map((hit) => hit.row)
}

/** The entrant with `seq`, by binary search: `entrants` are sorted by `seq`. */
export function findBySeq(entrants: readonly Entrant[], seq: number): Entrant | undefined {
  let low = 0
  let high = entrants.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const entrant = entrants[middle]
    if (entrant === undefined) return undefined
    if (entrant.seq === seq) return entrant
    if (entrant.seq < seq) low = middle + 1
    else high = middle - 1
  }
  return undefined
}
