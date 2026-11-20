import type { Instant } from "../../ports.ts"
import type { Parsed } from "../../lib/parsed.ts"

export type Malformed = Parsed<never, "malformed">

/** Subscription tier as Twitch writes it. */
export type Tier = "1000" | "2000" | "3000"

export interface ExchangedCode {
  readonly accessToken: string
  readonly refreshToken: string
  /** `null` when the code was not requested with the `openid` scope. */
  readonly idToken: string | null
}

/** The Helix user of an access token. */
export interface UserProfile {
  readonly login: string
  readonly displayName: string
  readonly createdAt: Instant
}

/** A Helix user found by login. */
export interface UserLogin {
  readonly id: string
  readonly login: string
}

export interface RolePage {
  readonly userIds: readonly string[]
  /** `null` on the last page. */
  readonly cursor: string | null
}

const malformed: Malformed = { ok: false, issue: "malformed" }

export function parseTokenResponse(body: unknown): Parsed<ExchangedCode, "malformed"> {
  if (!isRecord(body)) return malformed
  const { access_token: accessToken, refresh_token: refreshToken, id_token: idToken } = body
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return malformed
  if (idToken !== undefined && typeof idToken !== "string") return malformed
  return { ok: true, value: { accessToken, refreshToken, idToken: idToken ?? null } }
}

/** The app access token of a client credentials grant. */
export function parseAppToken(body: unknown): Parsed<string, "malformed"> {
  return isRecord(body) && typeof body.access_token === "string"
    ? { ok: true, value: body.access_token }
    : malformed
}

/** Users of a lookup by login; a login Twitch does not know is absent. */
export function parseUserLogins(body: unknown): Parsed<readonly UserLogin[], "malformed"> {
  const data = dataOf(body)
  if (!data.ok) return data
  const users: UserLogin[] = []
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.login !== "string") {
      return malformed
    }
    users.push({ id: item.id, login: item.login })
  }
  return { ok: true, value: users }
}

export function parseTier(body: unknown): Parsed<Tier, "malformed"> {
  const entry = firstEntry(body)
  if (!entry.ok) return entry
  const tier = entry.value.tier
  return isTier(tier) ? { ok: true, value: tier } : malformed
}

/** Whether the viewer follows the broadcaster the request filtered by. */
export function parseFollowed(body: unknown): Parsed<boolean, "malformed"> {
  const data = dataOf(body)
  return data.ok ? { ok: true, value: data.value.length > 0 } : data
}

export function parseUserProfile(body: unknown): Parsed<UserProfile, "malformed"> {
  const entry = firstEntry(body)
  if (!entry.ok) return entry
  const { login, display_name: displayName, created_at: createdAt } = entry.value
  if (typeof login !== "string" || typeof displayName !== "string") return malformed
  if (typeof createdAt !== "string") return malformed
  const instant = Date.parse(createdAt)
  if (!Number.isFinite(instant)) return malformed
  return { ok: true, value: { login, displayName, createdAt: instant } }
}

export function parseRolePage(body: unknown): Parsed<RolePage, "malformed"> {
  const data = dataOf(body)
  if (!data.ok || !isRecord(body)) return malformed
  const userIds: string[] = []
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.user_id !== "string") return malformed
    userIds.push(item.user_id)
  }
  const { pagination } = body
  if (!isRecord(pagination)) return malformed
  const { cursor } = pagination
  if (cursor !== undefined && typeof cursor !== "string") return malformed
  return { ok: true, value: { userIds, cursor: cursor ?? null } }
}

export function parseValidated(body: unknown): Parsed<{ userId: string }, "malformed"> {
  if (!isRecord(body) || typeof body.user_id !== "string") return malformed
  return { ok: true, value: { userId: body.user_id } }
}

/** A created subscription: Twitch answers with the subscription in `data`. */
export function parseSubscriptionCreated(body: unknown): Parsed<null, "malformed"> {
  const entry = firstEntry(body)
  return entry.ok && typeof entry.value.id === "string" ? { ok: true, value: null } : malformed
}

function dataOf(body: unknown): Parsed<readonly unknown[], "malformed"> {
  return isRecord(body) && Array.isArray(body.data) ? { ok: true, value: body.data } : malformed
}

function firstEntry(body: unknown): Parsed<Record<string, unknown>, "malformed"> {
  const data = dataOf(body)
  if (!data.ok) return data
  const [first] = data.value
  return isRecord(first) ? { ok: true, value: first } : malformed
}

function isTier(value: unknown): value is Tier {
  return value === "1000" || value === "2000" || value === "3000"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
