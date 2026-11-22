import { Database } from "bun:sqlite"
import { readdirSync } from "node:fs"
import {
  createFakeTwitch,
  profileImageUrlOf,
  type FakeTwitch,
  type FakeUser,
} from "@rafflink/fake-twitch"
import type { Hono } from "hono"
import { AdminDirectory } from "../src/admin/admin-directory.ts"
import { AccountStore } from "../src/accounts/account-store.ts"
import { resolveConfig, type ResolvedConfig } from "../src/config.ts"
import type { AppDeps } from "../src/http/deps.ts"
import { createApp } from "../src/http/create-app.ts"
import { codeAlphabet, codeLength } from "../src/lib/codes.ts"
import { toBase64 } from "../src/lib/encoding.ts"
import { MemoryPublicCache } from "../src/lib/memory-public-cache.ts"
import { MemoryRateLimiter } from "../src/lib/memory-rate-limiter.ts"
import { openKeyRing } from "../src/lib/seal.ts"
import type { PlanQueue } from "../src/plan/current-plan.ts"
import type { CloudflarePlan } from "../src/plan/plan-limits.ts"
import type {
  Alarm,
  Clock,
  DayRequests,
  Instant,
  LiveHub,
  Random,
  SqlRow,
  SqlValue,
  UsageMeter,
} from "../src/ports.ts"
import { queueMigrations } from "../src/queue/migrations.ts"
import { TokenQueue, type TokenQueueStub } from "../src/queue/token-queue.ts"
import { GiveawayRoom, type GiveawayInit } from "../src/room/giveaway-room.ts"
import { applyMigrations } from "../src/room/migrate.ts"
import { roomMigrations } from "../src/room/migrations.ts"
import type { RoomDirectory, RoomStub } from "../src/room/room-directory.ts"
import { BunSqliteAsyncSql, BunSqliteSyncSql } from "../src/sqlite-bun.ts"
import { TwitchClient } from "../src/twitch/twitch-client.ts"
import { enterQueuedCode } from "../src/viewer/enter-giveaway.ts"
import { FakeBeacon } from "./fake-beacon.ts"
import { idleChat } from "./idle-chat.ts"

const accountsSchemaDir = new URL("../schema/accounts/", import.meta.url)

export const accountsSchema = (
  await Promise.all(
    readdirSync(accountsSchemaDir)
      .toSorted()
      .map((name) => Bun.file(new URL(name, accountsSchemaDir)).text()),
  )
).join("\n")

export class TestClock implements Clock {
  constructor(private at: Instant) {}
  now(): Instant {
    return this.at
  }
  advance(ms: number): void {
    this.at += ms
  }
}

export class TestAlarm implements Alarm {
  at: Instant | null = null
  set(at: Instant): void {
    this.at = at
  }
  clear(): void {
    this.at = null
  }
}

const silentHub: LiveHub = {
  broadcast: () => {},
  broadcastOverlay: () => {},
  broadcastViewers: () => {},
}

export const secureRandom: Random = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
}

/** Real randomness, except that every `codeLength` request returns the next code from `nextCode`. */
export function codeRandom(nextCode: () => string): Random {
  return {
    bytes: (length) =>
      length === codeLength
        ? Uint8Array.from(nextCode(), (char) => codeAlphabet.indexOf(char))
        : secureRandom.bytes(length),
  }
}

export function sqlRows(db: Database, sql: string, params: readonly SqlValue[] = []): SqlRow[] {
  return db.query<SqlRow, SqlValue[]>(sql).all(...params)
}

/** The planner's lines for a statement, to assert that a query uses an index. */
export function explainPlan(
  db: Database,
  statement: string,
  params: readonly SqlValue[],
): string[] {
  return sqlRows(db, `EXPLAIN QUERY PLAN ${statement}`, params).map((row) => String(row.detail))
}

/** Before a room call: throw to make the call fail. */
export interface RoomHooks {
  beforeInit: (giveawayId: string) => Promise<void> | void
  beforeEnter: (giveawayId: string) => Promise<void> | void
}

/** Rooms of one test, each over its own in-memory database, behind the async stub the app expects. */
export class InProcessRooms implements RoomDirectory {
  readonly hooks: RoomHooks = { beforeInit: () => {}, beforeEnter: () => {} }
  readonly beacon = new FakeBeacon()
  private readonly rooms = new Map<string, GiveawayRoom>()

  constructor(
    private readonly clock: Clock,
    private readonly config: ResolvedConfig,
  ) {}

  get(giveawayId: string): RoomStub {
    return new InProcessRoomStub(giveawayId, this.roomFor(giveawayId), this.hooks)
  }

  /** The real room, for assertions the stub does not offer. */
  roomFor(giveawayId: string): GiveawayRoom {
    const existing = this.rooms.get(giveawayId)
    if (existing !== undefined) return existing
    const sql = new BunSqliteSyncSql(new Database(":memory:"))
    applyMigrations(sql, roomMigrations)
    const room = new GiveawayRoom({
      sql,
      alarm: new TestAlarm(),
      live: silentHub,
      clock: this.clock,
      random: secureRandom,
      config: this.config,
      chat: idleChat,
      beacon: this.beacon,
    })
    this.rooms.set(giveawayId, room)
    return room
  }
}

class InProcessRoomStub implements RoomStub {
  constructor(
    private readonly giveawayId: string,
    private readonly room: GiveawayRoom,
    private readonly hooks: RoomHooks,
  ) {}

  async init(giveaway: GiveawayInit) {
    await this.hooks.beforeInit(this.giveawayId)
    this.room.init(giveaway)
  }
  async enter(viewer: Parameters<GiveawayRoom["enter"]>[0]) {
    await this.hooks.beforeEnter(this.giveawayId)
    return this.room.enter(viewer)
  }
  async summary() {
    return this.room.summary()
  }
  async entryOf(...args: Parameters<GiveawayRoom["entryOf"]>) {
    return this.room.entryOf(...args)
  }
  async entrants(...args: Parameters<GiveawayRoom["entrants"]>) {
    return this.room.entrants(...args)
  }
  async leafOf(...args: Parameters<GiveawayRoom["leafOf"]>) {
    return this.room.leafOf(...args)
  }
  async verification() {
    return this.room.verification()
  }
  async leaves() {
    return this.room.leaves()
  }
  async close() {
    return this.room.close()
  }
  async requestDraw() {
    return this.room.requestDraw()
  }
  async draw() {
    return this.room.draw()
  }
  async setWinnerCount(count: number) {
    return this.room.setWinnerCount(count)
  }
  async reroll(n: number) {
    return this.room.reroll(n)
  }
  async claim(...args: Parameters<GiveawayRoom["claim"]>) {
    return this.room.claim(...args)
  }
  async picks() {
    return this.room.picks()
  }
  async markMirrored(status: Parameters<GiveawayRoom["markMirrored"]>[0]) {
    this.room.markMirrored(status)
  }
  async liveSnapshot() {
    return this.room.liveSnapshot()
  }
  async entriesPerSecondBefore(...args: Parameters<GiveawayRoom["entriesPerSecondBefore"]>) {
    return this.room.entriesPerSecondBefore(...args)
  }
}

export class StubUsageMeter implements UsageMeter {
  usage: DayRequests | null = null
  failure: Error | null = null
  async today(): Promise<DayRequests | null> {
    if (this.failure !== null) throw this.failure
    return this.usage
  }
}

/** Records every plan a switch pushed; `failure` makes the next pushes throw. */
export class RecordingPlanQueue implements PlanQueue {
  readonly plans: CloudflarePlan[] = []
  failure: Error | null = null
  async usePlan(plan: CloudflarePlan): Promise<void> {
    if (this.failure !== null) throw this.failure
    this.plans.push(plan)
  }
}

export const users = {
  streamerA: user("200", "streamer_a"),
  streamerB: user("201", "streamer_b"),
  viewer: user("100", "viewer_one"),
  viewer2: user("101", "viewer_two"),
  viewer3: user("102", "viewer_three"),
} as const

function user(id: string, login: string): FakeUser {
  return {
    id,
    login,
    displayName: `Display_${login}`,
    createdAt: "2019-01-01T00:00:00Z",
    profileImageUrl: profileImageUrlOf(login),
  }
}

export const validTickets = {
  viewer: 1,
  follower: 2,
  sub_t1: 3,
  sub_t2: 4,
  sub_t3: 5,
  vip: 6,
  moderator: 7,
}

export const validRules = {
  tickets: validTickets,
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
}

/** The header a test sets to give a request a client address; the real targets read the one their edge sets. */
export const testAddressHeader = "x-test-address"

export interface Harness {
  readonly app: Hono
  readonly deps: AppDeps
  readonly config: ResolvedConfig
  readonly fake: FakeTwitch
  readonly clock: TestClock
  readonly rooms: InProcessRooms
  readonly usage: StubUsageMeter
  /** Null for a harness like the Bun server, without a Cloudflare plan. */
  readonly planQueue: RecordingPlanQueue | null
  readonly accountsDb: Database
  readonly queue: TokenQueue
  readonly queueDb: Database
  readonly sealKey: string
  stop(): Promise<void>
}

export interface HarnessOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly random?: Random
  /** `bun`: no Cloudflare plan, like the Bun server; the default is like the Cloudflare Worker. */
  readonly target?: "cloudflare" | "bun"
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const fake = createFakeTwitch({
    clientId: "client-1",
    clientSecret: "secret-1",
    defaultUser: users.viewer,
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  for (const fakeUser of Object.values(users)) fake.control.addUser(fakeUser)
  const server = Bun.serve({ port: 0, fetch: fake.app.fetch })
  const sealKey = `test:${toBase64(new Uint8Array(32).fill(3))}`
  const config = resolveConfig({
    TWITCH_CLIENT_ID: "client-1",
    TWITCH_CLIENT_SECRET: "secret-1",
    TOKEN_SEAL_KEYS: sealKey,
    SESSION_SECRET: "session-secret",
    ADMIN_TWITCH_IDS: users.streamerA.id,
    PUBLIC_URL: "http://localhost",
    TWITCH_ID_BASE_URL: server.url.origin,
    TWITCH_HELIX_BASE_URL: server.url.origin,
    TWITCH_TIMEOUT_MS: "2000",
    HELIX_RETRY_DELAY_MS: "0",
    ENTRY_WRITE_RETRY_DELAYS_MS: "0,0,0",
    PUBLIC_GIVEAWAY_CACHE_SECONDS: "0",
    ...options.env,
  })
  const clock = new TestClock(Date.now())
  const random = options.random ?? secureRandom
  const accountsDb = new Database(":memory:")
  accountsDb.exec(accountsSchema)
  const accounts = new AccountStore(new BunSqliteAsyncSql(accountsDb), config)
  const rooms = new InProcessRooms(clock, config)
  const twitch = new TwitchClient(config, fetch)
  const usage = new StubUsageMeter()
  const planQueue = options.target === "bun" ? null : new RecordingPlanQueue()
  const queueDb = new Database(":memory:")
  const queueSql = new BunSqliteSyncSql(queueDb)
  applyMigrations(queueSql, queueMigrations)
  const entryUserLimiter = new MemoryRateLimiter(clock, config.entryUserLimitPerMinute, 60_000)
  const entryDeps = { config, clock, random, twitch, accounts, rooms, entryUserLimiter }
  const queue = new TokenQueue({
    sql: queueSql,
    alarm: new TestAlarm(),
    clock,
    random,
    config,
    process: (item) => enterQueuedCode(entryDeps, item),
    rooms,
    entriesPerInvocation: config.queueMaxRatePerSecond,
  })
  const deps: AppDeps = {
    ...entryDeps,
    queue: asRemote(queue),
    usage,
    planQueue,
    publicCache: new MemoryPublicCache(clock, config.publicCacheMaxEntries),
    keyRing: await openKeyRing([sealKey]),
    admins: new AdminDirectory(config, twitch),
    entryIpLimiter: new MemoryRateLimiter(clock, config.entryIpLimitPerMinute, 60_000),
    leavesIpLimiter: new MemoryRateLimiter(clock, config.leavesIpLimitPerMinute, 60_000),
    clientAddress: (request) => request.headers.get(testAddressHeader),
  }
  return {
    app: createApp(deps, null),
    deps,
    config,
    fake,
    clock,
    rooms,
    usage,
    planQueue,
    accountsDb,
    queue,
    queueDb,
    sealKey,
    stop: async () => {
      await server.stop(true)
    },
  }
}

function asRemote(queue: TokenQueue): TokenQueueStub {
  return {
    enqueue: async (item, cause) => queue.enqueue(item, cause),
    poll: async (ticket) => queue.poll(ticket),
    stats: async () => queue.stats(),
  }
}

/** A cookie jar and the redirects between the app and the fake Twitch, like one browser. */
export class Browser {
  private readonly cookies = new Map<string, string>()

  constructor(private readonly harness: Harness) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "))
    }
    const response = await this.harness.app.request(path, { ...init, headers })
    for (const setCookie of response.headers.getSetCookie()) this.store(setCookie)
    return response
  }

  async postJson(path: string, body: unknown): Promise<Response> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name)
  }

  cookieNames(): string[] {
    return [...this.cookies.keys()]
  }

  /** Starts a sign-in and returns the `state` Twitch would send back; the consent step is not run. */
  async startSignIn(startPath: string): Promise<string> {
    const start = await this.request(startPath)
    return new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? ""
  }

  /** Sign-in start, the fake's consent, and the callback, which carries `callbackHeaders`; the callback response is returned. */
  async signInAs(
    userId: string,
    startPath: string,
    callbackHeaders: HeadersInit = {},
  ): Promise<SignIn> {
    this.harness.fake.control.signInAs(userId)
    const start = await this.request(startPath)
    const authorizeUrl = new URL(start.headers.get("location") ?? "")
    const authorize = await fetch(authorizeUrl, { redirect: "manual" })
    const callbackUrl = new URL(authorize.headers.get("location") ?? "")
    return {
      response: await this.request(callbackUrl.pathname + callbackUrl.search, {
        headers: callbackHeaders,
      }),
      state: authorizeUrl.searchParams.get("state") ?? "",
      nonce: authorizeUrl.searchParams.get("nonce") ?? "",
      code: callbackUrl.searchParams.get("code") ?? "",
    }
  }

  private store(setCookie: string): void {
    const [pair = "", ...attributes] = setCookie.split(";").map((part) => part.trim())
    const separator = pair.indexOf("=")
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    const expired = attributes.some((attribute) => attribute.toLowerCase() === "max-age=0")
    if (expired || value === "") this.cookies.delete(name)
    else this.cookies.set(name, value)
  }
}

export interface SignIn {
  readonly response: Response
  readonly state: string
  readonly nonce: string
  readonly code: string
}

export function entryQuery(response: Response): URLSearchParams {
  return new URL(response.headers.get("location") ?? "", "http://localhost").searchParams
}

/** Signs a streamer in and creates one giveaway; returns the browser, the giveaway id and its code. */
export async function createGiveaway(
  harness: Harness,
  streamerId: string = users.streamerA.id,
  overrides: Record<string, unknown> = {},
) {
  const browser = new Browser(harness)
  await browser.signInAs(streamerId, "/auth/twitch/streamer/start")
  const response = await browser.postJson("/api/dash/giveaways", {
    title: "Giveaway",
    prize: "Prize",
    rules: validRules,
    ...overrides,
  })
  const body: { giveaway: { id: string; code: string; overlayToken: string } } =
    await response.json()
  return {
    browser,
    id: body.giveaway.id,
    code: body.giveaway.code,
    overlayToken: body.giveaway.overlayToken,
  }
}
