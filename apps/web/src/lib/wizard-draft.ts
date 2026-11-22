import { groups } from "@rafflink/core/domain/groups"
import { claimPresets, type Step, type Values } from "../pages/create-values.ts"
import { readSessionStored, removeSessionStored, writeSessionStored } from "./safe-storage.ts"

/**
 * One run through the create wizard as its history entries keep it: the answers and the furthest step checked,
 * so the back button and a reload restore them. `id` names the run, which tells a copy of it left in history after
 * the giveaway was created.
 */
export interface Draft {
  readonly id: string
  readonly values: Values
  readonly furthest: Step
}

const createdKey = "rafflink-created-drafts"
const reconnectKey = "rafflink-reconnect-draft"
// Enough for every wizard run of a session; the oldest are forgotten after that.
const createdKept = 50

/** Narrows the history state once; anything else is no draft. */
export function readDraft(state: unknown): Draft | null {
  if (typeof state !== "object" || state === null || !("draft" in state)) return null
  const { draft } = state
  if (typeof draft !== "object" || draft === null) return null
  if (!("id" in draft) || typeof draft.id !== "string") return null
  if (!("furthest" in draft) || !isStep(draft.furthest)) return null
  if (!("values" in draft) || !isValues(draft.values)) return null
  return { id: draft.id, values: draft.values, furthest: draft.furthest }
}

/** Keeps the answers of the rules step across "Reconnect Twitch", which leaves the page for Twitch and comes back without the history entry. */
export function keepDraftForReconnect(values: Values): void {
  const draft: Draft = { id: crypto.randomUUID(), values, furthest: 2 }
  writeSessionStored(reconnectKey, JSON.stringify(draft))
}

/** The answers kept before "Reconnect Twitch", once; null when there are none or they do not read as a draft. */
export function takeReconnectDraft(): Draft | null {
  const text = readSessionStored(reconnectKey)
  if (text === null) return null
  removeSessionStored(reconnectKey)
  try {
    return readDraft({ draft: JSON.parse(text) })
  } catch {
    return null
  }
}

export function isCreated(id: string): boolean {
  return createdIds().includes(id)
}

export function markCreated(id: string): void {
  writeSessionStored(createdKey, JSON.stringify([...createdIds(), id].slice(-createdKept)))
}

function createdIds(): readonly string[] {
  const text = readSessionStored(createdKey)
  if (text === null) return []
  try {
    const ids: unknown = JSON.parse(text)
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function isStep(value: unknown): value is Step {
  return value === 1 || value === 2 || value === 3
}

function isValues(value: unknown): value is Values {
  if (typeof value !== "object" || value === null) return false
  const fields = Object.fromEntries(Object.entries(value))
  const { title, prize, audience, tickets, minAccountAgeDays, ending, closesAt, claim } = fields
  const { claimKeyword, entryWays, chatKeyword, winnerCount } = fields
  return (
    [title, prize, minAccountAgeDays, closesAt, claimKeyword, chatKeyword, winnerCount].every(
      (text) => typeof text === "string",
    )
    && (audience === "everyone" || audience === "followers" || audience === "subscribers")
    && (ending === "never" || ending === "at-time")
    && (entryWays === "page" || entryWays === "page-and-chat" || entryWays === "chat")
    && isTickets(tickets)
    && isClaim(claim)
  )
}

function isTickets(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const entries = Object.fromEntries(Object.entries(value))
  return groups.every((group) => typeof entries[group] === "string")
}

function isClaim(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const { kind, seconds, minutes } = Object.fromEntries(Object.entries(value))
  if (kind === "custom") return typeof minutes === "string"
  return kind === "preset" && claimPresets.some((preset) => preset === seconds)
}
