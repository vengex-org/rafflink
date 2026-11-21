import { codeAlphabet, codeLength } from "@rafflink/core/lib/codes"

const codePattern = new RegExp(`^[${codeAlphabet}]{${codeLength}}$`)

/** The giveaway code in what a person typed: the bare code in any case, or a link to the giveaway or its verify page; null when it holds none. */
export function parseGiveawayCode(input: string): string | null {
  const text = input.trim()
  const path = URL.canParse(text) ? new URL(text).pathname : text
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== "verify")
  const afterG = segments.indexOf("g") + 1
  const candidate = (afterG === 0 ? segments.at(-1) : segments[afterG])?.toUpperCase()
  return candidate !== undefined && codePattern.test(candidate) ? candidate : null
}
