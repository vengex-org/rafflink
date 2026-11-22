/** The page a streamer lands on after signing in when the link names none. */
export const defaultReturnPath = "/dashboard"

// The path travels in the sealed state cookie, which has to stay small.
const maxLength = 200

/**
 * `raw` when it is a path on this site: one leading slash, no second slash, no backslash and no control
 * character. Anything else, a full URL included, could send the signed-in browser to another site.
 */
export function safeReturnPath(raw: string | undefined): string | null {
  if (raw === undefined || raw.length > maxLength) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  return [...raw].some(isUnsafe) ? null : raw
}

// A backslash is read as a slash by browsers, and parsers drop tab and newline from a URL.
function isUnsafe(char: string): boolean {
  const code = char.charCodeAt(0)
  return code <= 0x1f || code === 0x7f || char === "\\"
}
