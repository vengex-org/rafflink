import { drawWinners, sortEntries } from "@rafflink/core/lib/draw"
import { quicknet, roundAtOrAfter } from "@rafflink/core/lib/drand"
import { toHex } from "@rafflink/core/lib/encoding"

/** The most names one list draw takes; the draw and the hash of a list this long still finish at once in a browser. */
export const maxNames = 5000

/** The same limit as a giveaway title. */
export const maxTitleLength = 100

/**
 * How far ahead of the commit the deciding round is published: time to show the hash or send the link to the
 * audience before anyone can know the random number.
 */
export const commitLeadMs = 60_000

/** The pasted names: one per line, trimmed, each once, in the order the draw reads them. */
export type ParsedNames =
  | { readonly kind: "names"; readonly names: readonly string[]; readonly repeats: number }
  | { readonly kind: "empty" }
  | { readonly kind: "too-many"; readonly count: number }

/** What a list draw fixes before its round: everything the winners and the hash follow from. */
export interface ListCommit {
  /** Empty when the draw has no title. */
  readonly title: string
  readonly winners: number
  readonly round: number
  /** When the list was fixed, by the clock of the browser that fixed it; nothing proves it. */
  readonly committedAt: number
  /** Unique and in {@link parseNames} order. */
  readonly names: readonly string[]
}

/** A share link read back: the commit without its names when the list was too long for the link. */
export interface DrawLink {
  readonly hash: string
  readonly commit: Omit<ListCommit, "names">
  readonly names: readonly string[] | null
}

export function parseNames(text: string): ParsedNames {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().normalize("NFC"))
    .filter((line) => line !== "")
  const names = sortEntries([...new Set(lines)].map(asEntrant)).map((entry) => entry.platformUserId)
  if (names.length === 0) return { kind: "empty" }
  if (names.length > maxNames) return { kind: "too-many", count: names.length }
  return { kind: "names", names, repeats: lines.length - names.length }
}

/** Fixes `names` to the first drand round published at least {@link commitLeadMs} after `now`. */
export function commitList(
  names: readonly string[],
  terms: { readonly title: string; readonly winners: number },
  now: number,
): ListCommit {
  return {
    title: terms.title,
    winners: terms.winners,
    round: roundAtOrAfter(quicknet, now + commitLeadMs),
    committedAt: now,
    names,
  }
}

/** Lower-case hex SHA-256 of everything the commit fixes, so a changed name, count, round or time changes it. */
export async function commitHash(commit: ListCommit): Promise<string> {
  const text = JSON.stringify([
    hashVersion,
    commit.title,
    commit.winners,
    commit.round,
    commit.committedAt,
    commit.names,
  ])
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))))
}

/** The winners in pick order: the giveaway draw over the names as entrants with one ticket each. */
export async function drawNames(
  seed: Uint8Array<ArrayBuffer>,
  names: readonly string[],
  count: number,
): Promise<string[]> {
  const entries = names.map((name) => ({ ...asEntrant(name), tickets: 1 }))
  const winners = await drawWinners(seed, entries, count)
  return winners.map((winner) => winner.platformUserId)
}

/**
 * The fragment of the share link, without `#`. The names go in only while the whole fragment fits
 * {@link maxFragmentLength}; a longer list travels as the file of {@link listFile}.
 */
export function shareFragment(commit: ListCommit, hash: string): string {
  const params = new URLSearchParams({
    v: String(linkVersion),
    h: hash,
    r: String(commit.round),
    w: String(commit.winners),
    c: String(commit.committedAt),
  })
  if (commit.title !== "") params.set("t", commit.title)
  const withNames = new URLSearchParams(params)
  withNames.set("n", commit.names.join("\n"))
  return withNames.toString().length <= maxFragmentLength ? withNames.toString() : params.toString()
}

/** Reads a share link fragment (with or without `#`); null when it is not one {@link shareFragment} could write. */
export function parseShareFragment(fragment: string): DrawLink | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""))
  const hash = params.get("h")
  const round = positiveInteger(params.get("r"))
  const winners = positiveInteger(params.get("w"))
  const committedAt = positiveInteger(params.get("c"))
  const title = params.get("t") ?? ""
  if (
    params.get("v") !== String(linkVersion)
    || hash === null
    || !hashPattern.test(hash)
    || round === null
    || winners === null
    || winners > maxNames
    || committedAt === null
    || title.length > maxTitleLength
  ) {
    return null
  }
  const listed = params.get("n")
  const parsed = listed === null ? null : parseNames(listed)
  if (parsed !== null && parsed.kind !== "names") return null
  return { hash, commit: { title, winners, round, committedAt }, names: parsed?.names ?? null }
}

/** The list file to share next to a link whose list was too long for it. */
export function listFile(commit: ListCommit): string {
  return JSON.stringify({ version: linkVersion, ...commit }, null, 2)
}

/** Reads a list file; null for anything {@link listFile} would not write. */
export function parseListFile(text: string): ListCommit | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  if (typeof body !== "object" || body === null) return null
  const { version, title, winners, round, committedAt, names } = Object.fromEntries(
    Object.entries(body),
  )
  if (
    version !== linkVersion
    || typeof title !== "string"
    || title.length > maxTitleLength
    || !isPositiveInteger(winners)
    || !isPositiveInteger(round)
    || !isPositiveInteger(committedAt)
    || !Array.isArray(names)
    || !names.every((name) => typeof name === "string")
  ) {
    return null
  }
  const parsed = parseNames(names.join("\n"))
  return parsed.kind === "names"
    ? { title, winners, round, committedAt, names: parsed.names }
    : null
}

// Bumped with any change to what the hash, the link or the file hold, so an old link fails to parse instead of mismatching.
const hashVersion = "rafflink-list-draw/1"
const linkVersion = 1

// A link of this length still fits one chat message on the common platforms (Discord stops at 2000 characters).
const maxFragmentLength = 1800

const listPlatform = "list"

const hashPattern = /^[0-9a-f]{64}$/
const encoder = new TextEncoder()

// One shared platform, so the draw's order of entrants is the order of the names, the same on every host locale.
function asEntrant(name: string) {
  return { platform: listPlatform, platformUserId: name }
}

function positiveInteger(text: string | null): number | null {
  if (text === null || !/^[1-9][0-9]*$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}
