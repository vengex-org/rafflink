/** One entry as the Merkle tree commits to it. `salt` is known to the entrant and the room only. */
export interface LeafPreimage {
  readonly platform: string
  readonly platformUserId: string
  readonly tickets: number
  readonly salt: Uint8Array
}

/** The root of a tree without leaves. */
export function emptyRoot(): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(new Uint8Array(0))
}

/**
 * SHA-256 of `platform|platformUserId|tickets|` followed by the salt. The salt is the last 16 bytes, so
 * a `|` inside an id cannot move the boundaries.
 */
export function leafHash(leaf: LeafPreimage): Promise<Uint8Array<ArrayBuffer>> {
  const head = new TextEncoder().encode(`${leaf.platform}|${leaf.platformUserId}|${leaf.tickets}|`)
  return sha256(concat(head, leaf.salt))
}

/**
 * The root over leaf hashes in the given order: a node is SHA-256 of 0x01, its left and its right child;
 * an odd node moves up unchanged. Leaves start with a platform name, never 0x01, so a node cannot pass for a leaf.
 */
export async function merkleRoot(leaves: readonly Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
  if (leaves.length === 0) return emptyRoot()
  let level: readonly Uint8Array[] = leaves
  while (level.length > 1) {
    const next: Uint8Array[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1]
      if (left === undefined) throw new Error("merkle level index outside the level")
      next.push(right === undefined ? left : await sha256(concat(nodePrefix, left, right)))
    }
    level = next
  }
  const [root] = level
  if (root === undefined) throw new Error("merkle level is empty")
  return new Uint8Array(root)
}

const nodePrefix = Uint8Array.of(1)

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
