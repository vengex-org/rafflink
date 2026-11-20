/** An entrant as the draw sees it. `tickets` is a non-negative safe integer (parsed rules guarantee it). */
export interface DrawEntry extends Identity {
  readonly tickets: number
}

/** One account on one platform. */
export interface Identity {
  readonly platform: string
  readonly platformUserId: string
}

/** The entrant picked as winner `n`. */
export interface Winner extends Identity {
  readonly n: number
}

/** Picks winners 0..count-1; stops early when no tickets remain (fewer entrants than `count`). */
export async function drawWinners(
  seed: Uint8Array<ArrayBuffer>,
  entries: readonly DrawEntry[],
  count: number,
): Promise<Winner[]> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative safe integer")
  }
  const key = await importSeed(seed)
  // Sorted and totalled once; each pick leaves the list and the total, so a pick costs one pass, not a rebuild.
  const candidates = sortEntries(entries)
  let total = ticketTotal(candidates)
  const winners: Winner[] = []
  for (let n = 0; n < count && total > 0n; n++) {
    const index = await sampleIndex(key, n, total)
    const position = candidateAt(candidates, index)
    // splice(-1, 1) would drop the last candidate instead of failing.
    if (position === -1) throw new Error("ticket index outside the ticket total")
    const [taken] = candidates.splice(position, 1)
    if (taken === undefined) throw new Error("ticket index outside the ticket total")
    total -= BigInt(taken.tickets)
    winners.push({ n, platform: taken.platform, platformUserId: taken.platformUserId })
  }
  return winners
}

/**
 * Picks winner `n` among the entrants not in `excluded`; `excluded` holds every earlier pick,
 * rerolled ones included. Null when no tickets remain.
 */
export async function pickWinner(
  seed: Uint8Array<ArrayBuffer>,
  n: number,
  entries: readonly DrawEntry[],
  excluded: readonly Identity[],
): Promise<Identity | null> {
  return pick(await importSeed(seed), n, sortEntries(entries), excluded)
}

/**
 * Maps a digest to an index in [0, total). Reads the digest as 64-bit words and rejects words in the
 * biased tail above the largest multiple of `total`; null when every word is rejected.
 */
export function indexFromDigest(digest: Uint8Array, total: bigint): bigint | null {
  const wordCount = Math.floor(digest.length / wordBytes)
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
  const limit = wordRange - (wordRange % total)
  for (let i = 0; i < wordCount; i++) {
    const word = view.getBigUint64(i * wordBytes)
    if (word < limit) return word % total
  }
  return null
}

const wordBytes = 8
const wordRange = 1n << 64n

function importSeed(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", seed, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
}

function sortEntries(entries: readonly DrawEntry[]): DrawEntry[] {
  return entries.toSorted(
    (a, b) =>
      compareText(a.platform, b.platform) || compareText(a.platformUserId, b.platformUserId),
  )
}

// Code-unit order, not localeCompare: the order must not depend on the host locale.
function compareText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

async function pick(
  key: CryptoKey,
  n: number,
  sorted: readonly DrawEntry[],
  excluded: readonly Identity[],
): Promise<Identity | null> {
  const taken = new Set(excluded.map(identityKey))
  const candidates = sorted.filter((entry) => !taken.has(identityKey(entry)))
  const total = ticketTotal(candidates)
  if (total === 0n) return null

  const candidate = candidates[candidateAt(candidates, await sampleIndex(key, n, total))]
  if (candidate === undefined) throw new Error("ticket index outside the ticket total")
  return { platform: candidate.platform, platformUserId: candidate.platformUserId }
}

function ticketTotal(candidates: readonly DrawEntry[]): bigint {
  return candidates.reduce((sum, entry) => sum + BigInt(entry.tickets), 0n)
}

// The position of the candidate whose run of tickets holds `index`; -1 when the index is past the total.
function candidateAt(candidates: readonly DrawEntry[], index: bigint): number {
  let upTo = 0n
  for (const [position, candidate] of candidates.entries()) {
    upTo += BigInt(candidate.tickets)
    if (index < upTo) return position
  }
  return -1
}

// Round 0 signs the 8-byte `n`; a further round (all words rejected) appends the round number.
// A word is rejected with probability < total / 2^64, so reaching the cap means a broken digest.
async function sampleIndex(key: CryptoKey, n: number, total: bigint): Promise<bigint> {
  for (let round = 0; round < maxSampleRounds; round++) {
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message(n, round)))
    const index = indexFromDigest(digest, total)
    if (index !== null) return index
  }
  throw new Error("draw sampling exhausted its rounds")
}

const maxSampleRounds = 8

function message(n: number, round: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(round === 0 ? 8 : 12)
  const view = new DataView(bytes.buffer)
  view.setBigUint64(0, BigInt(n))
  if (round !== 0) view.setUint32(8, round)
  return bytes
}

function identityKey(identity: Identity): string {
  return JSON.stringify([identity.platform, identity.platformUserId])
}
