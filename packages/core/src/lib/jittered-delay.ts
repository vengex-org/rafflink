import type { Random } from "../ports.ts"

/** `delayMs` moved by a random share of at most `percent` percent in either direction. */
export function jitteredDelay(random: Random, percent: number, delayMs: number): number {
  const unit = (random.bytes(1)[0] ?? 0) / 255
  return Math.round(delayMs * (1 + (unit * 2 - 1) * (percent / 100)))
}
