import type { Random } from "../ports.ts"
import { fromBase64, toBase64 } from "./encoding.ts"

export type SealReason =
  | "malformed-entry"
  | "bad-key-id"
  | "duplicate-key-id"
  | "not-base64"
  | "wrong-key-length"
  | "malformed-secret"
  | "unknown-key"
  | "cannot-open"

/** A key ring or sealed value that cannot be used. Names the reason, never a key or a plaintext. */
export class SealError extends Error {
  constructor(
    readonly reason: SealReason,
    options?: ErrorOptions,
  ) {
    super(`seal: ${reason}`, options)
  }
}

/** AES-256-GCM keys by id: `currentKeyId` seals new values, every key opens values sealed earlier. */
export interface KeyRing {
  readonly currentKeyId: string
  readonly keys: ReadonlyMap<string, CryptoKey>
}

const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/
const keyBytes = 32
// The 96-bit nonce AES-GCM is specified for.
const ivBytes = 12
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Reads `<keyId>:<base64 32-byte key>` entries; the first entry is the current key. */
export async function openKeyRing(entries: readonly [string, ...string[]]): Promise<KeyRing> {
  const [first, ...others] = entries
  const [currentKeyId, currentKey] = await importEntry(first.trim())
  const keys = new Map([[currentKeyId, currentKey]])
  for (const entry of others) {
    const [keyId, key] = await importEntry(entry.trim())
    if (keys.has(keyId)) throw new SealError("duplicate-key-id")
    keys.set(keyId, key)
  }
  return { currentKeyId, keys }
}

/** `aad` binds the value to its owner: a sealed value copied to another owner fails to open. */
export async function sealSecret(
  ring: KeyRing,
  plaintext: string,
  aad: string,
  random: Random,
): Promise<string> {
  const key = ring.keys.get(ring.currentKeyId)
  if (key === undefined) throw new SealError("unknown-key")
  const iv = new Uint8Array(random.bytes(ivBytes))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  )
  return [ring.currentKeyId, toBase64(iv), toBase64(new Uint8Array(ciphertext))].join(".")
}

/** Opens a value sealed with any key of the ring. */
export async function openSecret(ring: KeyRing, sealed: string, aad: string): Promise<string> {
  const [keyId, ivText, ciphertextText, ...rest] = sealed.split(".")
  if (
    keyId === undefined
    || ivText === undefined
    || ciphertextText === undefined
    || rest.length > 0
  ) {
    throw new SealError("malformed-secret")
  }
  const iv = fromBase64(ivText)
  const ciphertext = fromBase64(ciphertextText)
  if (iv === null || iv.length !== ivBytes || ciphertext === null) {
    throw new SealError("malformed-secret")
  }
  const key = ring.keys.get(keyId)
  if (key === undefined) throw new SealError("unknown-key")
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
      key,
      ciphertext,
    )
    return decoder.decode(plaintext)
  } catch (cause) {
    if (cause instanceof DOMException) throw new SealError("cannot-open", { cause })
    throw cause
  }
}

async function importEntry(entry: string): Promise<[string, CryptoKey]> {
  const separator = entry.indexOf(":")
  if (separator === -1) throw new SealError("malformed-entry")
  const keyId = entry.slice(0, separator)
  if (!keyIdPattern.test(keyId)) throw new SealError("bad-key-id")
  const raw = fromBase64(entry.slice(separator + 1))
  if (raw === null) throw new SealError("not-base64")
  if (raw.length !== keyBytes) throw new SealError("wrong-key-length")
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])
  return [keyId, key]
}
