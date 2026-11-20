import { expect, it } from "bun:test"
import type { GiveawayRules } from "../../src/domain/rules.ts"
import { toBase64 } from "../../src/lib/encoding.ts"
import type { QueueStats } from "../../src/queue/token-queue.ts"
import type { LiveSnapshot } from "../../src/room/giveaway-room.ts"
import { Browser } from "./browser.ts"
import { clientCredentials, startFakeTwitch, users, type RunningFakeTwitch } from "./fake-twitch.ts"
import { openSocket, type LiveMessage } from "./socket.ts"
import { webFixture } from "./spa-fixture.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { waitFor } from "./wait.ts"

// A scenario that waits for a 4 s cooldown or a 2 s code age needs room above both.
const scenarioTimeoutMs = 30_000
const waitTimeoutMs = 15_000

export const eventSubPath = "/eventsub/ws"
export const vipsPath = "/helix/channels/vips"
export const moderatorsPath = "/helix/moderation/moderators"

export const defaultRules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
}

export interface GiveawayOptions {
  readonly rules?: Partial<GiveawayRules>
  readonly closesAt?: Date
  readonly claimSeconds?: number
  readonly streamer?: Browser
  /** Creates the giveaway without a title and a prize. */
  readonly unnamed?: boolean
}

export interface CreatedGiveaway {
  readonly streamer: Browser
  readonly id: string
  readonly code: string
  readonly overlayToken: string
}

/** What the sign-in callback redirected the viewer's page to. */
export interface EntryResult {
  readonly viewer: Browser
  readonly entry: string | null
  readonly reason: string | null
  readonly ticket: string | null
}

/** The answer of the page's poll for a queued code. */
export interface PendingResult {
  readonly kind: string
  readonly entry?: { readonly group: string; readonly tickets: number }
}

/** Registers one scenario: a fresh fake Twitch and fresh targets, all stopped when the scenario ends. */
export function scenario(
  context: ContractContext,
  name: string,
  body: (world: World) => Promise<void>,
): void {
  it(
    name,
    async () => {
      const world = new World(context)
      try {
        await body(world)
      } finally {
        await world.stop()
      }
    },
    scenarioTimeoutMs,
  )
}

export class World {
  readonly twitch: RunningFakeTwitch = startFakeTwitch()
  private readonly targets: ContractTarget[] = []
  private readonly sockets: WebSocket[] = []
  private readonly web = webFixture()

  constructor(private readonly context: ContractContext) {}

  /** Starts a target; `overrides` set the timing keys a scenario needs short. */
  async start(overrides: Readonly<Record<string, string>> = {}): Promise<ContractTarget> {
    const target = await this.context.startTarget(
      { ...this.baseEnv(), ...overrides },
      this.web.path,
    )
    this.targets.push(target)
    return target
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.close()
    for (const target of this.targets) await target.stop()
    await this.twitch.stop()
    this.web.remove()
  }

  waitFor(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
    return waitFor(check, waitTimeoutMs, `${what} on ${this.context.targetName}`)
  }

  openSocket<Message = LiveMessage>(url: URL, headers: Record<string, string> = {}) {
    const opened = openSocket<Message>(url, headers)
    this.sockets.push(opened.socket)
    return opened
  }

  async signInStreamer(
    target: ContractTarget,
    userId: string = users.streamer.id,
  ): Promise<Browser> {
    const streamer = new Browser(target.url)
    await streamer.signInAs(userId, "/auth/twitch/streamer/start", this.twitch.fake.control)
    return streamer
  }

  async createGiveaway(
    target: ContractTarget,
    options: GiveawayOptions = {},
  ): Promise<CreatedGiveaway> {
    const streamer = options.streamer ?? (await this.signInStreamer(target))
    const response = await streamer.postJson("/api/dash/giveaways", {
      title: options.unnamed === true ? undefined : "Giveaway",
      prize: options.unnamed === true ? undefined : "Prize",
      rules: { ...defaultRules, ...options.rules },
      closesAt: options.closesAt?.toISOString(),
      claimSeconds: options.claimSeconds,
    })
    expect(response.status).toBe(201)
    const body: { giveaway: { id: string; code: string; overlayToken: string } } =
      await response.json()
    return { streamer, ...body.giveaway }
  }

  /** Signs `userId` in as a viewer of the giveaway; pass `viewer` to sign in again as the same browser. */
  async enter(
    target: ContractTarget,
    code: string,
    userId: string,
    viewer: Browser = new Browser(target.url),
  ): Promise<EntryResult> {
    const response = await viewer.signInAs(
      userId,
      `/auth/twitch/viewer/start?giveaway=${code}`,
      this.twitch.fake.control,
    )
    return { viewer, ...callbackOutcome(response) }
  }

  /** Polls a queued code the way the page does, until it is no longer waiting. */
  async settle(viewer: Browser, code: string, ticket: string): Promise<PendingResult> {
    let result: PendingResult = { kind: "pending" }
    await this.waitFor(async () => {
      result = await (await viewer.request(`/api/g/${code}/pending/${ticket}`)).json()
      return result.kind !== "pending"
    }, "the queued code to settle")
    return result
  }

  async live(giveaway: CreatedGiveaway): Promise<LiveSnapshot> {
    const response = await giveaway.streamer.request(`/api/live/${giveaway.id}`)
    expect(response.status).toBe(200)
    return response.json()
  }

  /** The queue counters of the admin JSON; the streamer must be an admin. */
  async queueStats(streamer: Browser): Promise<QueueStats> {
    const response = await streamer.request("/api/admin/usage")
    expect(response.status).toBe(200)
    const body: { queue: QueueStats } = await response.json()
    return body.queue
  }

  /** Waits until the room's first role refresh has asked for both lists, after which it no longer calls the token endpoint. */
  waitForFirstRoleRefresh(): Promise<void> {
    return this.waitFor(
      () => this.twitchCalls(vipsPath) >= 1 && this.twitchCalls(moderatorsPath) >= 1,
      "the first role refresh",
    )
  }

  closeGiveaway(giveaway: CreatedGiveaway): Promise<Response> {
    return giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/close`, {})
  }

  drawWinners(giveaway: CreatedGiveaway, count: number): Promise<Response> {
    return giveaway.streamer.postJson(`/api/dash/giveaways/${giveaway.id}/draw`, { count })
  }

  /** Requests the fake Twitch has received on `path`. */
  twitchCalls(path: string): number {
    return this.twitch.fake.control.calls.filter((call) => call.path === path).length
  }

  private baseEnv(): Record<string, string> {
    return {
      TWITCH_CLIENT_ID: clientCredentials.id,
      TWITCH_CLIENT_SECRET: clientCredentials.secret,
      TOKEN_SEAL_KEYS: `contract:${toBase64(new Uint8Array(32).fill(3))}`,
      SESSION_SECRET: "contract-session-secret",
      ADMIN_TWITCH_IDS: users.streamer.id,
      PUBLIC_URL: publicOrigin,
      TWITCH_ID_BASE_URL: this.twitch.origin,
      TWITCH_HELIX_BASE_URL: this.twitch.origin,
      EVENTSUB_URL: `${this.twitch.origin.replace(/^http/, "ws")}${eventSubPath}`,
      TWITCH_TIMEOUT_MS: "2000",
      HELIX_RETRY_DELAY_MS: "0",
      ENTRY_WRITE_RETRY_DELAYS_MS: "0",
      PUBLIC_GIVEAWAY_CACHE_SECONDS: "0",
    }
  }
}

/** The origin of `PUBLIC_URL` in the contract environment, which a browser sends as `Origin`. */
export const publicOrigin = "http://localhost"

export function callbackOutcome(response: Response): Omit<EntryResult, "viewer"> {
  const query = new URL(response.headers.get("location") ?? "", "http://localhost").searchParams
  return { entry: query.get("entry"), reason: query.get("reason"), ticket: query.get("ticket") }
}
