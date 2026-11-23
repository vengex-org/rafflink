import type { PointsReward } from "../../domain/rules.ts"
import type { Parsed } from "../../lib/parsed.ts"

/** A Kick account as `GET /public/v1/users` answers it. */
export interface KickUser {
  readonly id: string
  /** Kick's `name`, the username as its owner writes it. */
  readonly name: string
}

/** One created subscription of `POST /public/v1/events/subscriptions`, or the reason Kick refused it. */
export type SubscriptionOutcome =
  | { readonly ok: true; readonly subscriptionId: string }
  | { readonly ok: false; readonly error: string }

type Malformed = Parsed<never, "malformed">

const malformed: Malformed = { ok: false, issue: "malformed" }

/** Users of `GET /public/v1/users`; an id Kick does not know is absent. */
export function parseUsers(body: unknown): Parsed<readonly KickUser[], "malformed"> {
  const data = dataArray(body)
  if (!data.ok) return data
  const users: KickUser[] = []
  for (const item of data.value) {
    if (!isRecord(item) || !isUserId(item.user_id) || typeof item.name !== "string") {
      return malformed
    }
    users.push({ id: String(item.user_id), name: item.name })
  }
  return { ok: true, value: users }
}

/** The broadcaster user id of each channel of `GET /public/v1/channels`, keyed by its slug. */
export function parseChannelIds(body: unknown): Parsed<ReadonlyMap<string, string>, "malformed"> {
  const data = dataArray(body)
  if (!data.ok) return data
  const ids = new Map<string, string>()
  for (const item of data.value) {
    if (!isRecord(item) || !isUserId(item.broadcaster_user_id) || typeof item.slug !== "string") {
      return malformed
    }
    ids.set(item.slug, String(item.broadcaster_user_id))
  }
  return { ok: true, value: ids }
}

/** The answer for each event a subscribe call asks for, keyed by the event's name. */
export function parseSubscriptions(
  body: unknown,
): Parsed<ReadonlyMap<string, SubscriptionOutcome>, "malformed"> {
  const data = dataArray(body)
  if (!data.ok) return data
  const outcomes = new Map<string, SubscriptionOutcome>()
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.name !== "string") return malformed
    const { subscription_id: subscriptionId, error } = item
    if (typeof subscriptionId === "string" && subscriptionId !== "") {
      outcomes.set(item.name, { ok: true, subscriptionId })
    } else if (typeof error === "string") {
      outcomes.set(item.name, { ok: false, error })
    } else {
      return malformed
    }
  }
  return { ok: true, value: outcomes }
}

/** The enabled rewards of `GET /public/v1/channels/rewards`; Kick lists disabled ones too. */
export function parseRewards(body: unknown): Parsed<readonly PointsReward[], "malformed"> {
  const data = dataArray(body)
  if (!data.ok) return data
  const rewards: PointsReward[] = []
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") {
      return malformed
    }
    if (item.is_enabled === true) rewards.push({ id: item.id, title: item.title })
  }
  return { ok: true, value: rewards }
}

/** One subscription of `GET /public/v1/events/subscriptions`. */
export interface ListedSubscription {
  readonly id: string
  readonly event: string
}

export function parseSubscriptionList(
  body: unknown,
): Parsed<readonly ListedSubscription[], "malformed"> {
  const data = dataArray(body)
  if (!data.ok) return data
  const subscriptions: ListedSubscription[] = []
  for (const item of data.value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.event !== "string") {
      return malformed
    }
    subscriptions.push({ id: item.id, event: item.event })
  }
  return { ok: true, value: subscriptions }
}

/** The PEM text of `GET /public/v1/public-key`. */
export function parsePublicKey(body: unknown): Parsed<string, "malformed"> {
  if (!isRecord(body) || !isRecord(body.data)) return malformed
  const { public_key: publicKey } = body.data
  return typeof publicKey === "string" && publicKey.includes("PUBLIC KEY")
    ? { ok: true, value: publicKey }
    : malformed
}

/** Kick sends user ids as JSON numbers. */
export function isUserId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function dataArray(body: unknown): Parsed<readonly unknown[], "malformed"> {
  return isRecord(body) && Array.isArray(body.data) ? { ok: true, value: body.data } : malformed
}
