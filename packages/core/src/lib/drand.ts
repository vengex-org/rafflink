import type { BeaconRound, Instant } from "../ports.ts"
import { fromHex, toHex } from "./encoding.ts"

/** A drand chain: the hash that names it and the clock its rounds follow. */
export interface DrandChain {
  readonly chainHash: string
  readonly genesisSeconds: number
  readonly periodSeconds: number
}

/** The `quicknet` beacon: unchained, one round every 3 seconds. */
export const quicknet: DrandChain = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesisSeconds: 1_692_803_367,
  periodSeconds: 3,
}

/** The quicknet public key (G2, compressed, hex) from `/info` of {@link quicknet}; beacon signatures verify against it. */
export const quicknetPublicKey =
  "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a"

/** Public HTTP APIs of drand, in the order a client tries them; the page security policy allows exactly these origins. */
export const publicDrandUrls = ["https://api.drand.sh", "https://drand.cloudflare.com"] as const

/** The chain a room's config names. */
export function drandChain(config: {
  readonly drandChainHash: string
  readonly drandGenesisSeconds: number
  readonly drandPeriodSeconds: number
}): DrandChain {
  return {
    chainHash: config.drandChainHash,
    genesisSeconds: config.drandGenesisSeconds,
    periodSeconds: config.drandPeriodSeconds,
  }
}

const msPerSecond = 1000

/** The first round published at `at` or later. */
export function roundAtOrAfter(chain: DrandChain, at: Instant): number {
  const sinceGenesis = at - chain.genesisSeconds * msPerSecond
  return Math.max(0, Math.ceil(sinceGenesis / (chain.periodSeconds * msPerSecond))) + 1
}

/** The instant round `round` is published. */
export function roundTime(chain: DrandChain, round: number): Instant {
  return (chain.genesisSeconds + (round - 1) * chain.periodSeconds) * msPerSecond
}

/** Path of one round on a drand HTTP API. */
export function roundPath(chainHash: string, round: number): string {
  return `/${chainHash}/public/${round}`
}

/**
 * Reads a drand round answer: the round must be the one asked for and the randomness must be the
 * SHA-256 of the signature, which is how drand derives it. Null for anything else.
 */
export async function parseBeaconRound(body: unknown, round: number): Promise<BeaconRound | null> {
  if (typeof body !== "object" || body === null) return null
  const answer = Object.fromEntries(Object.entries(body))
  const { randomness, signature } = answer
  if (answer.round !== round || typeof randomness !== "string" || typeof signature !== "string") {
    return null
  }
  const seed = fromHex(randomness)
  const signed = fromHex(signature)
  if (seed === null || seed.length !== 32 || signed === null || signed.length === 0) return null
  const derived = new Uint8Array(await crypto.subtle.digest("SHA-256", signed))
  return toHex(derived) === randomness ? { round, randomness: seed, signature } : null
}
