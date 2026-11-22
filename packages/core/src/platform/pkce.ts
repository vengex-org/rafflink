import { toBase64 } from "../lib/encoding.ts"
import type { Random } from "../ports.ts"

// 32 bytes give the 43-character verifier, the shortest RFC 7636 allows.
const verifierBytes = 32

/** A fresh PKCE `code_verifier` (RFC 7636): unpadded base64url of random bytes. */
export function codeVerifier(random: Random): string {
  return base64Url(random.bytes(verifierBytes))
}

/** The S256 `code_challenge` of a verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}
