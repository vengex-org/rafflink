import { toHex } from "./encoding.ts"

/** The SHA-256 hex of a link's 128-bit random secret, which is what the store keeps, so a leaked table opens no link. */
export async function tokenHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))
  return toHex(new Uint8Array(digest))
}
