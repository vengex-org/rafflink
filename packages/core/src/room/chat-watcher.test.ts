import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { resolveConfig } from "../config.ts"
import type { GiveawayRules } from "../domain/rules.ts"
import type {
  Alarm,
  Clock,
  Instant,
  Random,
  SocketConnector,
  SocketHandlers,
  SqlValue,
  TextSocket,
} from "../ports.ts"
import { BunSqliteSyncSql } from "../sqlite-bun.ts"
import {
  ChatConnectionLost,
  ChatWatcher,
  type ChatMessage,
  type ChatWatcherConfig,
} from "./chat-watcher.ts"
import { GiveawayRoom, type GiveawayInit, type RoomViewer } from "./giveaway-room.ts"
import { applyMigrations } from "./migrate.ts"
import { roomMigrations } from "./migrations.ts"
import { nextClaimDeadlineSql, waitingPickOfChatterSql } from "./queries.ts"

const eventSubEnv = {
  EVENTSUB_URL: "wss://twitch.test/ws",
  EVENTSUB_SUBSCRIBE_SECONDS: "10",
  EVENTSUB_CONNECTION_MAX_SECONDS: "900",
  EVENTSUB_RECONNECT_MARGIN_SECONDS: "60",
  EVENTSUB_KEEPALIVE_GRACE_SECONDS: "5",
  EVENTSUB_RECONNECT_DELAY_SECONDS: "2",
  EVENTSUB_RECONNECT_MAX_ATTEMPTS: "3",
}

function configWith(overrides: Readonly<Record<string, string>> = {}) {
  return resolveConfig({
    TWITCH_CLIENT_ID: "client",
    TWITCH_CLIENT_SECRET: "secret",
    TOKEN_SEAL_KEYS: "k1",
    SESSION_SECRET: "session",
    ADMIN_TWITCH_IDS: "1",
    PUBLIC_URL: "https://rafflink.app",
    LIVE_INTERVAL_MS: "1000",
    ...eventSubEnv,
    ...overrides,
  })
}

class TestClock implements Clock {
  constructor(private at: Instant) {}
  now(): Instant {
    return this.at
  }
  advance(ms: number): void {
    this.at += ms
  }
}

class TestAlarm implements Alarm {
  at: Instant | null = null
  set(at: Instant): void {
    this.at = at
  }
  clear(): void {
    this.at = null
  }
}

class ScriptedSocket implements TextSocket {
  closed = false
  constructor(
    readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {}
  close(): void {
    if (this.closed) return
    this.closed = true
    this.handlers.onClose(undefined)
  }
  receive(message: object): void {
    this.handlers.onText(JSON.stringify(message))
  }
  receiveText(text: string): void {
    this.handlers.onText(text)
  }
  /** The peer drops the connection. */
  fail(cause: unknown): void {
    this.handlers.onClose(cause)
  }
}

class ScriptedConnector implements SocketConnector {
  readonly sockets: ScriptedSocket[] = []
  open(url: string, handlers: SocketHandlers): TextSocket {
    const socket = new ScriptedSocket(url, handlers)
    this.sockets.push(socket)
    return socket
  }
}

function welcome(sessionId: string, keepaliveSeconds = 10) {
  return {
    metadata: { message_type: "session_welcome" },
    payload: { session: { id: sessionId, keepalive_timeout_seconds: keepaliveSeconds } },
  }
}

const keepalive = { metadata: { message_type: "session_keepalive" }, payload: {} }

function reconnect(url: string) {
  return {
    metadata: { message_type: "session_reconnect" },
    payload: { session: { reconnect_url: url } },
  }
}

function chat(chatterUserId: string, text: string) {
  return {
    metadata: { message_type: "notification", subscription_type: "channel.chat.message" },
    payload: { event: { chatter_user_id: chatterUserId, message: { text } } },
  }
}

/** Lets the promise callbacks of a subscription run. */
function flush(): Promise<void> {
  return Bun.sleep(0)
}

/** Stands in for the Helix call: succeeds unless a test makes it refuse. */
class Subscriptions {
  readonly sessions: string[] = []
  refusal: Error | null = null
  subscribe = async (sessionId: string): Promise<void> => {
    this.sessions.push(sessionId)
    if (this.refusal !== null) throw this.refusal
  }
}

function watcherUnderTest(overrides: Readonly<Record<string, string>> = {}) {
  const config: ChatWatcherConfig = configWith(overrides)
  const connector = new ScriptedConnector()
  const clock = new TestClock(0)
  const subscriptions = new Subscriptions()
  const messages: ChatMessage[] = []
  const unavailable: unknown[] = []
  const schedules = { count: 0 }
  const watcher = new ChatWatcher({
    connector,
    subscribe: subscriptions.subscribe,
    clock,
    config,
    onMessage: (message) => messages.push(message),
    onUnavailable: (cause) => unavailable.push(cause),
    onSchedule: () => void (schedules.count += 1),
  })
  return { watcher, connector, clock, subscriptions, messages, unavailable, schedules }
}

async function liveWatcher(overrides: Readonly<Record<string, string>> = {}) {
  const context = watcherUnderTest(overrides)
  context.watcher.open()
  context.connector.sockets[0]?.receive(welcome("session-1"))
  await flush()
  return context
}

describe("ChatWatcher connection", () => {
  it("connects to the configured URL once however often it is opened", () => {
    const { watcher, connector } = watcherUnderTest()

    watcher.open()
    watcher.open()

    expect(connector.sockets.map((socket) => socket.url)).toEqual(["wss://twitch.test/ws"])
  })

  it("subscribes the session of the welcome and hands on chat messages", async () => {
    const { watcher, connector, subscriptions, messages } = watcherUnderTest()
    watcher.open()
    const [socket] = connector.sockets

    socket?.receive(welcome("session-1"))
    await flush()
    socket?.receive(chat("42", "!claim"))

    expect(subscriptions.sessions).toEqual(["session-1"])
    expect(messages).toEqual([{ chatterUserId: "42", text: "!claim" }])
  })

  it("hands on nothing but chat notifications", async () => {
    const { connector, messages } = await liveWatcher()
    const [socket] = connector.sockets

    socket?.receive(keepalive)
    socket?.receive({
      metadata: { message_type: "revocation", subscription_type: "channel.follow" },
      payload: {},
    })
    socket?.receive({
      metadata: { message_type: "notification", subscription_type: "channel.follow" },
      payload: {},
    })

    expect(messages).toEqual([])
  })

  it("gives up as unavailable when the subscription is refused", async () => {
    const { watcher, connector, subscriptions, unavailable, messages } = watcherUnderTest()
    const refusal = new Error("403 missing scope")
    subscriptions.refusal = refusal
    watcher.open()
    const [socket] = connector.sockets

    socket?.receive(welcome("session-1"))
    await flush()
    socket?.receive(chat("42", "late"))

    expect(unavailable).toEqual([refusal])
    expect(socket?.closed).toBe(true)
    expect(watcher.wakeAt()).toBeNull()
    expect(messages).toEqual([])
  })

  it("closes every socket and stops on close", async () => {
    const { watcher, connector, messages } = await liveWatcher()
    const [socket] = connector.sockets

    watcher.close()
    socket?.receive(chat("42", "late"))

    expect(socket?.closed).toBe(true)
    expect(messages).toEqual([])
    expect(watcher.wakeAt()).toBeNull()
  })

  it("treats a frame that is not a message as a lost connection", async () => {
    const { watcher, connector, clock } = await liveWatcher()
    const [socket] = connector.sockets

    socket?.receiveText("not json")
    clock.advance(2000)
    watcher.onAlarm()

    expect(socket?.closed).toBe(true)
    expect(connector.sockets).toHaveLength(2)
  })
})

describe("ChatWatcher keepalive", () => {
  it("reconnects once the announced keepalive timeout and the grace have passed in silence", async () => {
    const { watcher, connector, clock } = await liveWatcher()

    clock.advance(14_999)
    watcher.onAlarm()
    expect(connector.sockets).toHaveLength(1)

    clock.advance(1)
    watcher.onAlarm()
    expect(connector.sockets[0]?.closed).toBe(true)
    expect(connector.sockets).toHaveLength(1)

    clock.advance(2000)
    watcher.onAlarm()
    expect(connector.sockets.map((socket) => socket.url)).toEqual([
      "wss://twitch.test/ws",
      "wss://twitch.test/ws",
    ])
  })

  it("counts a keepalive message as proof of life", async () => {
    const { watcher, connector, clock } = await liveWatcher()
    clock.advance(10_000)
    connector.sockets[0]?.receive(keepalive)

    clock.advance(14_999)
    watcher.onAlarm()

    expect(connector.sockets[0]?.closed).toBe(false)
    expect(watcher.wakeAt()).toBe(10_000 + 15_000)
  })

  it("retries a connection that sends no welcome inside the subscribe window", () => {
    const { watcher, connector, clock } = watcherUnderTest()
    watcher.open()

    clock.advance(10_000)
    watcher.onAlarm()
    clock.advance(2000)
    watcher.onAlarm()

    expect(connector.sockets[0]?.closed).toBe(true)
    expect(connector.sockets).toHaveLength(2)
  })
})

describe("ChatWatcher session_reconnect", () => {
  it("connects to the given URL before it closes the old socket and does not subscribe again", async () => {
    const { connector, subscriptions, messages } = await liveWatcher()
    const [old] = connector.sockets

    old?.receive(reconnect("wss://twitch.test/ws?reconnect=1"))
    expect(connector.sockets.map((socket) => socket.url)).toEqual([
      "wss://twitch.test/ws",
      "wss://twitch.test/ws?reconnect=1",
    ])
    expect(old?.closed).toBe(false)

    connector.sockets[1]?.receive(welcome("session-1"))
    connector.sockets[1]?.receive(chat("42", "!claim"))

    expect(old?.closed).toBe(true)
    expect(subscriptions.sessions).toEqual(["session-1"])
    expect(messages).toEqual([{ chatterUserId: "42", text: "!claim" }])
  })

  it("keeps listening on the old socket until the new one is welcomed", async () => {
    const { connector, messages } = await liveWatcher()
    const [old] = connector.sockets

    old?.receive(reconnect("wss://twitch.test/ws?reconnect=1"))
    old?.receive(chat("42", "before the switch"))

    expect(messages).toEqual([{ chatterUserId: "42", text: "before the switch" }])
  })

  it("ignores a reconnect URL that is not a WebSocket URL", async () => {
    const { connector } = await liveWatcher()

    connector.sockets[0]?.receive(reconnect("https://twitch.test/ws"))

    expect(connector.sockets).toHaveLength(1)
    expect(connector.sockets[0]?.closed).toBe(true)
  })
})

describe("ChatWatcher connection age", () => {
  it("replaces a connection at the maximum age minus the margin and drops the old one once the new one subscribed", async () => {
    const { watcher, connector, clock, subscriptions, messages } = await liveWatcher()
    const [old] = connector.sockets
    clock.advance(839_999)
    old?.receive(keepalive)
    watcher.onAlarm()
    expect(connector.sockets).toHaveLength(1)

    clock.advance(1)
    old?.receive(keepalive)
    watcher.onAlarm()
    expect(connector.sockets).toHaveLength(2)
    expect(old?.closed).toBe(false)

    connector.sockets[1]?.receive(welcome("session-2"))
    await flush()
    connector.sockets[1]?.receive(chat("42", "!claim"))

    expect(old?.closed).toBe(true)
    expect(subscriptions.sessions).toEqual(["session-1", "session-2"])
    expect(messages).toEqual([{ chatterUserId: "42", text: "!claim" }])
    expect(watcher.wakeAt()).toBe(840_000 + 15_000)
  })
})

const revocation = {
  metadata: { message_type: "revocation", subscription_type: "channel.chat.message" },
  payload: {},
}

/** Moves a live watcher to the moment its replacement is due, with the old socket still alive. */
async function dueForReplacement(overrides: Readonly<Record<string, string>> = {}) {
  const context = await liveWatcher(overrides)
  context.clock.advance(839_999)
  context.connector.sockets[0]?.receive(keepalive)
  context.clock.advance(1)
  context.connector.sockets[0]?.receive(keepalive)
  context.watcher.onAlarm()
  return context
}

describe("ChatWatcher failed replacement", () => {
  it("keeps the old socket when the replacement cannot subscribe and retries on the next wake", async () => {
    const { watcher, connector, clock, subscriptions, unavailable } = await dueForReplacement()
    const [old, failed] = connector.sockets
    subscriptions.refusal = new Error("helix 500")
    failed?.receive(welcome("session-2"))
    await flush()

    expect(unavailable).toEqual([])
    expect(old?.closed).toBe(false)
    expect(failed?.closed).toBe(true)
    expect(watcher.wakeAt()).toBe(840_000 + 2000)

    clock.advance(2000)
    old?.receive(keepalive)
    subscriptions.refusal = null
    watcher.onAlarm()
    connector.sockets[2]?.receive(welcome("session-3"))
    await flush()

    expect(old?.closed).toBe(true)
    expect(connector.sockets).toHaveLength(3)
    expect(subscriptions.sessions).toEqual(["session-1", "session-2", "session-3"])
    expect(unavailable).toEqual([])
  })

  it("stops replacing after the cap but serves until the old socket reaches its maximum age, then gives up", async () => {
    const { watcher, connector, clock, subscriptions, unavailable } = await dueForReplacement({
      EVENTSUB_RECONNECT_MAX_ATTEMPTS: "1",
    })
    subscriptions.refusal = new Error("helix 500")
    for (let failure = 0; failure < 2; failure++) {
      connector.sockets.at(-1)?.receive(welcome(`session-${failure + 2}`))
      await flush()
      clock.advance(2000)
      connector.sockets[0]?.receive(keepalive)
      watcher.onAlarm()
    }
    expect(connector.sockets).toHaveLength(3)
    expect(connector.sockets[0]?.closed).toBe(false)
    expect(unavailable).toEqual([])

    clock.advance(900_000 - clock.now())
    connector.sockets[0]?.receive(keepalive)
    watcher.onAlarm()

    expect(connector.sockets[0]?.closed).toBe(true)
    expect(unavailable).toHaveLength(1)
    expect(unavailable[0]).toMatchObject({ reason: "max-age" })
  })

  it("gives up at once when the very first subscription is refused", async () => {
    const { watcher, connector, subscriptions, unavailable } = watcherUnderTest()
    subscriptions.refusal = new Error("403")
    watcher.open()

    connector.sockets[0]?.receive(welcome("session-1"))
    await flush()

    expect(unavailable).toHaveLength(1)
  })
})

describe("ChatWatcher revocation", () => {
  it("gives up as unavailable when Twitch revokes the chat subscription", async () => {
    const { watcher, connector, unavailable } = await liveWatcher()

    connector.sockets[0]?.receive(revocation)

    expect(connector.sockets[0]?.closed).toBe(true)
    expect(unavailable).toHaveLength(1)
    expect(unavailable[0]).toMatchObject({ reason: "revoked" })
    expect(watcher.wakeAt()).toBeNull()
  })
})

describe("ChatWatcher attempts", () => {
  it("reports unavailable once the reconnects in a row pass the cap, not before", () => {
    const { watcher, connector, clock, unavailable } = watcherUnderTest()
    const cause = new Error("connection refused")
    watcher.open()

    for (let attempt = 1; attempt <= 3; attempt++) {
      connector.sockets.at(-1)?.fail(cause)
      expect(unavailable).toEqual([])
      clock.advance(2000)
      watcher.onAlarm()
      expect(connector.sockets).toHaveLength(attempt + 1)
    }
    connector.sockets.at(-1)?.fail(cause)

    expect(unavailable).toEqual([cause])
    expect(watcher.wakeAt()).toBeNull()
  })

  it("starts counting again after a connection subscribed", async () => {
    const { watcher, connector, clock, unavailable } = watcherUnderTest()
    watcher.open()
    for (let attempt = 0; attempt < 2; attempt++) {
      connector.sockets.at(-1)?.fail(new Error("refused"))
      clock.advance(2000)
      watcher.onAlarm()
    }
    connector.sockets.at(-1)?.receive(welcome("session-1"))
    await flush()

    for (let attempt = 0; attempt < 3; attempt++) {
      connector.sockets.at(-1)?.fail(new Error("dropped"))
      clock.advance(2000)
      watcher.onAlarm()
    }

    expect(unavailable).toEqual([])
    expect(connector.sockets).toHaveLength(6)
  })

  it("passes a peer close without a cause on as a lost connection", () => {
    const { watcher, connector, clock, unavailable } = watcherUnderTest({
      EVENTSUB_RECONNECT_MAX_ATTEMPTS: "1",
    })
    watcher.open()

    connector.sockets[0]?.fail(undefined)
    clock.advance(2000)
    watcher.onAlarm()
    connector.sockets[1]?.fail(undefined)

    expect(unavailable).toHaveLength(1)
    expect(unavailable[0]).toBeInstanceOf(ChatConnectionLost)
    expect(unavailable[0]).toMatchObject({ reason: "closed" })
  })

  it("tells the owner when a failure moved the next wake-up", () => {
    const { watcher, connector, schedules } = watcherUnderTest()
    watcher.open()

    connector.sockets[0]?.fail(new Error("refused"))

    expect(schedules.count).toBe(1)
    expect(watcher.wakeAt()).toBe(2000)
  })
})

const rules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
}

const random: Random = { bytes: (length) => new Uint8Array(length).fill(7) }

function viewer(id: string): RoomViewer {
  return {
    platformUserId: id,
    login: `login${id}`,
    displayName: `Name${id}`,
    isFollower: false,
    subTier: null,
    accountAgeDays: 100,
  }
}

function roomInit(claimKeyword: string | null): GiveawayInit {
  return {
    id: "g1",
    platform: "twitch",
    broadcasterId: "broadcaster",
    title: "Giveaway",
    code: "ABCDE",
    rules: { ...rules, claimKeyword },
    claimSeconds: 300,
    closesAt: null,
  }
}

function roomUnderTest(
  options: {
    readonly env?: Readonly<Record<string, string>>
    readonly claimKeyword?: string | null
  } = {},
) {
  const db = new Database(":memory:")
  const sql = new BunSqliteSyncSql(db)
  applyMigrations(sql, roomMigrations)
  const clock = new TestClock(0)
  const alarm = new TestAlarm()
  const connector = new ScriptedConnector()
  const subscriptions = new Subscriptions()
  const config = configWith(options.env)
  const chatLink = { connector, subscribe: subscriptions.subscribe }
  const viewerMessages: string[] = []
  const room = new GiveawayRoom({
    sql,
    alarm,
    live: { broadcast: () => {}, broadcastViewers: (json) => void viewerMessages.push(json) },
    clock,
    random,
    config,
    chat: chatLink,
  })
  room.init(roomInit(options.claimKeyword ?? null))
  return { db, sql, room, clock, alarm, connector, subscriptions, config, chatLink, viewerMessages }
}

/**
 * Three entrants, entries closed, one winner drawn: the chat watch opens. The clock moves a millisecond
 * per step, so no live push is held back and the alarm shows only the watch and the claim time.
 */
async function drawnRoom(options: Parameters<typeof roomUnderTest>[0] = {}) {
  const context = roomUnderTest({ ...options, env: { LIVE_INTERVAL_MS: "1", ...options.env } })
  for (const id of ["1", "2", "3"]) {
    context.clock.advance(1)
    context.room.enter(viewer(id))
  }
  context.clock.advance(1)
  context.room.close()
  context.clock.advance(1)
  await context.room.draw(1)
  const winner = context.room.picks()[0]?.platformUserId ?? ""
  const loser = ["1", "2", "3"].find((id) => id !== winner) ?? ""
  return { ...context, winner, loser, drawnAt: context.clock.now() }
}

async function connectedRoom(options: Parameters<typeof roomUnderTest>[0] = {}) {
  const context = await drawnRoom(options)
  const socket = context.connector.sockets[0]
  socket?.receive(welcome("session-1"))
  await flush()
  return { ...context, socket }
}

function dump(db: Database): string {
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
  return JSON.stringify(tables.map(({ name }) => db.query(`SELECT * FROM "${name}"`).all()))
}

function plan(db: Database, statement: string, params: readonly SqlValue[]): string[] {
  return new BunSqliteSyncSql(db)
    .exec(`EXPLAIN QUERY PLAN ${statement}`, params)
    .map((row) => String(row.detail))
}

afterEach(() => {
  for (const method of ["warn", "info", "log", "error"] as const)
    spyOn(console, method).mockRestore()
})

describe("chat claim", () => {
  it("a message from the winner claims via chat", async () => {
    const { room, socket, winner, subscriptions } = await connectedRoom()

    socket?.receive(chat(winner, "here I am"))

    expect(subscriptions.sessions).toEqual(["session-1"])
    expect(room.liveSnapshot().winners[0]?.claim).toEqual({ state: "claimed", via: "chat" })
  })

  it("messages from others are not stored", async () => {
    const { room, db, socket, loser } = await connectedRoom()
    const logged = (["warn", "info", "log", "error"] as const).map((method) =>
      spyOn(console, method).mockImplementation(() => {}),
    )
    const secret = "SECRET-CHAT-LINE-31337"

    socket?.receive(chat(loser, secret))
    socket?.receive(chat("999", secret))

    expect(room.liveSnapshot().winners[0]?.claim).toEqual({ state: "waiting" })
    expect(dump(db)).not.toContain(secret)
    expect(JSON.stringify(logged.map((spy) => spy.mock.calls))).not.toContain(secret)
  })

  it("ignores the winner's message while it lacks the keyword", async () => {
    const { room, socket, winner } = await connectedRoom({ claimKeyword: "!Claim" })

    socket?.receive(chat(winner, "hello"))
    socket?.receive(chat(winner, ""))

    expect(room.liveSnapshot().winners[0]?.claim).toEqual({ state: "waiting" })
  })

  it("accepts the keyword in any case, inside a longer message and around spaces", async () => {
    const { room, socket, winner } = await connectedRoom({ claimKeyword: " !Claim " })

    socket?.receive(chat(winner, "  well !CLAIM it  "))

    expect(room.liveSnapshot().winners[0]?.claim).toEqual({ state: "claimed", via: "chat" })
  })

  it("does not let the chat overwrite a claim that was already made", async () => {
    const { room, socket, winner } = await connectedRoom()
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")

    socket?.receive(chat(winner, "claim"))

    expect(room.liveSnapshot().winners[0]?.claim).toEqual({ state: "claimed", via: "manual" })
  })
})

describe("chat watch lifetime", () => {
  it("opens when the draw leaves a winner waiting and closes once the winner claimed", async () => {
    const { room, connector, winner } = await drawnRoom()
    expect(connector.sockets.map((socket) => socket.closed)).toEqual([false])

    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")

    expect(connector.sockets.map((socket) => socket.closed)).toEqual([true])
  })

  it("does not open for a room that is not drawn", () => {
    const { room, connector } = roomUnderTest()
    room.enter(viewer("1"))
    room.close()

    expect(connector.sockets).toHaveLength(0)
  })

  it("keeps the socket for the next winner when a reroll replaces the one who waits", async () => {
    const { room, connector } = await drawnRoom()

    await room.reroll(0)

    expect(connector.sockets.map((socket) => socket.closed)).toEqual([false])
  })

  it("opens again when a reroll gives a new winner after the claim time of the old one ended", async () => {
    const { room, clock, connector } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "1000" },
    })
    clock.advance(300_001)
    room.onAlarm()
    expect(connector.sockets.map((socket) => socket.closed)).toEqual([true])

    await room.reroll(0)

    expect(connector.sockets.map((socket) => socket.closed)).toEqual([true, false])
  })

  it("closes when the claim time is over", async () => {
    const { room, clock, connector, drawnAt } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "1000" },
    })

    clock.advance(300_000)
    room.onAlarm()
    expect(clock.now()).toBe(drawnAt + 300_000)
    expect(connector.sockets[0]?.closed).toBe(false)

    clock.advance(1)
    room.onAlarm()
    expect(connector.sockets[0]?.closed).toBe(true)
  })

  it("wakes the room one past the claim time when nothing else is due", async () => {
    // The status mirror and the subscribe window would wake the room sooner.
    const { alarm, drawnAt } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "1000", MIRROR_RETRY_SECONDS: "100000" },
    })

    expect(alarm.at).toBe(drawnAt + 300_001)
  })

  it("wakes the room for the subscribe window and then for the keepalive", async () => {
    const { alarm, connector, drawnAt } = await drawnRoom()
    expect(alarm.at).toBe(drawnAt + 10_000)

    connector.sockets[0]?.receive(welcome("session-1"))
    await flush()

    expect(alarm.at).toBe(drawnAt + 15_000)
  })

  it("opens again on the first alarm after the room object was recreated", async () => {
    const { sql, clock, alarm, config } = await drawnRoom()
    const revivedConnector = new ScriptedConnector()
    const revived = new GiveawayRoom({
      sql,
      alarm,
      live: { broadcast: () => {}, broadcastViewers: () => {} },
      clock,
      random,
      config,
      chat: { connector: revivedConnector, subscribe: new Subscriptions().subscribe },
    })

    revived.onAlarm()

    expect(revivedConnector.sockets).toHaveLength(1)
  })

  it("closes the watch on request without recording a failure", async () => {
    const { room, connector } = await drawnRoom()

    room.closeChat()

    expect(connector.sockets[0]?.closed).toBe(true)
    expect(room.liveSnapshot()).toMatchObject({ eventSubFailures: 0, chatClaimUnavailable: false })
  })
})

describe("chat claim unavailable", () => {
  it("shows the failure, counts it once and keeps manual claims working", async () => {
    const { room, connector, subscriptions, winner } = await drawnRoom()
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const refusal = new Error("subscription refused")
    subscriptions.refusal = refusal

    connector.sockets[0]?.receive(welcome("session-1"))
    await flush()

    expect(room.liveSnapshot()).toMatchObject({ chatClaimUnavailable: true, eventSubFailures: 1 })
    expect(warn).toHaveBeenCalledWith("room failure", {
      giveawayId: "g1",
      kind: "eventsub",
      error: refusal,
    })
    expect(room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")).toEqual({
      kind: "claimed",
    })
  })

  it("tells the viewers' pages that a chat message no longer claims", async () => {
    const { connector, subscriptions, viewerMessages } = await drawnRoom()
    spyOn(console, "warn").mockImplementation(() => {})
    subscriptions.refusal = new Error("subscription refused")
    const before = viewerMessages.length

    connector.sockets[0]?.receive(welcome("session-1"))
    await flush()

    expect(viewerMessages).toHaveLength(before + 1)
    expect(JSON.parse(viewerMessages.at(-1) ?? "")).toMatchObject({ chatClaimAvailable: false })
  })

  it("is reported after the reconnects in a row passed the cap, once", async () => {
    const { room, clock, connector } = await drawnRoom({
      env: { EVENTSUB_RECONNECT_MAX_ATTEMPTS: "1" },
    })
    spyOn(console, "warn").mockImplementation(() => {})

    connector.sockets[0]?.fail(new Error("refused"))
    clock.advance(2000)
    room.onAlarm()
    connector.sockets[1]?.fail(new Error("refused"))

    expect(connector.sockets).toHaveLength(2)
    expect(room.liveSnapshot()).toMatchObject({ chatClaimUnavailable: true, eventSubFailures: 1 })
  })

  it("a reroll clears it and opens a fresh watch with a fresh attempt budget", async () => {
    const { room, clock, connector } = await drawnRoom({
      env: { EVENTSUB_RECONNECT_MAX_ATTEMPTS: "1" },
    })
    spyOn(console, "warn").mockImplementation(() => {})
    connector.sockets[0]?.fail(new Error("refused"))
    clock.advance(2000)
    room.onAlarm()
    connector.sockets[1]?.fail(new Error("refused"))
    expect(room.liveSnapshot().chatClaimUnavailable).toBe(true)

    await room.reroll(0)
    connector.sockets[2]?.fail(new Error("refused"))

    expect(connector.sockets).toHaveLength(3)
    expect(room.liveSnapshot()).toMatchObject({ chatClaimUnavailable: false, eventSubFailures: 1 })
  })

  it("claims through the fresh watch after a reroll", async () => {
    const { room, connector, subscriptions } = await drawnRoom()
    spyOn(console, "warn").mockImplementation(() => {})
    subscriptions.refusal = new Error("refused")
    connector.sockets[0]?.receive(welcome("session-1"))
    await flush()
    subscriptions.refusal = null

    await room.reroll(0)
    connector.sockets[1]?.receive(welcome("session-2"))
    await flush()
    const next = room.picks()[1]?.platformUserId ?? ""
    connector.sockets[1]?.receive(chat(next, "here"))

    expect(room.liveSnapshot().winners[1]?.claim).toEqual({ state: "claimed", via: "chat" })
  })

  it("counts a revoked subscription as an EventSub failure", async () => {
    const { room, socket } = await connectedRoom()
    spyOn(console, "warn").mockImplementation(() => {})

    socket?.receive(revocation)

    expect(room.liveSnapshot()).toMatchObject({ chatClaimUnavailable: true, eventSubFailures: 1 })
  })
})

describe("chat claim queries", () => {
  it("finds the pick of a chatter through the unique entrant index", async () => {
    const { db, winner } = await drawnRoom()

    const details = plan(db, waitingPickOfChatterSql, [winner, 0])

    expect(details.some((detail) => detail.includes("USING INDEX draws_by_entrant"))).toBe(true)
  })

  it("finds the soonest claim deadline through the waiting-picks index", async () => {
    const { db } = await drawnRoom()

    const details = plan(db, nextClaimDeadlineSql, [0])

    expect(details.some((detail) => detail.includes("INDEX draws_waiting"))).toBe(true)
  })
})
