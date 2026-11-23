import type { ExchangedCode, UserProfile } from "../../platform/provider.ts"
import type { Parsed } from "../../lib/parsed.ts"
import { twitchImageUrl } from "./image-url.ts"

export type Malformed = Parsed<never, "malformed">

/** Subscription tier as Twitch writes it. */
export type Tier = "1000" | "2000" | "3000"

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
  const {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    expires_in: expiresInSeconds,
  } = body
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return malformed
  if (idToken !== undefined && typeof idToken !== "string") return malformed
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds)) return malformed
  if (expiresInSeconds <= 0) return malformed
  return {
    ok: true,
    value: { accessToken, refreshToken, expiresInSeconds, idToken: idToken ?? null },
  }
}

/** The app access token of a client credentials grant. */
export interface AppToken {
  readonly accessToken: string
  readonly expiresInSeconds: number
}

export function parseAppToken(body: unknown): Parsed<AppToken, "malformed"> {
  if (!isRecord(body)) return malformed
  const { access_token: accessToken, expires_in: expiresInSeconds } = body
  if (typeof accessToken !== "string") return malformed
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds)) return malformed
  if (expiresInSeconds <= 0) return malformed
  return { ok: true, value: { accessToken, expiresInSeconds } }
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
  return entry.ok ? userProfileOf(entry.value) : entry
}

/** Users of a lookup by id; an id Twitch does not know is absent. */
export function parseUserProfiles(body: unknown): Parsed<readonly UserProfile[], "malformed"> {
  const data = dataOf(body)
  if (!data.ok) return data
  const profiles: UserProfile[] = []
  for (const item of data.value) {
    const profile = isRecord(item) ? userProfileOf(item) : malformed
    if (!profile.ok) return profile
    profiles.push(profile.value)
  }
  return { ok: true, value: profiles }
}

/**
 * The subscriber badge images of a badge answer by version id (image of 36 px); a version without a
 * valid image is absent. An answer with no subscriber set has no versions.
 */
export function parseSubscriberBadgeImages(
  body: unknown,
): Parsed<ReadonlyMap<string, string>, "malformed"> {
  const data = dataOf(body)
  if (!data.ok) return data
  const images = new Map<string, string>()
  for (const set of data.value) {
    if (!isRecord(set) || typeof set.set_id !== "string" || !Array.isArray(set.versions)) {
      return malformed
    }
    if (set.set_id !== "subscriber") continue
    for (const version of set.versions) {
      if (!isRecord(version) || typeof version.id !== "string") return malformed
      const image = twitchImageUrl(version.image_url_2x)
      if (image !== null) images.set(version.id, image)
    }
  }
  return { ok: true, value: images }
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

/** Subscribers of a lookup by user id; a user who does not subscribe is absent. */
export function parseSubscribers(
  body: unknown,
): Parsed<readonly { readonly userId: string; readonly tier: Tier }[], "malformed"> {
  const data = dataOf(body)
  if (!data.ok) return data
  const subscribers: { userId: string; tier: Tier }[] = []
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.user_id !== "string" || !isTier(item.tier)) return malformed
    subscribers.push({ userId: item.user_id, tier: item.tier })
  }
  return { ok: true, value: subscribers }
}

export function parseBroadcasterType(body: unknown): Parsed<string, "malformed"> {
  const entry = firstEntry(body)
  if (!entry.ok) return entry
  const type = entry.value.broadcaster_type
  return typeof type === "string" ? { ok: true, value: type } : malformed
}

export function parseCustomRewards(
  body: unknown,
): Parsed<readonly { readonly id: string; readonly title: string }[], "malformed"> {
  const data = dataOf(body)
  if (!data.ok) return data
  const rewards: { id: string; title: string }[] = []
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") {
      return malformed
    }
    rewards.push({ id: item.id, title: item.title })
  }
  return { ok: true, value: rewards }
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

function userProfileOf(item: Record<string, unknown>): Parsed<UserProfile, "malformed"> {
  const { id, login, display_name: displayName, created_at: createdAt } = item
  if (typeof id !== "string" || typeof login !== "string" || typeof displayName !== "string") {
    return malformed
  }
  if (typeof createdAt !== "string") return malformed
  const instant = Date.parse(createdAt)
  if (!Number.isFinite(instant)) return malformed
  return {
    ok: true,
    value: {
      id,
      login,
      displayName,
      createdAt: instant,
      profileImageUrl: twitchImageUrl(item.profile_image_url),
    },
  }
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
