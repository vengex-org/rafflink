import type { Instant } from "../ports.ts"

export const minuteMs = 60_000
export const dayMs = 86_400_000

export function startOfMinute(at: Instant): Instant {
  return Math.floor(at / minuteMs) * minuteMs
}

export function startOfDay(at: Instant): Instant {
  return Math.floor(at / dayMs) * dayMs
}
