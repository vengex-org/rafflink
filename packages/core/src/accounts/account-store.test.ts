import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { accountsSchema, explainPlan, sqlRows, validRules } from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import { defaultOverlayTheme, type OverlayTheme } from "../domain/overlay-theme.ts"
import type { SqlValue } from "../ports.ts"
import { currentPlan } from "../plan/current-plan.ts"
import { RoomRowError } from "../room/rows.ts"
import { BunSqliteAsyncSql } from "../sqlite-bun.ts"
import {
  AccountStore,
  type NewGiveaway,
  type StreamerRecord,
  type StreamerSignIn,
} from "./account-store.ts"
import {
  approvedStreamersSql,
  giveawayByCodeSql,
  giveawayByIdSql,
  giveawaysOfStreamerSql,
  ownedGiveawaySql,
  pendingStreamersSql,
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
    profileImageUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/streamer.png",
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
      profileImageUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/streamer.png",
      createdAt: 1000,
      approvedAt: null,
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
      profileImageUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/streamer.png",
      createdAt: 1000,
      approvedAt: null,
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

  it("replaces the profile picture on a second sign-in, also with none", async () => {
    const { store } = setup()
    await store.signInStreamer(signIn())

    const changed = await store.signInStreamer(
      signIn({ profileImageUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/new.png" }),
    )
    const removed = await store.signInStreamer(signIn({ profileImageUrl: null }))

    expect(changed.profileImageUrl).toBe("https://static-cdn.jtvnw.net/jtv_user_pictures/new.png")
    expect(removed.profileImageUrl).toBeNull()
  })

  it("keeps the streamers of two platforms with the same user id apart", async () => {
    const { db, store } = setup()
    await store.signInStreamer(signIn())
    await store.signInStreamer(signIn({ id: "s2", platform: "kick" }))

    expect(sqlRows(db, "SELECT id FROM streamers ORDER BY id")).toHaveLength(2)
  })
})

describe("AccountStore streamer access", () => {
  it("lists new streamers as pending, newest first, and approved ones latest approval first", async () => {
    const { store } = setup()
    await store.signInStreamer(signIn({ id: "s1", platformUserId: "1", now: 1000 }))
    await store.signInStreamer(signIn({ id: "s2", platformUserId: "2", now: 2000 }))
    await store.signInStreamer(signIn({ id: "s3", platformUserId: "3", now: 3000 }))
    await store.approveStreamer("s1", "admin", 5000)
    await store.approveStreamer("s3", "admin", 6000)

    const access = await store.listStreamerAccess(10)

    expect(access.pending.map((streamer) => streamer.id)).toEqual(["s2"])
    expect(access.approved.map((streamer) => [streamer.id, streamer.approvedAt])).toEqual([
      ["s3", 6000],
      ["s1", 5000],
    ])
  })

  it("cuts each list to the limit", async () => {
    const { store } = setup()
    for (const id of ["a", "b", "c"]) {
      await store.signInStreamer(signIn({ id, platformUserId: id, now: id.charCodeAt(0) }))
    }
    await store.approveStreamer("a", "admin", 1)
    await store.approveStreamer("b", "admin", 2)

    const access = await store.listStreamerAccess(1)

    expect(access.approved.map((streamer) => streamer.id)).toEqual(["b"])
    expect(access.pending.map((streamer) => streamer.id)).toEqual(["c"])
  })

  it("keeps the first approval when approving again", async () => {
    const { db, store } = await withStreamers()

    expect(await store.approveStreamer("s1", "admin-1", 5000)).toBe(true)
    expect(await store.approveStreamer("s1", "admin-2", 9000)).toBe(true)

    expect(sqlRows(db, "SELECT approved_at, approved_by FROM streamers WHERE id = 's1'")).toEqual([
      { approved_at: 5000, approved_by: "admin-1" },
    ])
    expect((await store.findStreamer("s1"))?.approvedAt).toBe(5000)
  })

  it("revokes an approval and clears who gave it", async () => {
    const { db, store } = await withStreamers()
    await store.approveStreamer("s1", "admin-1", 5000)

    expect(await store.revokeStreamer("s1")).toBe(true)
    expect(await store.revokeStreamer("s1")).toBe(true)

    expect(sqlRows(db, "SELECT approved_at, approved_by FROM streamers WHERE id = 's1'")).toEqual([
      { approved_at: null, approved_by: null },
    ])
  })

  it("reports an unknown streamer instead of approving or revoking it", async () => {
    const { store } = setup()

    expect(await store.approveStreamer("missing", "admin", 1)).toBe(false)
    expect(await store.revokeStreamer("missing")).toBe(false)
  })

  it("keeps the approval across a later sign-in", async () => {
    const { store } = setup()
    await store.signInStreamer(signIn())
    await store.approveStreamer("s1", "admin", 5000)

    const again = await store.signInStreamer(signIn({ now: 9000 }))

    expect(again.approvedAt).toBe(5000)
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

    await store.setStatus("g1", "closed", 0)
    await store.setStatus("g1", "closed", 0)

    expect(await store.findGiveawayById("g1")).toMatchObject({ status: "closed" })
  })

  it("keeps the first close time and lists only drawn giveaways that closed before an instant, earliest first", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 0 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 0 }))
    await store.insertGiveaway(giveaway({ id: "g3", code: "CCCCC", createdAt: 0 }))
    await store.insertGiveaway(giveaway({ id: "g4", code: "DDDDD", createdAt: 0 }))
    await store.setStatus("g1", "closed", 20)
    await store.setStatus("g1", "drawn", 90)
    await store.setStatus("g2", "drawn", 10)
    await store.setStatus("g3", "closed", 5)

    expect(await store.listExpiredGiveaways(50, 10)).toEqual(["g2", "g1"])
    expect(await store.listExpiredGiveaways(20, 10)).toEqual(["g2"])
    expect(await store.listExpiredGiveaways(50, 1)).toEqual(["g2"])
  })

  it("lists closed giveaways whose retention was not armed, oldest first, and no more than the limit", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 3 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g3", code: "CCCCC", createdAt: 2 }))
    await store.insertGiveaway(giveaway({ id: "g4", code: "DDDDD", createdAt: 0 }))
    await store.setStatus("g1", "closed", 0)
    await store.setStatus("g2", "drawn", 0)
    await store.setStatus("g3", "closed", 0)

    expect(await store.listUnarmedRetention(10, 5)).toEqual(["g2", "g3", "g1"])
    expect(await store.listUnarmedRetention(2, 5)).toEqual(["g2", "g3"])
  })

  it("stops listing a giveaway once its retention is marked armed, and marking twice changes nothing", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 2 }))
    await store.setStatus("g1", "closed", 0)
    await store.setStatus("g2", "closed", 0)

    await store.markRetentionArmed("g1")
    await store.markRetentionArmed("g1")

    expect(await store.listUnarmedRetention(10, 5)).toEqual(["g2"])
  })

  it("lists giveaways with fewer failed sweeps first and leaves out those at the maximum", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway({ id: "g1", code: "AAAAA", createdAt: 1 }))
    await store.insertGiveaway(giveaway({ id: "g2", code: "BBBBB", createdAt: 2 }))
    await store.insertGiveaway(giveaway({ id: "g3", code: "CCCCC", createdAt: 3 }))
    for (const id of ["g1", "g2", "g3"]) await store.setStatus(id, "closed", 0)

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
    ["the streamers waiting for approval", pendingStreamersSql, [10]],
    ["the approved streamers", approvedStreamersSql, [10]],
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

describe("streamer access queries", () => {
  it("list both groups through the approval index", () => {
    const { db } = setup()

    for (const statement of [pendingStreamersSql, approvedStreamersSql]) {
      expect(explainPlan(db, statement, [10]).join(" ")).toContain("streamers_by_approval")
    }
  })
})

describe("AccountStore cloudflare plan", () => {
  it("has no stored plan until one is stored, then keeps only the latest", async () => {
    const { db, store } = setup()
    expect(await store.storedCloudflarePlan()).toBeNull()

    await store.storeCloudflarePlan("paid", "1", 1_000)
    expect(await store.storedCloudflarePlan()).toBe("paid")
    await store.storeCloudflarePlan("free", "2", 2_000)

    expect(await store.storedCloudflarePlan()).toBe("free")
    expect(sqlRows(db, "SELECT plan, changed_at, changed_by FROM cloudflare_plan")).toEqual([
      { plan: "free", changed_at: 2_000, changed_by: "2" },
    ])
  })

  it("lets the table hold only free or paid in its one row", () => {
    const { db } = setup()
    const insert = (id: number, plan: string) =>
      db.run(
        "INSERT INTO cloudflare_plan (id, plan, changed_at, changed_by) VALUES (?, ?, 0, '1')",
        [id, plan],
      )

    expect(() => insert(1, "pro")).toThrow()
    expect(() => insert(2, "paid")).toThrow()
  })
})

describe("AccountStore overlay themes", () => {
  const branded: OverlayTheme = { ...defaultOverlayTheme, accent: "#ff5500", font: "oswald" }
  const special: OverlayTheme = { ...defaultOverlayTheme, position: "bottom-right", sound: true }

  it("gives a streamer without a stored theme the default and keeps only the latest one stored", async () => {
    const { db, store } = await withStreamers()
    expect(await store.streamerOverlayTheme("s1")).toEqual(defaultOverlayTheme)

    await store.storeStreamerOverlayTheme("s1", special, 1_000)
    await store.storeStreamerOverlayTheme("s1", branded, 2_000)

    expect(await store.streamerOverlayTheme("s1")).toEqual(branded)
    expect(await store.streamerOverlayTheme("s2")).toEqual(defaultOverlayTheme)
    expect(sqlRows(db, "SELECT streamer_id, updated_at FROM streamer_overlay")).toEqual([
      { streamer_id: "s1", updated_at: 2_000 },
    ])
  })

  it("applies the streamer's theme to a giveaway without its own, and its own once set", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway())
    expect(await store.overlayThemeOf("g1")).toEqual(defaultOverlayTheme)

    await store.storeStreamerOverlayTheme("s1", branded, 1_000)
    expect(await store.overlayThemeOf("g1")).toEqual(branded)
    expect(await store.setGiveawayOverlayTheme("s1", "g1", special)).toBe(true)
    expect(await store.overlayThemeOf("g1")).toEqual(special)
    expect(await store.ownedOverlayThemes("s1", "g1")).toEqual({ own: special, streamer: branded })

    expect(await store.setGiveawayOverlayTheme("s1", "g1", null)).toBe(true)
    expect(await store.overlayThemeOf("g1")).toEqual(branded)
    expect(await store.ownedOverlayThemes("s1", "g1")).toEqual({ own: null, streamer: branded })
  })

  it("never reads or sets the theme of another streamer's giveaway", async () => {
    const { store } = await withStreamers()
    await store.insertGiveaway(giveaway())

    expect(await store.setGiveawayOverlayTheme("s2", "g1", special)).toBe(false)
    expect(await store.ownedOverlayThemes("s2", "g1")).toBeNull()
    expect(await store.overlayThemeOf("g1")).toEqual(defaultOverlayTheme)
  })

  it("gives an unknown giveaway the default theme", async () => {
    const { store } = await withStreamers()
    expect(await store.overlayThemeOf("missing")).toEqual(defaultOverlayTheme)
  })

  it("fails loudly on a stored theme that is not a valid theme", async () => {
    const { db, store } = await withStreamers()
    await store.storeStreamerOverlayTheme("s1", branded, 1_000)
    db.run('UPDATE streamer_overlay SET theme_json = \'{"accent":"red"}\'')

    await expect(store.streamerOverlayTheme("s1")).rejects.toBeInstanceOf(RoomRowError)
  })

  it("fails loudly on a giveaway theme that is not JSON", async () => {
    const { db, store } = await withStreamers()
    await store.insertGiveaway(giveaway())
    db.run("UPDATE giveaways SET overlay_theme_json = 'not json'")

    await expect(store.overlayThemeOf("g1")).rejects.toBeInstanceOf(RoomRowError)
  })
})

describe("currentPlan", () => {
  it("takes the stored plan over CLOUDFLARE_PLAN and falls back to it", async () => {
    const { store } = setup()
    const paidDefault = { cloudflarePlan: "paid" } as const
    expect(await currentPlan(store, paidDefault)).toBe("paid")

    await store.storeCloudflarePlan("free", "1", 0)

    expect(await currentPlan(store, paidDefault)).toBe("free")
  })
})
