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
