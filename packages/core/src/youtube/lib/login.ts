// A handle is 3 to 30 letters, digits, underscores, hyphens and periods (YouTube Help, handle guidelines).
const handlePattern = /^[a-z0-9._-]{3,30}$/i

/** Typed text or a chat name as a YouTube handle in lower case without its `@`; null when it cannot be one. */
export function youtubeLogin(text: string): string | null {
  const handle = text.trim().replace(/^@/, "")
  return handlePattern.test(handle) ? handle.toLowerCase() : null
}
