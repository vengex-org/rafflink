import type { LeavesJson, MyLeafJson, VerifyJson } from "@rafflink/core/http/json"
import { drawLeafPicks } from "@rafflink/core/lib/draw"
import { parseBeaconRound, publicDrandUrls, roundPath, roundTime } from "@rafflink/core/lib/drand"
import { fromHex, toHex } from "@rafflink/core/lib/encoding"
import { leafHash, merkleRoot } from "@rafflink/core/lib/merkle"
import type { BeaconRound } from "@rafflink/core/ports"
import { verifyBeaconSignature } from "./beacon-signature.ts"

/** What a committed giveaway published before its draw. */
export type Commitment = NonNullable<VerifyJson["commitment"]>

export type Match = "match" | "mismatch"

/** Where the viewer's own entry stands in the published list. */
export type OwnEntry =
  | { readonly kind: "missing" }
  | {
      readonly kind: "found"
      /** Position in the leaf list, from 0. */
      readonly leaf: number
      readonly tickets: number
      /** The pick this entry holds, `null` when it won nothing or only a rerolled pick. */
      readonly pick: number | null
    }

/** What the page recomputed. `winners` and `signature` are `unavailable` when no drand source answered and `none` before any draw. An invalid signature also makes `winners` a mismatch. */
export interface Verdict {
  readonly counts: Match
  readonly root: Match
  /** The drand round was published after the room says it committed. */
  readonly timing: Match
  readonly signature: "valid" | "invalid" | "unavailable" | "none"
  readonly winners: Match | "unavailable" | "none"
  /** Null when the viewer is not signed in, has no entry or has no salt yet. */
  readonly mine: OwnEntry | null
}

export interface DrawEvidence {
  readonly verify: VerifyJson
  readonly commitment: Commitment
  readonly leaves: LeavesJson
  readonly mine: MyLeafJson | null
}

/** Recomputes the root, the counts and the winners from the published leaves and the drand round, and finds the viewer's own leaf. */
export async function verifyDraw(evidence: DrawEvidence): Promise<Verdict> {
  const { verify, commitment, leaves, mine } = evidence
  const tickets = leaves.tickets.reduce((sum, count) => sum + count, 0)
  const root = toHex(
    await merkleRoot(
      leaves.hashes.map((hash, index) => ({
        hash: bytesOf(hash),
        tickets: leaves.tickets[index] ?? 0,
      })),
    ),
  )
  const beacon = await checkBeacon(verify, commitment, leaves)
  return {
    counts: matches(leaves.hashes.length === verify.entrantCount && tickets === verify.ticketTotal),
    root: matches(root === commitment.merkleRoot),
    timing: matches(roundTime(commitment, commitment.round) > commitment.committedAt),
    signature: beacon.signature,
    winners: beacon.winners,
    mine: mine === null ? null : await findOwnEntry(mine, verify, leaves),
  }
}

/** Reads a round from the public drand APIs in turn; null when none of them gave one that checks out. */
export async function fetchBeaconRound(
  chainHash: string,
  round: number,
): Promise<BeaconRound | null> {
  for (const base of publicDrandUrls) {
    try {
      const response = await fetch(`${base}${roundPath(chainHash, round)}`)
      if (!response.ok) continue
      const parsed = await parseBeaconRound(await response.json(), round)
      if (parsed !== null) return parsed
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof SyntaxError)) throw error
    }
  }
  return null
}

async function checkBeacon(
  verify: VerifyJson,
  commitment: Commitment,
  leaves: LeavesJson,
): Promise<Pick<Verdict, "signature" | "winners">> {
  if (verify.picks.length === 0) return { signature: "none", winners: "none" }
  const beacon = await fetchBeaconRound(commitment.chainHash, commitment.round)
  if (beacon === null) return { signature: "unavailable", winners: "unavailable" }
  if (!(await verifyBeaconSignature(commitment.chainHash, beacon))) {
    return { signature: "invalid", winners: "mismatch" }
  }
  // The first picks are the draw itself: as many as the giveaway's winner count, or everyone who entered.
  const drawn = Math.min(verify.winnerCount, leaves.tickets.length)
  const replay = await drawLeafPicks(beacon.randomness, leaves.tickets, verify.picks.length)
  const winners = matches(
    verify.picks.length >= drawn
      && replay.length === verify.picks.length
      && replay.every(
        (pick, index) =>
          pick.n === verify.picks[index]?.n && pick.leafIndex === verify.picks[index]?.leafIndex,
      ),
  )
  return { signature: "valid", winners }
}

async function findOwnEntry(
  mine: MyLeafJson,
  verify: VerifyJson,
  leaves: LeavesJson,
): Promise<OwnEntry | null> {
  if (mine.salt === null) return null
  const hash = toHex(await leafHash({ ...mine, salt: bytesOf(mine.salt) }))
  const leaf = leaves.hashes.indexOf(hash)
  if (leaf === -1 || leaves.tickets[leaf] !== mine.tickets) return { kind: "missing" }
  const pick = verify.picks.find((candidate) => candidate.leafIndex === leaf && !candidate.rerolled)
  return { kind: "found", leaf, tickets: mine.tickets, pick: pick?.n ?? null }
}

function matches(ok: boolean): Match {
  return ok ? "match" : "mismatch"
}

// The client reads every hash and salt at its edge as lower-case hex, so a failure here is a bug.
function bytesOf(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = fromHex(hex)
  if (bytes === null) throw new TypeError("not lower-case hex")
  return bytes
}
