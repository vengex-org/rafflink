import { groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import { ineligibleReasons, type GiveawayRules } from "@rafflink/core/domain/rules"
import type { CreateIssue } from "@rafflink/core/http/create-input"
import type {
  AdminAccessCountsJson,
  AdminPlanJson,
  AdminStatsJson,
  AdminStreamerJson,
  AdminStreamerListJson,
  AdminStreamersJson,
  AdminUsageJson,
  BadgesJson,
  DashboardGiveaway,
  EntrantsPage,
  LeavesJson,
  MyLeafJson,
  OperatorJson,
  PublicGiveaway,
  SessionJson,
  VerifyJson,
  ViewerState,
} from "@rafflink/core/http/json"
import type { QueueStats } from "@rafflink/core/queue/token-queue"
import type { LiveCounts } from "@rafflink/core/room/room-directory"
import {
  cloudflarePlans,
  type CloudflarePlan,
  type PlanLimitOverrides,
} from "@rafflink/core/plan/plan-limits"
import { usageAlertLimits, type Usage, type UsageAlert } from "@rafflink/core/plan/usage"
import type {
  ClaimOutcome,
  CloseOutcome,
  DrawOutcome,
  EntrantsDelta,
  LiveSnapshot,
  LiveWinner,
  OverlaySnapshot,
  RequestDrawOutcome,
  RerollOutcome,
  RerollState,
  SetWinnerCountOutcome,
  ViewerPush,
  ViewerWinner,
  WinnerChatLine,
  WinnerClaim,
} from "@rafflink/core/room/giveaway-room"
import {
  claimedVias,
  roomStatuses,
  type Entrant,
  type EntrySummary,
} from "@rafflink/core/room/rows"
import type { PlatformCapabilities } from "@rafflink/core/platform/provider"
import type { CallbackOutcome } from "@rafflink/core/viewer/outcome"
import {
  ApiShapeError,
  bool,
  child,
  list,
  nullableNum,
  nullableText,
  num,
  numList,
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

/** The giveaway page's response: the giveaway and where the viewer behind the cookie stands in it. */
export interface GiveawayLoad {
  readonly giveaway: GiveawayView
  readonly me: ViewerState
}

/** The first answer of a live route: the snapshot of its audience and, on the streamer's own route, the overlay token. */
export interface LiveLoad<Snapshot> {
  readonly snapshot: Snapshot
  readonly overlayToken: string | null
  /** The deployment's support page, sent with the streamer's own route only; null on the overlay route and when unset. */
  readonly donateUrl: string | null
}

/** What the viewer's sign-in came to. The redirect query carries no entry details; a poll answer does. */
export type EntryResult =
  | {
      readonly kind: Exclude<
        CallbackOutcome["kind"],
        "not-eligible" | "pending" | "entered" | "already-in"
      >
    }
  | {
      readonly kind: "entered" | "already-in"
      /** Null when the answer carries none. */
      readonly entry: EntrySummary | null
    }
  | { readonly kind: "not-eligible"; readonly reason: (typeof ineligibleReasons)[number] }
  | { readonly kind: "pending"; readonly ticket: string }

export type CloseKind = CloseOutcome["kind"]
export type SetWinnerCountKind = SetWinnerCountOutcome["kind"]
export type DrawKind = Exclude<DrawOutcome["kind"], "not-closed"> | RequestDrawOutcome["kind"]
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
  readonly winnerCount: number
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
  /** 403 `streamer_not_approved`: signup is closed and no admin approved the account. */
  | { readonly kind: "not-approved" }

export type AdminUsage = AdminUsageJson

export type AdminStats = AdminStatsJson

/** What the verify page reads: the public facts, the leaf list once the room committed, and the viewer's own leaf when they entered. */
export interface VerifyLoad {
  readonly verify: VerifyJson
  readonly leaves: LeavesJson | null
  readonly mine: MyLeafJson | null
}

export const liveSnapshotPath = (id: string) => `/api/live/${encodeURIComponent(id)}`
export const overlaySnapshotPath = (id: string, token: string) =>
  `/api/overlay/${encodeURIComponent(id)}/${encodeURIComponent(token)}`

export const viewerSocketPath = (code: string) => `/api/g/${encodeURIComponent(code)}/live`

const sessionPath = "/api/session"

/** Fired on `window` when an API call other than the session call answers 401, so the header can ask who is signed in again. */
export const sessionLost = "rafflink:session-lost"

/** Who the streamer cookie belongs to; a signed-out visitor is an answer, not an error. */
export async function getSession(): Promise<SessionJson> {
  const { status, body } = await send(sessionPath)
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "session")
  const donateUrl = nullableText(source, "donateUrl")
  const operator = source.operator === null ? null : operatorOf(child(source, "operator"))
  if (source.streamer === null) return { streamer: null, donateUrl, operator }
  const streamer = child(source, "streamer")
  return {
    streamer: {
      displayName: text(streamer, "displayName"),
      login: text(streamer, "login"),
      profileImageUrl: nullableText(streamer, "profileImageUrl"),
      canCreate: bool(streamer, "canCreate"),
      platform: text(streamer, "platform"),
      capabilities: capabilitiesOf(child(streamer, "capabilities")),
    },
    donateUrl,
    operator,
  }
}

function capabilitiesOf(source: Json): PlatformCapabilities {
  return {
    followerCheck: bool(source, "followerCheck"),
    subTiers: bool(source, "subTiers"),
    vip: bool(source, "vip"),
    accountAge: bool(source, "accountAge"),
    pageEntry: bool(source, "pageEntry"),
    chatEntry: bool(source, "chatEntry"),
  }
}

function operatorOf(source: Json): OperatorJson {
  return {
    name: text(source, "name"),
    address: nullableText(source, "address"),
    id: nullableText(source, "id"),
    email: text(source, "email"),
    legalUpdated: nullableText(source, "legalUpdated"),
  }
}

/** The logout answers 204 without a body, so it does not go through `send`. */
export async function logout(): Promise<"logged-out"> {
  const response = await fetch("/auth/logout", { method: "POST" })
  if (response.status !== 204) throw new ApiError(response.status)
  return "logged-out"
}

export async function getVerifyLoad(code: string): Promise<VerifyLoad | null> {
  const base = `/api/g/${encodeURIComponent(code)}`
  const { status, body } = await send(`${base}/verify`)
  if (status === 404) return null
  if (status !== 200) throw new ApiError(status)
  const verify = parseVerify(record(body, "verify"))
  const [leaves, mine] = await Promise.all([
    verify.commitment === null ? null : getLeaves(base, verify.commitment.merkleRoot),
    getMyLeaf(base),
  ])
  return { verify, leaves, mine }
}

// 409 is a room that has not committed yet.
async function getLeaves(base: string, merkleRoot: string): Promise<LeavesJson | null> {
  const { status, body } = await send(`${base}/leaves/${merkleRoot}`)
  if (status === 409) return null
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "leaves")
  const hashes = textList(source, "hashes")
  const tickets = numList(source, "tickets")
  if (
    hashes.length !== tickets.length
    || !hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))
    || !tickets.every((count) => Number.isSafeInteger(count) && count >= 0)
  ) {
    throw new ApiShapeError("leaves")
  }
  return { hashes, tickets }
}

// 401 is no viewer cookie and 404 a viewer who did not enter; both mean there is no own leaf to show.
async function getMyLeaf(base: string): Promise<MyLeafJson | null> {
  const { status, body } = await send(`${base}/my-leaf`)
  if (status === 401 || status === 404) return null
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "my-leaf")
  return {
    platform: text(source, "platform"),
    platformUserId: text(source, "platformUserId"),
    tickets: num(source, "tickets"),
    salt: nullableText(source, "salt"),
  }
}

function parseVerify(source: Json): VerifyJson {
  const commitment = source.commitment === null ? null : child(source, "commitment")
  return {
    status: oneOf(source, "status", roomStatuses),
    entrantCount: num(source, "entrantCount"),
    ticketTotal: num(source, "ticketTotal"),
    winnerCount: num(source, "winnerCount"),
    commitment:
      commitment === null
        ? null
        : {
            merkleRoot: text(commitment, "merkleRoot"),
            chainHash: text(commitment, "chainHash"),
            genesisSeconds: num(commitment, "genesisSeconds"),
            periodSeconds: num(commitment, "periodSeconds"),
            round: num(commitment, "round"),
            committedAt: num(commitment, "committedAt"),
          },
    picks: list(source, "picks", (pick) => ({
      n: num(pick, "n"),
      leafIndex: nullableNum(pick, "leafIndex"),
      rerolled: bool(pick, "rerolled"),
    })),
  }
}

export async function getGiveaway(code: string): Promise<GiveawayLoad | null> {
  const { status, body } = await send(`/api/g/${encodeURIComponent(code)}`)
  if (status === 404) return null
  if (status !== 200) throw new ApiError(status)
  return parseGiveawayLoad(record(body, "giveaway"))
}

/** The shape of the giveaway page's response: the public part and `me` in one object. */
export function giveawayLoadJson(load: GiveawayLoad): string {
  return JSON.stringify({ ...load.giveaway, me: load.me })
}

export function parseGiveawayLoad(source: Json): GiveawayLoad {
  return {
    giveaway: {
      code: text(source, "code"),
      title: nullableText(source, "title"),
      prize: nullableText(source, "prize"),
      streamerName: text(source, "streamerName"),
      rules: parseRules(child(source, "rules")),
      status: oneOf(source, "status", roomStatuses),
      closesAt: nullableNum(source, "closesAt"),
      claimSeconds: num(source, "claimSeconds"),
      entrantCount: num(source, "entrantCount"),
      finished: bool(source, "finished"),
      poll: {
        intervalMs: num(child(source, "poll"), "intervalMs"),
        maxMs: num(child(source, "poll"), "maxMs"),
      },
    },
    me: parseViewerState(child(source, "me")),
  }
}

function parseViewerState(source: Json): ViewerState {
  const kind = oneOf(source, "kind", viewerKinds)
  switch (kind) {
    case "entered":
      return { kind, userId: text(source, "userId"), entry: parseEntry(child(source, "entry")) }
    case "won":
      return {
        kind,
        userId: text(source, "userId"),
        n: num(source, "n"),
        entry: source.entry === null ? null : parseWonEntry(child(source, "entry")),
        claimRemainingMs: num(source, "claimRemainingMs"),
        claim: parseClaim(child(source, "claim")),
        chatClaimAvailable: bool(source, "chatClaimAvailable"),
      }
    case "not-entered":
    case "not-won":
      return { kind, userId: text(source, "userId") }
    case "signed-out":
      return { kind }
  }
}

/** A message of the viewer socket: the draw and claim state of the giveaway. */
export function parseViewerPush(source: Json): ViewerPush {
  return {
    status: oneOf(source, "status", roomStatuses),
    finished: bool(source, "finished"),
    chatClaimAvailable: bool(source, "chatClaimAvailable"),
    winners: list(source, "winners", parseViewerWinner),
    now: num(source, "now"),
  }
}

function parseViewerWinner(source: Json): ViewerWinner {
  return {
    n: num(source, "n"),
    platformUserId: text(source, "platformUserId"),
    claimUntil: num(source, "claimUntil"),
    claim: parseClaim(child(source, "claim")),
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
  if (status === 403 && record(body, "refusal").error === "streamer_not_approved") {
    return { kind: "not-approved" }
  }
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

/** The entrants after `afterSeq`, oldest first, up to the server's page size. */
export async function getEntrants(id: string, afterSeq: number): Promise<EntrantsPage> {
  const { status, body } = await send(`${liveSnapshotPath(id)}/entrants?after=${afterSeq}`)
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "entrants")
  return { rows: list(source, "rows", parseEntrant), more: bool(source, "more") }
}

/** The channel's subscriber badge image per tier; the server reads Twitch once and answers every tier `null` while Twitch gives none. */
export async function getBadges(id: string): Promise<BadgesJson> {
  const { status, body } = await send(`${liveSnapshotPath(id)}/badges`)
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "badges")
  return {
    sub_t1: nullableText(source, "sub_t1"),
    sub_t2: nullableText(source, "sub_t2"),
    sub_t3: nullableText(source, "sub_t3"),
  }
}

export async function getLive<Snapshot>(
  path: string,
  parseSnapshot: (source: Json) => Snapshot,
): Promise<LiveLoad<Snapshot> | "unauthorized" | "not-found"> {
  const { status, body } = await send(path)
  if (status === 401) return "unauthorized"
  if (status === 404) return "not-found"
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "live")
  return {
    snapshot: parseSnapshot(source),
    overlayToken: source.overlayToken === undefined ? null : text(source, "overlayToken"),
    donateUrl: source.donateUrl === undefined ? null : nullableText(source, "donateUrl"),
  }
}

export function closeEntries(id: string): Promise<CloseKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/close`, {}, closeKinds)
}

/** What a draw answered: the outcome, and for `round-pending` the instant the committed round is published. */
export type DrawAnswer =
  | { readonly kind: Exclude<DrawKind, "round-pending"> | Rejected }
  | { readonly kind: "round-pending"; readonly availableAt: number; readonly now: number }

/** Draws the next winner; while entries are open it closes them and the room draws the first winner itself once the round is published. */
export async function drawWinners(id: string): Promise<DrawAnswer> {
  const source = await post(`/api/dash/giveaways/${encodeURIComponent(id)}/draw`, {})
  const kind = answerKind(source, drawKinds)
  return kind === "round-pending"
    ? { kind, availableAt: num(source, "availableAt"), now: num(source, "now") }
    : { kind }
}

export function setWinnerCount(id: string, count: number): Promise<SetWinnerCountKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/winners`, { count }, setWinnerKinds)
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
  return {
    usage: parseUsage(source),
    plan: source.plan === null ? null : parsePlan(child(source, "plan")),
    alerts: list(source, "alerts", parseAlert),
    alertPercent: num(source, "alertPercent"),
    signupOpen: bool(source, "signupOpen"),
    queue: parseQueue(child(source, "queue")),
  }
}

/** `fresh` skips the server's short-lived copy, for the first read after the plan changed. */
export async function getAdminStats(fresh: boolean): Promise<AdminStats> {
  const { status, body } = await send(fresh ? "/api/admin/stats?fresh=1" : "/api/admin/stats")
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "stats")
  return {
    generatedAt: num(source, "generatedAt"),
    openGiveaways: num(source, "openGiveaways"),
    giveaways: list(source, "giveaways", (giveaway) => ({
      code: text(giveaway, "code"),
      title: nullableText(giveaway, "title"),
      streamerName: text(giveaway, "streamerName"),
      closesAt: nullableNum(giveaway, "closesAt"),
      counts: giveaway.counts === null ? null : parseLiveCounts(child(giveaway, "counts")),
    })),
    viewers: num(source, "viewers"),
    entriesLastMinute: num(source, "entriesLastMinute"),
    claimsLastMinute: num(source, "claimsLastMinute"),
    queue: parseQueue(child(source, "queue")),
    usage: parseUsage(source),
    series: list(source, "series", (point) => ({
      minute: num(point, "minute"),
      entries: num(point, "entries"),
      claims: num(point, "claims"),
      rateLimited: num(point, "rateLimited"),
    })),
    growth: list(source, "growth", (day) => ({
      day: num(day, "day"),
      giveaways: num(day, "giveaways"),
      streamers: num(day, "streamers"),
    })),
    returningStreamers: num(source, "returningStreamers"),
    returningWithinDays: num(source, "returningWithinDays"),
    access: source.access === null ? null : parseAccessCounts(child(source, "access")),
    referrals: list(source, "referrals", (row) => ({
      ref: text(row, "ref"),
      visits: num(row, "visits"),
    })),
  }
}

function parseLiveCounts(source: Json): LiveCounts {
  return {
    entrants: num(source, "entrants"),
    entriesLastMinute: num(source, "entriesLastMinute"),
    claimsLastMinute: num(source, "claimsLastMinute"),
    viewers: num(source, "viewers"),
  }
}

function parseAccessCounts(source: Json): AdminAccessCountsJson {
  return {
    pending: num(source, "pending"),
    approved: num(source, "approved"),
    truncated: bool(source, "truncated"),
  }
}

/**
 * Tells the app which Cloudflare plan the account is on; the payment happens in the Cloudflare dashboard.
 * "queue-unavailable": the plan is stored, only the token queue has not taken it yet.
 */
export async function switchPlan(
  plan: CloudflarePlan,
): Promise<"switched" | "queue-unavailable" | Rejected> {
  const { status, body } = await postJson("/api/admin/plan", { plan })
  const source = record(body, "action")
  if (status === 503 && source.error === "queue-unavailable") return "queue-unavailable"
  return answerKind(source, switchPlanKinds)
}

export async function getAdminStreamers(): Promise<AdminStreamersJson> {
  const { status, body } = await send("/api/admin/streamers")
  if (status !== 200) throw new ApiError(status)
  const source = record(body, "streamers")
  return {
    pending: parseStreamerList(child(source, "pending")),
    approved: parseStreamerList(child(source, "approved")),
  }
}

function parseStreamerList(source: Json): AdminStreamerListJson {
  return {
    streamers: list(source, "streamers", parseAdminStreamer),
    truncated: bool(source, "truncated"),
  }
}

/** Approves or revokes a streamer's right to create giveaways; `rejected` when the server refused or the streamer is unknown. */
export function decideStreamerAccess(
  id: string,
  decision: "approve" | "revoke",
): Promise<StreamerAccessKind | Rejected> {
  return act(`/api/admin/streamers/${encodeURIComponent(id)}/${decision}`, {}, streamerAccessKinds)
}

export type StreamerAccessKind = (typeof streamerAccessKinds)[number]

/** Deletes one of the streamer's giveaways with its room, winners and draw proof. */
export function deleteGiveaway(id: string): Promise<DeleteKind | Rejected> {
  return act(`/api/dash/giveaways/${encodeURIComponent(id)}/delete`, {}, deleteKinds)
}

/** Deletes every giveaway of the signed-in streamer and the account itself, which also ends the session. */
export function deleteStreamerData(): Promise<DeleteKind | Rejected> {
  return act("/api/dash/account/delete", {}, deleteKinds)
}

/** Where the browser downloads a giveaway's winners as CSV; the session cookie goes with the link. */
export const winnersCsvPath = (id: string) =>
  `/api/dash/giveaways/${encodeURIComponent(id)}/winners.csv`

export type DeleteKind = (typeof deleteKinds)[number]

const deleteKinds = ["deleted"] as const
const streamerAccessKinds = ["approved", "revoked"] as const
const closeKinds = ["closed", "not-open"] as const satisfies readonly CloseKind[]
const switchPlanKinds = ["switched"] as const
const setWinnerKinds = ["set"] as const satisfies readonly SetWinnerCountKind[]
const drawKinds = [
  "drawn",
  "requested",
  "round-pending",
  "beacon-unavailable",
  "not-open",
  "entries-deleted",
  "no-entrants-left",
  "pick-limit",
  "try-again",
] as const satisfies readonly DrawKind[]
const rerollKinds = [
  "rerolled",
  "already-rerolled",
  "already-claimed",
  "unknown-pick",
  "not-drawn",
  "no-entrants-left",
  "entries-deleted",
  "reroll-window-over",
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
  "too-large",
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
  "rate-limited",
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
  if (response.status === 401 && path !== sessionPath) window.dispatchEvent(new Event(sessionLost))
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
  return answerKind(await post(path, payload), kinds)
}

function postJson(path: string, payload: unknown): Promise<Answer> {
  return send(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

async function post(path: string, payload: unknown): Promise<Json> {
  return record((await postJson(path, payload)).body, "action")
}

function answerKind<K extends string>(source: Json, kinds: readonly K[]): K | Rejected {
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
      return {
        kind,
        entry: Object.hasOwn(source, "entry") ? parseEntry(child(source, "entry")) : null,
      }
    case "closed":
    case "rate-limited":
    case "dropped":
    case "try-again":
    case "invalid-state":
      return { kind }
  }
}

function parseWonEntry(source: Json): Pick<EntrySummary, "tickets" | "group"> {
  return { group: oneOf(source, "group", groups), tickets: num(source, "tickets") }
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
      return { state, at: num(source, "at"), via: oneOf(source, "via", claimedVias) }
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

/** A message of the live socket: the snapshot, and after a write the entrants added since the last push. */
export function parseLivePush<Snapshot>(
  source: Json,
  parseSnapshot: (source: Json) => Snapshot,
): {
  readonly snapshot: Snapshot
  readonly entrantsAfter: EntrantsDelta | null
} {
  return {
    snapshot: parseSnapshot(source),
    entrantsAfter: Object.hasOwn(source, "entrantsAfter")
      ? parseEntrantsDelta(child(source, "entrantsAfter"))
      : null,
  }
}

function parseEntrantsDelta(source: Json): EntrantsDelta {
  return {
    fromSeq: num(source, "fromSeq"),
    rows: list(source, "rows", parseEntrant),
    truncated: bool(source, "truncated"),
  }
}

function parseEntrant(source: Json): Entrant {
  return {
    seq: num(source, "seq"),
    login: text(source, "login"),
    displayName: text(source, "displayName"),
    tickets: num(source, "tickets"),
    group: oneOf(source, "group", groups),
    profileImageUrl: nullableText(source, "profileImageUrl"),
  }
}

/** The snapshot of the streamer's live page. */
export function parseLiveSnapshot(source: Json): LiveSnapshot {
  return {
    ...parseSharedSnapshotFields(source),
    winnerChat: list(source, "winnerChat", parseChatLine),
    winnerChatOpen: bool(source, "winnerChatOpen"),
    ...parseRerollState(source),
  }
}

/** The snapshot of the OBS overlay, which never carries winner chat. */
export function parseOverlaySnapshot(source: Json): OverlaySnapshot {
  return { ...parseSharedSnapshotFields(source), ...parseRerollState(source) }
}

function parseSharedSnapshotFields(source: Json) {
  return {
    title: nullableText(source, "title"),
    code: text(source, "code"),
    status: oneOf(source, "status", roomStatuses),
    closesAt: nullableNum(source, "closesAt"),
    entrantCount: num(source, "entrantCount"),
    ticketTotal: num(source, "ticketTotal"),
    winnerCount: num(source, "winnerCount"),
    entriesPerSecond: num(source, "entriesPerSecond"),
    lastNames: textList(source, "lastNames"),
    winners: list(source, "winners", parseWinner),
    roleRefreshFailures: num(source, "roleRefreshFailures"),
    eventSubFailures: num(source, "eventSubFailures"),
    drawAvailableAt: nullableNum(source, "drawAvailableAt"),
    drawRequested: bool(source, "drawRequested"),
    shuffleNames: textList(source, "shuffleNames"),
    now: num(source, "now"),
    chatClaimUnavailable: bool(source, "chatClaimUnavailable"),
  }
}

function parseRerollState(source: Json): RerollState {
  const open = bool(source, "rerollOpen")
  const blocked =
    source.rerollBlocked === null
      ? null
      : oneOf(source, "rerollBlocked", ["window-over", "nobody-left"])
  if (open) {
    if (blocked !== null) throw new ApiShapeError("rerollBlocked")
    return { rerollOpen: true, rerollBlocked: null }
  }
  return { rerollOpen: false, rerollBlocked: blocked }
}

function parseChatLine(source: Json): WinnerChatLine {
  return {
    id: num(source, "id"),
    name: text(source, "name"),
    text: text(source, "text"),
    at: num(source, "at"),
  }
}

function parseWinner(source: Json): LiveWinner {
  return {
    n: num(source, "n"),
    entrySeq: nullableNum(source, "entrySeq"),
    displayName: nullableText(source, "displayName"),
    profileImageUrl: nullableText(source, "profileImageUrl"),
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
  return { used: num(source, "used"), limit: nullableNum(source, "limit") }
}

function parsePlan(source: Json): AdminPlanJson {
  const limits = child(source, "limits")
  return {
    current: oneOf(source, "current", cloudflarePlans),
    limits: {
      workerRequestsPerDay: nullableNum(limits, "workerRequestsPerDay"),
      doRequestsPerDay: nullableNum(limits, "doRequestsPerDay"),
      workerRequestsPerMonth: nullableNum(limits, "workerRequestsPerMonth"),
      doRequestsPerMonth: nullableNum(limits, "doRequestsPerMonth"),
      subrequestsPerInvocation: num(limits, "subrequestsPerInvocation"),
      overridden: parseOverridden(child(limits, "overridden")),
    },
  }
}

function parseOverridden(source: Json): PlanLimitOverrides {
  return {
    workerRequestsPerDay: bool(source, "workerRequestsPerDay"),
    doRequestsPerDay: bool(source, "doRequestsPerDay"),
    subrequestsPerInvocation: bool(source, "subrequestsPerInvocation"),
  }
}

function parseAdminStreamer(source: Json): AdminStreamerJson {
  return {
    id: text(source, "id"),
    login: text(source, "login"),
    displayName: text(source, "displayName"),
    createdAt: num(source, "createdAt"),
    approvedAt: nullableNum(source, "approvedAt"),
  }
}

function parseAlert(source: Json): UsageAlert {
  return {
    limit: oneOf(source, "limit", usageAlertLimits),
    percent: num(source, "percent"),
  }
}

function parseQueue(source: Json): QueueStats {
  return {
    queued: num(source, "queued"),
    ratePerSecond: num(source, "ratePerSecond"),
    cooldownUntil: num(source, "cooldownUntil"),
    dropped: num(source, "dropped"),
    abandonedResults: num(source, "abandonedResults"),
    lostClaims: num(source, "lostClaims"),
    rateLimited: num(source, "rateLimited"),
    lastRateLimitedAt: num(source, "lastRateLimitedAt"),
    rateLimitedMinutes: list(source, "rateLimitedMinutes", (row) => ({
      minute: num(row, "minute"),
      count: num(row, "count"),
    })),
  }
}
