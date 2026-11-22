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
import { FakeBeacon } from "../../test/fake-beacon.ts"
import {
  ChatConnectionLost,
  ChatWatcher,
  eventSubChat,
  type ChatWatcherConfig,
} from "./chat-watcher.ts"
import type { ChatMessage } from "../platform/chat-source.ts"
import { GiveawayRoom, type GiveawayInit, type RoomViewer } from "../room/giveaway-room.ts"
import { applyMigrations } from "../room/migrate.ts"
import { roomMigrations } from "../room/migrations.ts"
import {
  nextClaimDeadlineSql,
  waitingPickOfChatterSql,
  winnerChatNameSql,
} from "../room/queries.ts"

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
  writes = 0
  set(at: Instant): void {
    this.writes += 1
    this.at = at
  }
  clear(): void {
    this.writes += 1
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
    payload: {
      event: {
        chatter_user_id: chatterUserId,
        chatter_user_login: `user_${chatterUserId}`,
        chatter_user_name: `User_${chatterUserId}`,
        message: { text },
        badges: [{ set_id: "subscriber", id: "3", info: "4" }],
      },
    },
  }
}

/** What the watcher hands on for {@link chat}. */
function chatMessage(platformUserId: string, text: string): ChatMessage {
  return {
    platformUserId,
    login: `user_${platformUserId}`,
    displayName: `User_${platformUserId}`,
    text,
    badges: [{ setId: "subscriber", id: "3" }],
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
    expect(messages).toEqual([chatMessage("42", "!claim")])
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

  it("treats a chat notification without the chatter's login or with a badge of another shape as malformed", async () => {
    const message = chat("42", "!claim")
    const { event } = message.payload
    const faults = [
      { ...event, chatter_user_login: undefined },
      { ...event, chatter_user_name: 7 },
      { ...event, badges: [{ set_id: "vip" }] },
      { ...event, badges: undefined },
    ]
    for (const fault of faults) {
      const { connector, messages } = await liveWatcher()
      const [socket] = connector.sockets

      socket?.receive({ ...message, payload: { event: fault } })

      expect(socket?.closed).toBe(true)
      expect(messages).toEqual([])
    }
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
    expect(messages).toEqual([chatMessage("42", "!claim")])
  })

  it("keeps listening on the old socket until the new one is welcomed", async () => {
    const { connector, messages } = await liveWatcher()
    const [old] = connector.sockets

    old?.receive(reconnect("wss://twitch.test/ws?reconnect=1"))
    old?.receive(chat("42", "before the switch"))

    expect(messages).toEqual([chatMessage("42", "before the switch")])
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
    expect(messages).toEqual([chatMessage("42", "!claim")])
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
    profileImageUrl: null,
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
    winnerCount: 1,
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
  const liveMessages: string[] = []
  const overlayMessages: string[] = []
  const room = new GiveawayRoom({
    sql,
    alarm,
    live: {
      broadcast: (json) => void liveMessages.push(json),
      broadcastOverlay: (json) => void overlayMessages.push(json),
      broadcastViewers: (json) => void viewerMessages.push(json),
    },
    clock,
    random,
    config,
    chat: (_platform, listener) => eventSubChat({ ...chatLink, clock, config })(listener),
    beacon: new FakeBeacon(),
  })
  room.init(roomInit(options.claimKeyword ?? null))
  return {
    db,
    sql,
    room,
    clock,
    alarm,
    connector,
    subscriptions,
    config,
    chatLink,
    viewerMessages,
    liveMessages,
    overlayMessages,
  }
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
  await context.room.commit()
  context.clock.advance(1)
  await context.room.draw()
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
    const { room, socket, winner, subscriptions, clock } = await connectedRoom()

    socket?.receive(chat(winner, "here I am"))

    expect(subscriptions.sessions).toEqual(["session-1"])
    expect(room.liveSnapshot().winners[0]?.claim).toEqual({
      state: "claimed",
      via: "chat",
      at: clock.now(),
    })
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
    const { room, socket, winner, clock } = await connectedRoom({ claimKeyword: " !Claim " })

    socket?.receive(chat(winner, "  well !CLAIM it  "))

    expect(room.liveSnapshot().winners[0]?.claim).toEqual({
      state: "claimed",
      via: "chat",
      at: clock.now(),
    })
  })

  it("does not let the chat overwrite a claim that was already made", async () => {
    const { room, socket, winner, clock } = await connectedRoom()
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")
    const claimedAt = clock.now()
    clock.advance(1)

    socket?.receive(chat(winner, "claim"))

    expect(room.liveSnapshot().winners[0]?.claim).toEqual({
      state: "claimed",
      via: "manual",
      at: claimedAt,
    })
  })
})

describe("chat watch lifetime", () => {
  it("opens when the draw leaves a winner waiting and stays open after the winner claimed", async () => {
    const { room, connector, winner } = await drawnRoom()
    expect(connector.sockets.map((socket) => socket.closed)).toEqual([false])

    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")

    expect(connector.sockets.map((socket) => socket.closed)).toEqual([false])
  })

  it("closes at the end of the reroll window after the last claim time, not before", async () => {
    const { room, clock, connector, drawnAt, winner } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "100000", REROLL_WINDOW_SECONDS: "10" },
    })
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")

    clock.advance(drawnAt + 310_000 - clock.now())
    room.onAlarm()
    expect(connector.sockets[0]?.closed).toBe(false)

    clock.advance(1)
    room.onAlarm()
    expect(connector.sockets[0]?.closed).toBe(true)
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

  it("keeps its socket for the new winner a reroll gives after the claim time of the old one ended", async () => {
    const { room, clock, connector } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "1000" },
    })
    clock.advance(300_001)
    room.onAlarm()
    expect(connector.sockets.map((socket) => socket.closed)).toEqual([false])

    await room.reroll(0)

    expect(connector.sockets.map((socket) => socket.closed)).toEqual([false])
  })

  it("keeps watching when the claim time is over and closes when the reroll window ends", async () => {
    const { room, clock, connector, drawnAt } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "100000", REROLL_WINDOW_SECONDS: "10" },
    })

    clock.advance(drawnAt + 310_000 - clock.now())
    room.onAlarm()
    expect(connector.sockets[0]?.closed).toBe(false)

    clock.advance(1)
    room.onAlarm()
    expect(connector.sockets[0]?.closed).toBe(true)
  })

  it("wakes the room one past the end of the reroll window when nothing else is due", async () => {
    const { room, clock, alarm, drawnAt } = await drawnRoom({
      env: {
        EVENTSUB_SUBSCRIBE_SECONDS: "100000",
        MIRROR_RETRY_SECONDS: "100000",
        REROLL_WINDOW_SECONDS: "10",
      },
    })
    clock.advance(drawnAt + 300_001 - clock.now())
    room.onAlarm()

    expect(alarm.at).toBe(drawnAt + 310_001)
  })

  it("wakes the room one past the claim time when nothing else is due", async () => {
    // The status mirror and the subscribe window would wake the room sooner.
    const { room, sql, alarm, drawnAt } = await drawnRoom({
      env: { EVENTSUB_SUBSCRIBE_SECONDS: "1000", MIRROR_RETRY_SECONDS: "100000" },
    })
    // The minute of the entries would wake the room too, so it counts as reported.
    sql.exec("UPDATE room_state SET metrics_reported_until = 60000 WHERE id = 1", [])
    room.armAlarm()

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
      live: { broadcast: () => {}, broadcastOverlay: () => {}, broadcastViewers: () => {} },
      clock,
      random,
      config,
      chat: (_platform, listener) =>
        eventSubChat({
          connector: revivedConnector,
          subscribe: new Subscriptions().subscribe,
          clock,
          config,
        })(listener),
      beacon: new FakeBeacon(),
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
    const { room, connector, subscriptions, clock } = await drawnRoom()
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

    expect(room.liveSnapshot().winners[1]?.claim).toEqual({
      state: "claimed",
      via: "chat",
      at: clock.now(),
    })
  })

  it("counts a revoked subscription as an EventSub failure", async () => {
    const { room, socket } = await connectedRoom()
    spyOn(console, "warn").mockImplementation(() => {})

    socket?.receive(revocation)

    expect(room.liveSnapshot()).toMatchObject({ chatClaimUnavailable: true, eventSubFailures: 1 })
  })
})

describe("winner chat", () => {
  const longLived = {
    EVENTSUB_KEEPALIVE_GRACE_SECONDS: "100000",
    EVENTSUB_CONNECTION_MAX_SECONDS: "100000",
  }

  it("shows the waiting winner's message under the name of their entry", async () => {
    const { room, socket, winner, clock } = await connectedRoom({ claimKeyword: "!claim" })

    socket?.receive(chat(winner, "hello chat"))

    expect(room.liveSnapshot().winnerChat).toEqual([
      { id: 1, name: `Name${winner}`, text: "hello chat", at: clock.now() },
    ])
  })

  it("shows a message of a winner who already claimed", async () => {
    const { room, socket, winner } = await connectedRoom()
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")

    socket?.receive(chat(winner, "thanks"))

    expect(room.liveSnapshot().winnerChat.map((line) => line.text)).toEqual(["thanks"])
  })

  it("keeps showing and pushing a winner's lines after a claim on the giveaway page, without touching the claim", async () => {
    const { room, socket, winner, liveMessages, clock } = await connectedRoom()
    room.claim(0, { platform: "twitch", platformUserId: winner }, "rafflink")
    const claimedAt = clock.now()
    clock.advance(1_000)
    const pushed = liveMessages.length

    socket?.receive(chat(winner, "got it, thanks"))

    expect(room.liveSnapshot()).toMatchObject({
      winners: [{ claim: { state: "claimed", via: "rafflink", at: claimedAt } }],
      winnerChat: [{ text: "got it, thanks" }],
    })
    expect(liveMessages).toHaveLength(pushed + 1)
    expect(liveMessages.at(-1)).toContain("got it, thanks")
  })

  it("drops the message of a chatter who holds no pick", async () => {
    const { room, socket, loser } = await connectedRoom()

    socket?.receive(chat(loser, "hi"))
    socket?.receive(chat("999", "hi"))

    expect(room.liveSnapshot().winnerChat).toEqual([])
  })

  it("keeps the newest max messages when max + 1 arrive, newest last", async () => {
    const { room, socket, winner } = await connectedRoom({
      claimKeyword: "!claim",
      env: { LIVE_WINNER_CHAT_MAX: "2" },
    })

    for (const text of ["one", "two", "three"]) socket?.receive(chat(winner, text))

    expect(room.liveSnapshot().winnerChat.map((line) => line.text)).toEqual(["two", "three"])
  })

  it("numbers the lines in arrival order, past the cap and past a reroll", async () => {
    const { room, socket, winner } = await connectedRoom({
      claimKeyword: "!claim",
      env: { LIVE_WINNER_CHAT_MAX: "2" },
    })

    for (const text of ["one", "two", "three"]) socket?.receive(chat(winner, text))
    expect(room.liveSnapshot().winnerChat.map((line) => line.id)).toEqual([2, 3])

    await room.reroll(0)
    socket?.receive(chat(room.picks()[1]?.platformUserId ?? "", "four"))

    expect(room.liveSnapshot().winnerChat.map((line) => line.id)).toEqual([4])
  })

  it("stops the rerolled chatter and shows the new winner", async () => {
    const { room, socket, winner } = await connectedRoom({ claimKeyword: "!claim" })
    await room.reroll(0)
    const next = room.picks()[1]?.platformUserId ?? ""

    socket?.receive(chat(winner, "still here"))
    socket?.receive(chat(next, "my turn"))

    expect(next).not.toBe(winner)
    expect(room.liveSnapshot().winnerChat.map((line) => line.text)).toEqual(["my turn"])
  })

  it("keeps the messages after the claim time ended and still claims nothing", async () => {
    const { room, socket, winner, clock } = await connectedRoom({ env: longLived })
    clock.advance(300_001)

    socket?.receive(chat(winner, "too late"))

    expect(room.liveSnapshot()).toMatchObject({
      winners: [{ claim: { state: "expired" } }],
      winnerChat: [{ text: "too late" }],
    })
  })

  it("forgets the messages when the watch closes at the end of the reroll window", async () => {
    const { room, socket, winner, clock, drawnAt, connector } = await connectedRoom({
      env: { ...longLived, REROLL_WINDOW_SECONDS: "10" },
    })
    socket?.receive(chat(winner, "gone soon"))
    expect(room.liveSnapshot().winnerChat).toHaveLength(1)

    clock.advance(drawnAt + 310_001 - clock.now())
    room.onAlarm()

    expect(connector.sockets[0]?.closed).toBe(true)
    expect(room.liveSnapshot().winnerChat).toEqual([])
  })

  it("delivers a chat push held back by the throttle when the interval is over", async () => {
    const { room, socket, winner, liveMessages, alarm, clock } = await connectedRoom({
      claimKeyword: "!claim",
      env: { LIVE_INTERVAL_MS: "1000" },
    })
    clock.advance(1_000)
    room.onAlarm()
    socket?.receive(chat(winner, "first line"))
    const firstPushAt = clock.now()
    clock.advance(10)
    socket?.receive(chat(winner, "second line"))
    const pushed = liveMessages.length

    expect(alarm.at).not.toBeNull()
    expect(alarm.at ?? Infinity).toBeLessThanOrEqual(firstPushAt + 1_000)
    clock.advance(firstPushAt + 1_000 - clock.now())
    room.onAlarm()

    expect(liveMessages).toHaveLength(pushed + 1)
    expect(liveMessages.at(-1)).toContain("second line")
  })

  it("does not rearm the alarm for a chat push that went out at once", async () => {
    const { socket, winner, alarm, clock } = await connectedRoom({ claimKeyword: "!claim" })
    clock.advance(1_000)
    const writes = alarm.writes

    socket?.receive(chat(winner, "no throttle"))

    expect(alarm.writes).toBe(writes)
  })

  it("drops the lines of a rerolled pick and pushes the live page", async () => {
    const { room, socket, winner, liveMessages, clock } = await connectedRoom({
      claimKeyword: "!claim",
    })
    socket?.receive(chat(winner, "old winner line"))
    clock.advance(1)

    await room.reroll(0)

    expect(room.liveSnapshot().winnerChat).toEqual([])
    expect(liveMessages.at(-1)).not.toContain("old winner line")
  })

  it("closes the chat watch and forgets the lines once the giveaway is finished", async () => {
    const { room, socket, winner, clock, drawnAt, connector } = await connectedRoom({
      env: { ...longLived, REROLL_WINDOW_SECONDS: "10" },
    })
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")
    socket?.receive(chat(winner, "thanks"))
    clock.advance(drawnAt + 310_001 - clock.now())
    room.onAlarm()

    expect(room.summary().finished).toBe(true)
    expect(connector.sockets[0]?.closed).toBe(true)
    expect(room.liveSnapshot().winnerChat).toEqual([])
  })

  it("reports the watch as open while it runs and pushes when it ends with every pick claimed", async () => {
    const { room, winner, clock, drawnAt, liveMessages } = await connectedRoom({
      env: { ...longLived, REROLL_WINDOW_SECONDS: "10" },
    })
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")
    expect(room.liveSnapshot()).toMatchObject({ winnerChatOpen: true, rerollBlocked: null })
    const pushed = liveMessages.length

    clock.advance(drawnAt + 310_001 - clock.now())
    room.onAlarm()

    expect(room.liveSnapshot()).toMatchObject({ winnerChatOpen: false, rerollBlocked: null })
    expect(liveMessages).toHaveLength(pushed + 1)
    expect(liveMessages.at(-1)).toContain('"winnerChatOpen":false')
  })

  it("reports the watch as closed once the chat watch gave up", async () => {
    const { room, socket } = await connectedRoom()
    spyOn(console, "warn").mockImplementation(() => {})

    socket?.receive(revocation)

    expect(room.liveSnapshot()).toMatchObject({ chatClaimUnavailable: true, winnerChatOpen: false })
  })

  it("pushes the live page when a winner writes, and the overlay push has no chat", async () => {
    const { socket, winner, liveMessages, overlayMessages, clock } = await connectedRoom({
      claimKeyword: "!claim",
    })
    clock.advance(1_000)
    const pushed = liveMessages.length

    socket?.receive(chat(winner, "push me"))

    expect(liveMessages).toHaveLength(pushed + 1)
    expect(liveMessages.at(-1)).toContain("push me")
    expect(overlayMessages.at(-1)).toContain("entrantsAfter")
    expect(overlayMessages.at(-1)).not.toContain("push me")
    expect(overlayMessages.at(-1)).not.toContain("winnerChat")
  })

  it("writes nothing to the room database for a message of a waiting winner", async () => {
    const { db, socket, winner } = await connectedRoom({ claimKeyword: "!claim" })
    const before = dump(db)

    socket?.receive(chat(winner, "hello"))

    expect(dump(db)).toBe(before)
  })

  it("writes nothing to the room database for a message of a claimed winner", async () => {
    const { db, room, socket, winner } = await connectedRoom()
    room.claim(0, { platform: "twitch", platformUserId: winner }, "manual")
    const before = dump(db)

    socket?.receive(chat(winner, "hello"))

    expect(dump(db)).toBe(before)
  })

  it("logs no message text", async () => {
    const { socket, winner, loser } = await connectedRoom({ claimKeyword: "!claim" })
    const logged = (["warn", "info", "log", "error"] as const).map((method) =>
      spyOn(console, method).mockImplementation(() => {}),
    )
    const secret = "SECRET-WINNER-LINE-31337"

    socket?.receive(chat(winner, secret))
    socket?.receive(chat(loser, secret))

    expect(JSON.stringify(logged.map((spy) => spy.mock.calls))).not.toContain(secret)
  })
})

describe("chat claim queries", () => {
  it("finds the name of a picked chatter through the unique entrant index", async () => {
    const { db, winner } = await drawnRoom()

    const details = plan(db, winnerChatNameSql, [winner])

    expect(details.some((detail) => detail.includes("USING INDEX draws_by_entrant"))).toBe(true)
  })

  it("finds the pick of a chatter through the unique entrant index", async () => {
    const { db, winner } = await drawnRoom()

    const details = plan(db, waitingPickOfChatterSql, [winner, 0])

    expect(details.some((detail) => detail.includes("USING INDEX draws_by_entrant"))).toBe(true)
  })

  it("finds the soonest claim deadline through the index of standing picks", async () => {
    const { db } = await drawnRoom()

    const details = plan(db, nextClaimDeadlineSql, [0])

    expect(details.some((detail) => detail.includes("INDEX draws_standing"))).toBe(true)
  })
})
