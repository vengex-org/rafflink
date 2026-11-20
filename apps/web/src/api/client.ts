import { groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import { ineligibleReasons, type GiveawayRules } from "@rafflink/core/domain/rules"
import type { CreateIssue } from "@rafflink/core/http/create-input"
import type { DashboardGiveaway, PublicGiveaway, ViewerState } from "@rafflink/core/http/json"
import type { QueueStats } from "@rafflink/core/queue/token-queue"
import type { Usage } from "@rafflink/core/ports"
import type {
  ClaimOutcome,
  CloseOutcome,
  DrawOutcome,
  LiveSnapshot,
  LiveWinner,
  RerollOutcome,
  WinnerClaim,
} from "@rafflink/core/room/giveaway-room"
import { claimedVias, roomStatuses, type EntrySummary } from "@rafflink/core/room/rows"
import type { CallbackOutcome } from "@rafflink/core/viewer/outcome"
import {
  ApiShapeError,
  bool,
  child,
  list,
  nullableNum,
  nullableText,
  num,
  oneOf,
  record,
  text,
  textList,
  type Json,
} from "./decode.ts"

/** The server answered with a status this client has no meaning for, or with a body that is not JSON. */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`unexpected response status ${status}`)
  }
}

/** The giveaway page's answer: what anyone may see. */
export type GiveawayView = PublicGiveaway

/** The live page's first answer: the snapshot and, on the streamer's own route, the overlay token. */
export interface LiveLoad {
  readonly snapshot: LiveSnapshot
  readonly overlayToken: string | null
}

/** What the viewer's sign-in came to, without the entry details the redirect query does not carry. */
export type EntryResult =
  | {
      readonly kind: Exclude<CallbackOutcome["kind"], "not-eligible" | "pending">
    }
  | { readonly kind: "not-eligible"; readonly reason: (typeof ineligibleReasons)[number] }
  | { readonly kind: "pending"; readonly ticket: string }

export type CloseKind = CloseOutcome["kind"]
export type DrawKind = DrawOutcome["kind"]
export type RerollKind = RerollOutcome["kind"]
export type ClaimKind = ClaimOutcome["kind"]

/** The server refused the request without an outcome (bad input, no session, room down). */
export type Rejected = "rejected"

export interface CreateGiveawayBody {
  readonly title: string
  readonly prize: string
  readonly rules: {
    readonly tickets: Readonly<Record<Group, number | undefined>>
    readonly subsOnly: boolean
    readonly followersOnly: boolean
    readonly minAccountAgeDays: number | undefined
    readonly claimKeyword: string
  }
  readonly closesAt: string | undefined
  readonly claimSeconds: number | undefined
}

export type CreateResult =
  | {
      readonly kind: "created"
      readonly giveaway: DashboardGiveaway
      readonly roomReady: boolean
      readonly usageLow: { readonly remaining: number } | null
    }
  | { readonly kind: "invalid"; readonly field: string; readonly code: CreateIssue["code"] }
  | { readonly kind: "unauthorized" }

export interface AdminUsage {
  /** Null: the target has no daily limit. "unavailable": the usage source did not answer. */
  readonly usage: Usage | null | "unavailable"
  readonly queue: QueueStats
}

export const liveSnapshotPath = (id: string) => `/api/live/${encodeURIComponent(id)}`
export const overlaySnapshotPath = (id: string, token: string) =>
  `/api/overlay/${encodeURIComponent(id)}/${encodeURIComponent(token)}`

export async function getGiveaway(code: string): Promise<GiveawayView | null> {
  const { status, body } = await send(`/api/g/${encodeURIComponent(code)}`)
  if (status === 404) return null
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "giveaway")
  return {
    code: text(source, "code"),
    title: nullableText(source, "title"),
    prize: nullableText(source, "prize"),
    streamerName: text(source, "streamerName"),
    rules: parseRules(child(source, "rules")),
    status: oneOf(source, "status", roomStatuses),
    closesAt: nullableNum(source, "closesAt"),
    claimSeconds: num(source, "claimSeconds"),
    entrantCount: num(source, "entrantCount"),
    poll: {
      intervalMs: num(child(source, "poll"), "intervalMs"),
      maxMs: num(child(source, "poll"), "maxMs"),
    },
  }
}

/** Where the viewer behind the cookie stands in this giveaway; the giveaway must exist. */
export async function getViewerState(code: string): Promise<ViewerState> {
  const { status, body } = await send(`/api/g/${encodeURIComponent(code)}/me`)
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "viewer")
  const kind = oneOf(source, "kind", viewerKinds)
  switch (kind) {
    case "entered":
      return { kind, entry: parseEntry(child(source, "entry")) }
    case "won":
      return {
        kind,
        n: num(source, "n"),
        claimRemainingMs: num(source, "claimRemainingMs"),
        claim: parseClaim(child(source, "claim")),
        chatClaimAvailable: bool(source, "chatClaimAvailable"),
      }
    case "signed-out":
    case "not-entered":
    case "not-won":
      return { kind }
  }
}

export async function pollEntry(code: string, ticket: string): Promise<EntryResult> {
  const { status, body } = await send(
    `/api/g/${encodeURIComponent(code)}/pending/${encodeURIComponent(ticket)}`,
  )
  if (status !== 200) throw new ApiError(status)
  return parseEntryResult(record(body, "entry"))
}

/** The outcome the sign-in callback put in the page's query string; null when there is none or it is not one. */
export function entryFromQuery(query: URLSearchParams): EntryResult | null {
  const kind = query.get("entry")
  if (kind === null) return null
  try {
    return parseEntryResult({
      kind,
      reason: query.get("reason"),
      ticket: query.get("ticket"),
    })
  } catch (error) {
    if (error instanceof ApiShapeError) return null
    throw error
  }
}

export async function claimPrize(code: string): Promise<ClaimKind | Rejected> {
  return act(`/api/g/${encodeURIComponent(code)}/claim`, {}, claimKinds)
}

export async function listGiveaways(): Promise<DashboardGiveaway[] | "unauthorized"> {
  const { status, body } = await send("/api/dash/giveaways")
  if (status === 401) return "unauthorized"
  if (status !== 200) throw new ApiError(status)
  return list(record(body, "giveaways"), "giveaways", parseDashboardGiveaway)
}

export async function createGiveaway(input: CreateGiveawayBody): Promise<CreateResult> {
  const { status, body } = await send("/api/dash/giveaways", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (status === 401) return { kind: "unauthorized" }
  if (status === 400) {
    const source = record(body, "issue")
    return {
      kind: "invalid",
      field: text(source, "field"),
      code: oneOf(source, "code", issueCodes),
    }
  }
  if (status !== 201) throw new ApiError(status)
  const source = record(body, "created")
  const warnings = list(source, "warnings", (warning) => ({
    kind: oneOf(warning, "kind", ["worker-requests-low"]),
    remaining: num(warning, "remaining"),
  }))
  return {
    kind: "created",
    giveaway: parseDashboardGiveaway(child(source, "giveaway")),
    roomReady: bool(source, "roomReady"),
    usageLow: warnings[0] === undefined ? null : { remaining: warnings[0].remaining },
  }
}

export async function getLive(path: string): Promise<LiveLoad | "unauthorized" | "not-found"> {
  const { status, body } = await send(path)
  if (status === 401) return "unauthorized"
  if (status === 404) return "not-found"
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "live")
  return {
    snapshot: parseLiveSnapshot(source),
    overlayToken: source.overlayToken === undefined ? null : text(source, "overlayToken"),
  }
}

export function closeEntries(id: string): Promise<CloseKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/close`, {}, closeKinds)
}

export function drawWinners(id: string, count: number): Promise<DrawKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/draw`, { count }, drawKinds)
}

export function rerollWinner(id: string, n: number): Promise<RerollKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/reroll`, { n }, rerollKinds)
}

export function markClaimed(id: string, n: number): Promise<ClaimKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/claim`, { n }, claimKinds)
}

export async function getAdminUsage(): Promise<AdminUsage | "unauthorized" | "forbidden"> {
  const { status, body } = await send("/api/admin/usage")
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "admin")
  return { usage: parseUsage(source), queue: parseQueue(child(source, "queue")) }
}

const closeKinds = ["closed", "not-open"] as const satisfies readonly CloseKind[]
const drawKinds = ["drawn", "not-closed", "already-drawn"] as const satisfies readonly DrawKind[]
const rerollKinds = [
  "rerolled",
  "already-rerolled",
  "already-claimed",
  "unknown-pick",
  "not-drawn",
  "no-entrants-left",
  "try-again",
] as const satisfies readonly RerollKind[]
const claimKinds = [
  "claimed",
  "already-claimed",
  "expired",
  "rerolled",
  "not-a-winner",
] as const satisfies readonly ClaimKind[]
const issueCodes = [
  "not-an-object",
  "missing",
  "not-a-boolean",
  "not-a-string",
  "not-a-non-negative-integer",
  "not-a-positive-integer",
  "blank",
  "too-long",
  "not-a-timestamp",
  "in-the-past",
] as const satisfies readonly CreateIssue["code"][]
const viewerKinds = [
  "signed-out",
  "not-entered",
  "entered",
  "won",
  "not-won",
] as const satisfies readonly ViewerState["kind"][]
const entryKinds = [
  "entered",
  "already-in",
  "not-eligible",
  "closed",
  "pending",
  "dropped",
  "try-again",
  "invalid-state",
] as const satisfies readonly CallbackOutcome["kind"][]

interface Answer {
  readonly status: number
  readonly body: unknown
}

async function send(path: string, init?: RequestInit): Promise<Answer> {
  const response = await fetch(path, init)
  try {
    return { status: response.status, body: await response.json() }
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError(response.status)
    throw error
  }
}

// An answer without an outcome `kind` is a refusal: bad input, no session, room unavailable.
async function act<K extends string>(
  path: string,
  payload: unknown,
  kinds: readonly K[],
): Promise<K | Rejected> {
  const { body } = await send(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const source = record(body, "action")
  return Object.hasOwn(source, "kind") ? oneOf(source, "kind", kinds) : "rejected"
}

function parseEntryResult(source: Json): EntryResult {
  const kind = oneOf(source, "kind", entryKinds)
  switch (kind) {
    case "not-eligible":
      return { kind, reason: oneOf(source, "reason", ineligibleReasons) }
    case "pending":
      return { kind, ticket: text(source, "ticket") }
    case "entered":
    case "already-in":
    case "closed":
    case "dropped":
    case "try-again":
    case "invalid-state":
      return { kind }
  }
}

function parseEntry(source: Json): EntrySummary {
  return {
    group: oneOf(source, "group", groups),
    tickets: num(source, "tickets"),
    enteredAt: num(source, "enteredAt"),
  }
}

function parseRules(source: Json): GiveawayRules {
  const tickets = child(source, "tickets")
  const parsed: Tickets = {
    viewer: num(tickets, "viewer"),
    follower: num(tickets, "follower"),
    sub_t1: num(tickets, "sub_t1"),
    sub_t2: num(tickets, "sub_t2"),
    sub_t3: num(tickets, "sub_t3"),
    vip: num(tickets, "vip"),
    moderator: num(tickets, "moderator"),
  }
  return {
    tickets: parsed,
    subsOnly: bool(source, "subsOnly"),
    followersOnly: bool(source, "followersOnly"),
    minAccountAgeDays: nullableNum(source, "minAccountAgeDays"),
    claimKeyword: nullableText(source, "claimKeyword"),
  }
}

function parseClaim(source: Json): WinnerClaim {
  const state = oneOf(source, "state", ["claimed", "waiting", "expired", "rerolled"])
  switch (state) {
    case "claimed":
      return { state, via: oneOf(source, "via", claimedVias) }
    case "waiting":
    case "expired":
    case "rerolled":
      return { state }
  }
}

function parseDashboardGiveaway(source: Json): DashboardGiveaway {
  return {
    id: text(source, "id"),
    code: text(source, "code"),
    title: nullableText(source, "title"),
    prize: nullableText(source, "prize"),
    rules: parseRules(child(source, "rules")),
    status: oneOf(source, "status", roomStatuses),
    closesAt: nullableNum(source, "closesAt"),
    claimSeconds: num(source, "claimSeconds"),
    overlayToken: text(source, "overlayToken"),
    createdAt: num(source, "createdAt"),
  }
}

/** A live message from the socket; the same shape as the snapshot a GET returns. */
export function parseLiveSnapshot(source: Json): LiveSnapshot {
  return {
    title: nullableText(source, "title"),
    code: text(source, "code"),
    status: oneOf(source, "status", roomStatuses),
    closesAt: nullableNum(source, "closesAt"),
    entrantCount: num(source, "entrantCount"),
    ticketTotal: num(source, "ticketTotal"),
    entriesPerSecond: num(source, "entriesPerSecond"),
    lastNames: textList(source, "lastNames"),
    winners: list(source, "winners", parseWinner),
    roleRefreshFailures: num(source, "roleRefreshFailures"),
    eventSubFailures: num(source, "eventSubFailures"),
    chatClaimUnavailable: bool(source, "chatClaimUnavailable"),
  }
}

function parseWinner(source: Json): LiveWinner {
  return {
    n: num(source, "n"),
    displayName: nullableText(source, "displayName"),
    claimUntil: num(source, "claimUntil"),
    claim: parseClaim(child(source, "claim")),
  }
}

function parseUsage(source: Json): Usage | null | "unavailable" {
  if (source.usage === null) return null
  if (source.usage === "unavailable") return "unavailable"
  const usage = child(source, "usage")
  return {
    workerRequests: parseQuota(child(usage, "workerRequests")),
    doRequests: parseQuota(child(usage, "doRequests")),
  }
}

function parseQuota(source: Json): Usage["workerRequests"] {
  return { used: num(source, "used"), limit: num(source, "limit") }
}

function parseQueue(source: Json): QueueStats {
  return {
    queued: num(source, "queued"),
    ratePerSecond: num(source, "ratePerSecond"),
    cooldownUntil: num(source, "cooldownUntil"),
    dropped: num(source, "dropped"),
    abandonedResults: num(source, "abandonedResults"),
  }
}
