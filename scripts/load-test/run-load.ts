import { setTimeout as sleep } from "node:timers/promises"
import type { GiveawayRules } from "../../packages/core/src/domain/rules.ts"
import { LocalBrowser } from "./local-browser.ts"
import type { LoadPlan } from "./options.ts"
import { summarizeLatency, type LatencySummary } from "./stats.ts"
import { signInViewer, type Attempt, type ViewerContext } from "./viewer-flow.ts"

/** Where the load goes and who it signs in. */
export interface LoadTarget {
  readonly target: URL
  /** A user the fake Twitch knows; signs in as the streamer and, as an admin, reads the queue counters. */
  readonly streamerUserId: string
  /** Viewer `i` signs in as the user with id `firstViewerId + i`; the fake must know all of them. */
  readonly firstViewerId: number
}

export interface LoadReport {
  readonly viewers: number
  readonly requestedRate: number
  /** Viewers started per second over the whole start phase. */
  readonly startedPerSecond: number
  /** Callbacks answered per second between the first start and the last answer. */
  readonly answeredPerSecond: number
  readonly signIn: LatencySummary
  readonly callback: LatencySummary
  /** Start of the sign-in until the final outcome, for queued viewers only. */
  readonly queued: LatencySummary
  readonly callbackOutcomes: Readonly<Record<string, number>>
  readonly finalOutcomes: Readonly<Record<string, number>>
  readonly rateLimited: number
  readonly pollErrors: number
  readonly repeatAttempts: number
  readonly entrantCount: number
  readonly acceptedViewers: number
  readonly duplicateLogins: number
  readonly enteredTwice: number
  /** The queue counters of the admin page; null when the streamer is not an admin. */
  readonly queueStats: unknown
  /** One line per check that did not hold; empty when the run passed. */
  readonly failures: readonly string[]
}

/** The share of the requested rate a run must reach to pass. */
const rateTolerance = 0.9

const rules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
  excludeRecentWinners: null,
  chatKeyword: null,
}

const acceptedKinds: readonly string[] = ["entered", "already-in"]

interface ViewerRun {
  readonly first: Attempt
  /** The second sign-in of the same viewer, for the share of viewers that repeat. */
  readonly repeat: Attempt | null
}

interface RoomView {
  readonly entrantCount: number
  readonly logins: readonly string[]
  readonly queueStats: unknown
}

/** Creates a giveaway as the streamer, signs `rate x duration` viewers in at `rate` per second and checks the room afterwards. */
export async function runLoad(load: LoadTarget, plan: LoadPlan): Promise<LoadReport> {
  const streamer = new LocalBrowser(load.target)
  const streamerCallback = await streamer.signInUntilCallback(
    "/auth/twitch/streamer/start",
    load.streamerUserId,
  )
  const signedIn = await streamer.get(streamerCallback)
  const landed = signedIn.headers.get("location")
  if (landed !== "/dashboard")
    throw new Error(`streamer sign-in ended at ${landed ?? `HTTP ${signedIn.status}`}`)
  const giveaway = await createGiveaway(streamer)
  const context: ViewerContext = {
    target: load.target,
    code: giveaway.code,
    poll: await readPoll(streamer, giveaway.code),
  }

  const viewers = plan.rate * plan.durationSeconds
  const runs: Promise<ViewerRun>[] = []
  const failures: unknown[] = []
  const began = performance.now()
  let lastStartedAt = began
  for (let index = 0; index < viewers && failures.length === 0; index++) {
    const wait = began + (index * 1000) / plan.rate - performance.now()
    if (wait > 1) await sleep(wait)
    lastStartedAt = performance.now()
    const repeats = (index * plan.duplicatePercent) % 100 < plan.duplicatePercent
    const run = enter(context, String(load.firstViewerId + index), repeats)
    run.catch((error: unknown) => failures.push(error))
    runs.push(run)
  }
  const settled = await Promise.allSettled(runs)
  if (failures.length > 0) throw failures[0]
  const done: ViewerRun[] = []
  for (const result of settled) if (result.status === "fulfilled") done.push(result.value)

  const room = await readRoom(streamer, giveaway.id)
  const startPhaseSeconds = (lastStartedAt - began) / 1000 + 1 / plan.rate
  const lastAnsweredAt = Math.max(...done.map((run) => run.first.answeredAt))
  return summarize({
    plan,
    done,
    room,
    startedPerSecond: viewers / startPhaseSeconds,
    answeredPerSecond: viewers / ((lastAnsweredAt - began) / 1000),
  })
}

async function enter(context: ViewerContext, userId: string, repeats: boolean): Promise<ViewerRun> {
  const first = await signInViewer(context, userId)
  return { first, repeat: repeats ? await signInViewer(context, userId) : null }
}

async function createGiveaway(streamer: LocalBrowser): Promise<{ id: string; code: string }> {
  const response = await streamer.postJson("/api/dash/giveaways", {
    title: "Load test",
    prize: "Nothing",
    rules,
  })
  if (response.status !== 201) {
    throw new Error(`creating the giveaway answered HTTP ${response.status}`)
  }
  const body: { giveaway: { id: string; code: string } } = await response.json()
  return body.giveaway
}

async function readPoll(streamer: LocalBrowser, code: string): Promise<ViewerContext["poll"]> {
  const response = await streamer.get(`/api/g/${code}`)
  const body: { poll: ViewerContext["poll"] } = await response.json()
  return body.poll
}

async function readRoom(streamer: LocalBrowser, giveawayId: string): Promise<RoomView> {
  const snapshot: { entrantCount: number } = await (
    await streamer.get(`/api/live/${giveawayId}`)
  ).json()
  const logins: string[] = []
  for (let after = 0; ;) {
    const page: { rows: { seq: number; login: string }[]; more: boolean } = await (
      await streamer.get(`/api/live/${giveawayId}/entrants?after=${after}`)
    ).json()
    logins.push(...page.rows.map((row) => row.login))
    const last = page.rows.at(-1)
    if (!page.more || last === undefined) break
    if (last.seq <= after) throw new Error(`the entrants list did not advance past seq ${after}`)
    after = last.seq
  }
  const usage = await streamer.get("/api/admin/usage")
  const stats: { queue: unknown } | null = usage.status === 200 ? await usage.json() : null
  return { entrantCount: snapshot.entrantCount, logins, queueStats: stats?.queue ?? null }
}

function summarize(input: {
  plan: LoadPlan
  done: readonly ViewerRun[]
  room: RoomView
  startedPerSecond: number
  answeredPerSecond: number
}): LoadReport {
  const { plan, done, room } = input
  const viewers = done.length
  const firsts = done.map((run) => run.first)
  const everyAttempt = done.flatMap((run) =>
    run.repeat === null ? [run.first] : [run.first, run.repeat],
  )
  const accepted = new Set(
    everyAttempt
      .filter((attempt) => acceptedKinds.includes(attempt.final))
      .map((attempt) => attempt.userId),
  )
  const report = {
    viewers,
    requestedRate: plan.rate,
    startedPerSecond: input.startedPerSecond,
    answeredPerSecond: input.answeredPerSecond,
    signIn: summarizeLatency(firsts.map((attempt) => attempt.signInMs)),
    callback: summarizeLatency(firsts.map((attempt) => attempt.callbackMs)),
    queued: summarizeLatency(everyAttempt.flatMap((attempt) => attempt.queuedMs ?? [])),
    callbackOutcomes: tally(everyAttempt.map((attempt) => attempt.callback)),
    finalOutcomes: tally(everyAttempt.map((attempt) => attempt.final)),
    rateLimited: everyAttempt.reduce((sum, attempt) => sum + attempt.rateLimited, 0),
    pollErrors: everyAttempt.reduce((sum, attempt) => sum + attempt.pollErrors, 0),
    repeatAttempts: everyAttempt.length - viewers,
    entrantCount: room.entrantCount,
    acceptedViewers: accepted.size,
    duplicateLogins: room.logins.length - new Set(room.logins).size,
    enteredTwice: done.filter(
      (run) => run.first.final === "entered" && run.repeat?.final === "entered",
    ).length,
    queueStats: room.queueStats,
  }
  return { ...report, failures: failuresOf(report, plan.rate) }
}

function failuresOf(report: Omit<LoadReport, "failures">, rate: number): string[] {
  const failures: string[] = []
  const minimum = rate * rateTolerance
  if (report.startedPerSecond < minimum) {
    failures.push(
      `started ${report.startedPerSecond.toFixed(0)}/s, below ${minimum.toFixed(0)}/s: the generator fell behind`,
    )
  }
  if (report.answeredPerSecond < minimum) {
    failures.push(
      `answered ${report.answeredPerSecond.toFixed(0)}/s, below ${minimum.toFixed(0)}/s: the target is too slow`,
    )
  }
  if (report.acceptedViewers !== report.viewers) {
    failures.push(
      `${report.viewers - report.acceptedViewers} of ${report.viewers} viewers did not end entered`,
    )
  }
  if (report.entrantCount !== report.acceptedViewers) {
    failures.push(
      `entrant count ${report.entrantCount} differs from ${report.acceptedViewers} accepted viewers`,
    )
  }
  if (report.duplicateLogins > 0) {
    failures.push(`${report.duplicateLogins} duplicate logins in the entrants list`)
  }
  if (report.enteredTwice > 0) {
    failures.push(`${report.enteredTwice} viewers were told "entered" twice`)
  }
  return failures
}

function tally(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries(counts)
}
