import { isApiPath } from "./api-paths.ts"

/** The page a streamer lands on after signing in when the link names none. */
export const defaultReturnPath = "/dashboard"

// The path travels in the sealed state cookie, which has to stay small.
const maxLength = 200

/**
 * `raw` when it is a page of this site: one leading slash, no second slash, only visible ASCII (so no backslash,
 * control character or space) and not an API or sign-in path. Anything else, a full URL included, could send the
 * signed-in browser to another site or into the sign-in again.
 */
export function safeReturnPath(raw: string | undefined): string | null {
  if (raw === undefined || raw.length > maxLength) return null
  if (!raw.startsWith("/") || raw.startsWith("//") || isApiPath(raw)) return null
  return [...raw].every(isVisibleAscii) ? raw : null
}

// A backslash is read as a slash by browsers, and parsers drop tab and newline from a URL.
function isVisibleAscii(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 0x21 && code <= 0x7e && char !== "\\"
}
