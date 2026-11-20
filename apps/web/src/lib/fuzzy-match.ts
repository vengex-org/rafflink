/** Where a query matched in a text. */
export interface Match {
  /** Higher is a better match: a prefix beats a word start, which beats a contiguous run, which beats scattered letters. */
  readonly score: number
  /** Indexes of the matched characters in `Array.from(text)`. */
  readonly positions: readonly number[]
}

// Tier bases are far apart so the in-tier bonus (at most `maxBonus`) never lifts a match into the next tier.
const scatteredScore = 1000
const containedScore = 2000
const wordStartScore = 3000
const prefixScore = 4000
const maxBonus = 999

/** Case-insensitive match of `query` as a subsequence of `text`; null when its letters do not all occur in order. */
export function fuzzyMatch(query: string, text: string): Match | null {
  const letters = Array.from(text)
  const hay = letters.map((letter) => letter.toLowerCase())
  const needle = Array.from(query, (letter) => letter.toLowerCase())
  if (needle.length === 0 || needle.length > hay.length) return null

  const runs = runStarts(needle, hay)
  const first = runs[0]
  if (first === undefined) return scattered(needle, hay)

  if (first === 0) {
    return { score: prefixScore + shorterBonus(hay), positions: range(0, needle.length) }
  }
  const wordStart = runs.find((index) => startsWord(letters, index))
  if (wordStart !== undefined) {
    return { score: wordStartScore + shorterBonus(hay), positions: range(wordStart, needle.length) }
  }
  return {
    score: containedScore + maxBonus - Math.min(maxBonus, first),
    positions: range(first, needle.length),
  }
}

// In one tier a shorter text is the closer match.
function shorterBonus(hay: readonly string[]): number {
  return maxBonus - Math.min(maxBonus, hay.length)
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => start + offset)
}

// Every index where `needle` occurs as one unbroken run.
function runStarts(needle: readonly string[], hay: readonly string[]): number[] {
  const starts: number[] = []
  for (let index = 0; index + needle.length <= hay.length; index++) {
    if (needle.every((letter, offset) => hay[index + offset] === letter)) starts.push(index)
  }
  return starts
}

// The earliest letters of `hay` that spell `needle` in order; a tighter spread scores higher.
function scattered(needle: readonly string[], hay: readonly string[]): Match | null {
  const positions: number[] = []
  let from = 0
  for (const letter of needle) {
    const index = hay.indexOf(letter, from)
    if (index === -1) return null
    positions.push(index)
    from = index + 1
  }
  const spread = (positions.at(-1) ?? 0) - (positions[0] ?? 0)
  return { score: scatteredScore + maxBonus - Math.min(maxBonus, spread), positions }
}

// A word starts after anything that is not a letter or digit ("john_doe"), and at a capital after a small letter ("JohnDoe").
function startsWord(letters: readonly string[], index: number): boolean {
  const previous = letters[index - 1]
  const current = letters[index]
  if (previous === undefined || current === undefined) return false
  if (!/[\p{L}\p{N}]/u.test(previous)) return true
  return previous === previous.toLowerCase() && current !== current.toLowerCase()
}
