import { fromHex } from "@rafflink/core/lib/encoding"
import { quicknet, quicknetPublicKey } from "@rafflink/core/lib/drand"
import type { BeaconRound } from "@rafflink/core/ports"

// Domain separation tag of the `bls-unchained-g1-rfc9380` scheme, which quicknet uses.
const dst = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_"

/**
 * Verifies the BLS12-381 signature of a quicknet round (G1 signature, G2 public key) over
 * SHA-256 of the round as 8 big-endian bytes. A round of another chain is never valid: only the
 * quicknet key is pinned. The pairing library is loaded on first use, so only the verify page pays for it.
 */
export async function verifyBeaconSignature(
  chainHash: string,
  beacon: BeaconRound,
): Promise<boolean> {
  const signature = fromHex(beacon.signature)
  const publicKey = fromHex(quicknetPublicKey)
  if (chainHash !== quicknet.chainHash || signature === null || publicKey === null) return false
  const { bls12_381 } = await import("@noble/curves/bls12-381.js")
  const message = new Uint8Array(8)
  new DataView(message.buffer).setBigUint64(0, BigInt(beacon.round))
  const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256", message))
  try {
    const { shortSignatures } = bls12_381
    return shortSignatures.verify(signature, shortSignatures.hash(hashed, dst), publicKey)
  } catch {
    // The library throws on bytes that are not a curve point; that is an invalid signature.
    return false
  }
}
