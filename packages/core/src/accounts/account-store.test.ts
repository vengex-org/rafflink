import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { accountsSchema, explainPlan, sqlRows, validRules } from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import type { SqlValue } from "../ports.ts"
import { RoomRowError } from "../room/rows.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import {
  AccountStore,
  type NewGiveaway,
  type StreamerRecord,
  type StreamerSignIn,
} from "./account-store.ts"
import {
  giveawayByCodeSql,
  giveawayByIdSql,
  giveawaysOfStreamerSql,
  ownedGiveawaySql,
  streamerByIdSql,
  streamerByPlatformUserSql,
  unarmedRetentionSql,
} from "./queries.ts"

const config = resolveConfig({
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "s",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
})

function setup() {
  const db = new Database(":memory:")
  db.exec(accountsSchema)
  return { db, store: new AccountStore(new BunSqliteAsyncSql(db), config) }
}

function signIn(overrides: Partial<StreamerSignIn> = {}): StreamerSignIn {
  return {
    id: "s1",
    platform: "twitch",
    platformUserId: "200",
    login: "streamer",
    displayName: "Streamer",
    sealedRefreshToken: "sealed-1",
    scopes: "openid",
    now: 1000,
    ...overrides,
  }
}

function giveaway(overrides: Partial<NewGiveaway> = {}): NewGiveaway {
  return {
    id: "g1",
    code: "ABCDE",
    streamerId: "s1",
    title: "Title",
    prize: "Prize",
    rules: { ...validRules },
    closesAt: null,
    claimSeconds: 300,
    winnerCount: 1,
    overlayToken: "overlay-1",
    createdAt: 5000,
    ...overrides,
  }
}

async function withStreamers() {
  const context = setup()
  await context.store.signInStreamer(signIn())
  await context.store.signInStreamer(signIn({ id: "s2", platformUserId: "201", login: "other" }))
  return context
}

describe("AccountStore streamers", () => {
  it("creates the streamer and their sealed token", async () => {
    const { db, store } = setup()

    const streamer = await store.signInStreamer(signIn())

    expect(streamer).toEqual<StreamerRecord>({
      id: "s1",
      platform: "twitch",
      platformUserId: "200",
      login: "streamer",
      displayName: "Streamer",
    })
    expect(
      sqlRows(db, "SELECT streamer_id, refresh_token_enc, scopes FROM streamer_tokens"),
    ).toEqual([{ streamer_id: "s1", refresh_token_enc: "sealed-1", scopes: "openid" }])
  })

  it("finds a streamer by id and nothing for an unknown id", async () => {
    const { store } = await withStreamers()

    expect(await store.findStreamer("s2")).toEqual<StreamerRecord>({
      id: "s2",
      platform: "twitch",
      platformUserId: "201",
      login: "other",
      displayName: "Streamer",
    })
    expect(await store.findStreamer("missing")).toBeNull()
  })

  it("keeps the id, updates the login and display name and replaces the token on a second sign-in", async () => {
    const { db, store } = setup()
    await store.signInStreamer(signIn())

    const again = await store.signInStreamer(
      signIn({
        id: "other",
        login: "renamed",
        displayName: "Renamed",
        sealedRefreshToken: "sealed-2",
        now: 2000,
      }),
    )

    expect(again).toMatchObject({ id: "s1", login: "renamed", displayName: "Renamed" })
    expect(sqlRows(db, "SELECT refresh_token_enc, validated_at FROM streamer_tokens")).toEqual([
      { refresh_token_enc: "sealed-2", validated_at: 2000 },
    ])
  })

  it("keeps the streamers of two platforms with the same user id apart", async () => {
    const { db, store } = setup()
    await store.signInStreamer(signIn())
    await store.signInStreamer(signIn({ id: "s2", platform: "kick" }))

    expect(sqlRows(db, "SELECT id FROM streamers ORDER BY id")).toHaveLength(2)
  })
})

describe("AccountStore streamer tokens", () => {
  it("lists every token with the identity it is sealed to, in streamer id order", async () => {
    const { store } = await withStreamers()
    await store.signInStreamer(signIn({ id: "s0", platformUserId: "199", login: "first" }))

    expect(await store.listStreamerTokens()).toEqual([
      {
        streamerId: "s0",
        platform: "twitch",
        platformUserId: "199",
        sealedRefreshToken: "sealed-1",
      },
      {
        streamerId: "s1",
        platform: "twitch",
        platformUserId: "200",
        sealedRefreshToken: "sealed-1",
      },
      {
        streamerId: "s2",
        platform: "twitch",
        platformUserId: "201",
        sealedRefreshToken: "sealed-1",
      },
    ])
  })

  it("lists nothing when no streamer signed in", async () => {
    expect(await setup().store.listStreamerTokens()).toEqual([])
  })

  it("finds the token of one streamer and nothing for an unknown id", async () => {
    const { store } = await withStreamers()

    expect(await store.findStreamerToken("s2")).toMatchObject({ platformUserId: "201" })
    expect(await store.findStreamerToken("missing")).toBeNull()
  })

  it("replaces the sealed token and the validation time of one streamer only", async () => {
    const { db, store } = await withStreamers()

    await store.replaceStreamerToken("s1", "sealed-new", 9000)

    expect(
      sqlRows(
        db,
        "SELECT streamer_id, refresh_token_enc, validated_at FROM streamer_tokens ORDER BY streamer_id",
      ),
    ).toEqual([
      { streamer_id: "s1", refresh_token_enc: "sealed-new", validated_at: 9000 },
      { streamer_id: "s2", refresh_token_enc: "sealed-1", validated_at: 1000 },
    ])
  })

  it("deletes the token of one streamer and keeps the streamer and the other token", async () => {
    const { db, store } = await withStreamers()

    await store.deleteStreamerToken("s1")

    expect(sqlRows(db, "SELECT streamer_id FROM streamer_tokens")).toEqual([{ streamer_id: "s2" }])
    expect(sqlRows(db, "SELECT id FROM streamers ORDER BY id")).toHaveLength(2)
  })
})

describe("AccountStore giveaways", () => {
  it("reads back what was inserted with the broadcaster id, the streamer's name and an open status", async () => {
    const { store } = await withStreamers()

    expect(await store.insertGiveaway(giveaway())).toBe("inserted")

    expect(await store.findGiveawayByCode("ABCDE")).toEqual({
      ...giveaway(),
      platform: "twitch",
      broadcasterId: "200",
      streamerName: "Streamer",
      status: "open",
    })
  })

  it("reports a taken code and writes nothing", async () => {
    const { db, store } = await withStreamers()
    await store.insertGiveaway(giveaway())

    expect(await store.insertGiveaway(giveaway({ id: "g2", title: "Other" }))).toBe("code-taken")

    expect(sqlRows(db, "SELECT title FROM giveaways")).toEqual([{ title: "Title" }])
  })

  it("finds a giveaway of its owner and nothing for another streamer", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway())

    expect(await store.findOwnedGiveaway("s1", "g1")).toMatchObject({ id: "g1" })
    expect(await store.findOwnedGiveaway("s2", "g1")).toBeNull()
  })

  it("finds nothing for an unknown code or id", async () => {
    const { store } = await withStreamers()

    expect(await store.findGiveawayByCode("ZZZZZ")).toBeNull()
    expect(await store.findGiveawayById("nope")).toBeNull()
  })

  it("lists the newest first and only the streamer's own", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 3 }))
    await store.insertGiveaway(
      giveaway({ id: "g3", code: "CCCCC", createdAt: 2, streamerId: "s2" }),
    )
    await store.insertGiveaway(giveaway({ id: "g4", code: "DDDDD", createdAt: 3 }))

    const list = await store.listGiveaways("s1")

    expect(list.map((item) => item.id)).toEqual(["g4", "g2", "g1"])
  })

  it("mirrors a status and is idempotent", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway())

    await store.setStatus("g1", "closed")
    await store.setStatus("g1", "closed")

    expect(await store.findGiveawayById("g1")).toMatchObject({ status: "closed" })
  })

  it("lists closed giveaways whose retention was not armed, oldest first, and no more than the limit", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 3 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g3", code: "CCCCC", createdAt: 2 }))
    await store.insertGiveaway(giveaway({ id: "g4", code: "DDDDD", createdAt: 0 }))
    await store.setStatus("g1", "closed")
    await store.setStatus("g2", "drawn")
    await store.setStatus("g3", "closed")

    expect(await store.listUnarmedRetention(10, 5)).toEqual(["g2", "g3", "g1"])
    expect(await store.listUnarmedRetention(2, 5)).toEqual(["g2", "g3"])
  })

  it("stops listing a giveaway once its retention is marked armed, and marking twice changes nothing", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 2 }))
    await store.setStatus("g1", "closed")
    await store.setStatus("g2", "closed")

    await store.markRetentionArmed("g1")
    await store.markRetentionArmed("g1")

    expect(await store.listUnarmedRetention(10, 5)).toEqual(["g2"])
  })

  it("lists giveaways with fewer failed sweeps first and leaves out those at the maximum", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 2 }))
    await store.insertGiveaway(giveaway({ id: "g3", code: "CCCCC", createdAt: 3 }))
    for (const id of ["g1", "g2", "g3"]) await store.setStatus(id, "closed")

    expect(await store.recordRetentionFailure("g1")).toBe(1)
    expect(await store.recordRetentionFailure("g1")).toBe(2)
    expect(await store.recordRetentionFailure("g2")).toBe(1)

    expect(await store.listUnarmedRetention(10, 5)).toEqual(["g3", "g2", "g1"])
    expect(await store.listUnarmedRetention(10, 2)).toEqual(["g3", "g2"])
  })

  it("lists the unarmed giveaways through the partial index without a sort", () => {
    const { db } = setup()

    const details = explainPlan(db, unarmedRetentionSql, [5, 10])

    expect(details.join("\n")).toContain("giveaways_retention_unarmed")
    expect(details.some((detail) => detail.includes("TEMP B-TREE"))).toBe(false)
  })

  it("refuses to store a status outside the CHECK", async () => {
    const { db } = await withStreamers()

    await expect(
      new BunSqliteAsyncSql(db).run(
        "INSERT INTO giveaways (id, code, streamer_id, title, prize, rules_json, status, claim_seconds, overlay_token, created_at) VALUES ('x', 'XXXXX', 's1', 't', 'p', '{}', 'bogus', 1, 'o', 1)",
        [],
      ),
    ).rejects.toThrow()
  })

  it("fails loudly on a stored rules_json that is not valid rules", async () => {
    const { db, store } = await withStreamers()
    await store.insertGiveaway(giveaway())
    db.run("UPDATE giveaways SET rules_json = '{\"tickets\":1}'")

    await expect(store.findGiveawayById("g1")).rejects.toBeInstanceOf(RoomRowError)
  })

  it("fails loudly on a stored rules_json that is not JSON", async () => {
    const { db, store } = await withStreamers()
    await store.insertGiveaway(giveaway())
    db.run("UPDATE giveaways SET rules_json = 'not json'")

    await expect(store.findGiveawayById("g1")).rejects.toBeInstanceOf(RoomRowError)
  })
})

describe("account queries", () => {
  const cases: readonly [string, string, readonly SqlValue[]][] = [
    ["a giveaway by code", giveawayByCodeSql, ["ABCDE"]],
    ["a giveaway by id", giveawayByIdSql, ["g1"]],
    ["an owned giveaway", ownedGiveawaySql, ["g1", "s1"]],
    ["a streamer's giveaways", giveawaysOfStreamerSql, ["s1"]],
    ["a streamer by platform user", streamerByPlatformUserSql, ["twitch", "200"]],
    ["a streamer by id", streamerByIdSql, ["s1"]],
  ]

  for (const [name, statement, params] of cases) {
    it(`reads ${name} through an index without a scan or a sort`, () => {
      const { db } = setup()

      const details = explainPlan(db, statement, params)

      expect(
        details.some((detail) => detail.startsWith("SCAN") || detail.includes("TEMP B-TREE")),
      ).toBe(false)
      expect(
        details.some((detail) => detail.includes("INDEX") || detail.includes("PRIMARY KEY")),
      ).toBe(true)
    })
  }

  it("lists a streamer's giveaways through the streamer index", () => {
    const { db } = setup()

    expect(explainPlan(db, giveawaysOfStreamerSql, ["s1"]).join("\n")).toContain(
      "giveaways_by_streamer",
    )
  })
})
