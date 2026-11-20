export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

/** Canonical base64 only: text `toBase64` would not produce (stray characters, missing padding) gives null. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  let binary: string
  try {
    binary = atob(text)
  } catch (error) {
    if (error instanceof DOMException) return null
    throw error
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return toBase64(bytes) === text ? bytes : null
}
