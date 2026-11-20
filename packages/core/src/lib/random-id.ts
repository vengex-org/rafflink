import type { Random } from "../ports.ts"
import { toHex } from "./encoding.ts"

// 128 bits: enough that an id, a ticket, a state or an overlay token cannot be guessed.
const idBytes = 16

/** A fresh unguessable id as 32 hex characters. */
export function randomId(random: Random): string {
  return toHex(random.bytes(idBytes))
}
