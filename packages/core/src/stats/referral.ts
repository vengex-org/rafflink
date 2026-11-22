const referralPattern = /^[a-z0-9-]{1,32}$/

/** The `ref` query value of a home page visit when it is a campaign label, else null: no case folding, no trimming, no partial match. */
export function parseReferral(raw: string | null): string | null {
  return raw !== null && referralPattern.test(raw) ? raw : null
}
