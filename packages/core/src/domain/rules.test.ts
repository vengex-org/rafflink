import { describe, expect, it } from "bun:test"
import type { PlatformCapabilities } from "../platform/provider.ts"
import {
  accountAgeDays,
  evaluateEligibility,
  isEntryMessage,
  parseClaimSeconds,
  parseRules,
  unsupportedRule,
  type GiveawayRules,
  type RulesIssueCode,
  type ViewerFacts,
} from "./rules.ts"

const rules: GiveawayRules = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: null,
  claimKeyword: null,
  excludeRecentWinners: null,
  chatKeyword: null,
  pageEntry: true,
  subEntry: false,
  pointsReward: null,
  minAge: null,
  excludedCountries: null,
  extraTerms: null,
  winnerForm: [],
}

const viewer: ViewerFacts = {
  userId: "100",
  isFollower: false,
  subTier: null,
  isVip: false,
  isModerator: false,
  accountAgeDays: 400,
  exclusion: null,
}

const config = {
  claimKeywordMaxLength: 10,
  ticketsPerGroupMax: 100,
  defaultClaimSeconds: 300,
  claimSecondsMax: 3600,
  recentWinnersGiveawaysMax: 10,
  recentWinnersDaysMax: 90,
  excludedCountriesMaxLength: 20,
  extraTermsMaxLength: 30,
}

const validInput = {
  tickets: { viewer: 1, follower: 2, sub_t1: 3, sub_t2: 4, sub_t3: 5, vip: 6, moderator: 7 },
}

describe("evaluateEligibility", () => {
  it("the broadcaster cannot enter", () => {
    const outcome = evaluateEligibility(rules, { ...viewer, userId: "999" }, "999")
    expect(outcome).toEqual({ eligible: false, reason: "broadcaster" })
  })

  it("refuses the broadcaster even in the best group", () => {
    const outcome = evaluateEligibility(
      rules,
      { ...viewer, userId: "999", isModerator: true },
      "999",
    )
    expect(outcome).toEqual({ eligible: false, reason: "broadcaster" })
  })

  it("refuses a blocked viewer whatever their group", () => {
    const outcome = evaluateEligibility(
      rules,
      { ...viewer, isModerator: true, exclusion: "blocked" },
      "999",
    )
    expect(outcome).toEqual({ eligible: false, reason: "blocked" })
  })

  it("refuses a recent winner", () => {
    const outcome = evaluateEligibility(rules, { ...viewer, exclusion: "recent-winner" }, "999")
    expect(outcome).toEqual({ eligible: false, reason: "recent-winner" })
  })

  it("tells the broadcaster they are the broadcaster even when excluded", () => {
    const outcome = evaluateEligibility(
      rules,
      { ...viewer, userId: "999", exclusion: "blocked" },
      "999",
    )
    expect(outcome).toEqual({ eligible: false, reason: "broadcaster" })
  })

  it("enters a plain viewer with the viewer tickets", () => {
    expect(evaluateEligibility(rules, viewer, "999")).toEqual({
      eligible: true,
      group: "viewer",
      tickets: 1,
    })
  })

  it("uses the tickets of the best group, not their sum", () => {
    const outcome = evaluateEligibility(
      rules,
      { ...viewer, isFollower: true, subTier: 2, isVip: true },
      "999",
    )
    expect(outcome).toEqual({ eligible: true, group: "vip", tickets: 6 })
  })

  it("puts a tier 3 subscriber in the sub_t3 group only", () => {
    const outcome = evaluateEligibility(rules, { ...viewer, subTier: 3 }, "999")
    expect(outcome).toEqual({ eligible: true, group: "sub_t3", tickets: 5 })
  })

  it("refuses a non-subscriber when subs only", () => {
    const outcome = evaluateEligibility({ ...rules, subsOnly: true }, viewer, "999")
    expect(outcome).toEqual({ eligible: false, reason: "subs-only" })
  })

  it("accepts a subscriber when subs only", () => {
    const outcome = evaluateEligibility(
      { ...rules, subsOnly: true },
      { ...viewer, subTier: 1 },
      "999",
    )
    expect(outcome.eligible).toBe(true)
  })

  it("refuses a non-follower when followers only", () => {
    const outcome = evaluateEligibility({ ...rules, followersOnly: true }, viewer, "999")
    expect(outcome).toEqual({ eligible: false, reason: "followers-only" })
  })

  it("accepts a follower when followers only", () => {
    const outcome = evaluateEligibility(
      { ...rules, followersOnly: true },
      { ...viewer, isFollower: true },
      "999",
    )
    expect(outcome).toEqual({ eligible: true, group: "follower", tickets: 2 })
  })

  it("refuses an account younger than the minimum", () => {
    const outcome = evaluateEligibility(
      { ...rules, minAccountAgeDays: 30 },
      { ...viewer, accountAgeDays: 29 },
      "999",
    )
    expect(outcome).toEqual({ eligible: false, reason: "account-too-young" })
  })

  it("accepts an account exactly at the minimum", () => {
    const outcome = evaluateEligibility(
      { ...rules, minAccountAgeDays: 30 },
      { ...viewer, accountAgeDays: 30 },
      "999",
    )
    expect(outcome.eligible).toBe(true)
  })

  it("accepts a brand new account when the minimum is 0 days", () => {
    const outcome = evaluateEligibility(
      { ...rules, minAccountAgeDays: 0 },
      { ...viewer, accountAgeDays: 0 },
      "999",
    )
    expect(outcome.eligible).toBe(true)
  })

  it("refuses a new account when the minimum is 1 day", () => {
    const outcome = evaluateEligibility(
      { ...rules, minAccountAgeDays: 1 },
      { ...viewer, accountAgeDays: 0 },
      "999",
    )
    expect(outcome).toEqual({ eligible: false, reason: "account-too-young" })
  })

  it("refuses an unknown account age when a minimum is set", () => {
    const outcome = evaluateEligibility(
      { ...rules, minAccountAgeDays: 0 },
      { ...viewer, accountAgeDays: null },
      "999",
    )
    expect(outcome).toEqual({ eligible: false, reason: "account-too-young" })
  })

  it("ignores an unknown account age when no minimum is set", () => {
    const outcome = evaluateEligibility(rules, { ...viewer, accountAgeDays: null }, "999")
    expect(outcome.eligible).toBe(true)
  })

  it("refuses a viewer whose best group has 0 tickets", () => {
    const noViewers: GiveawayRules = { ...rules, tickets: { ...rules.tickets, viewer: 0 } }
    expect(evaluateEligibility(noViewers, viewer, "999")).toEqual({
      eligible: false,
      reason: "no-tickets",
    })
  })

  it("enters a viewer through a group with tickets when the viewer group has 0", () => {
    const noViewers: GiveawayRules = { ...rules, tickets: { ...rules.tickets, viewer: 0 } }
    const outcome = evaluateEligibility(noViewers, { ...viewer, isFollower: true }, "999")
    expect(outcome).toEqual({ eligible: true, group: "follower", tickets: 2 })
  })
})

describe("parseRules", () => {
  it("parses valid rules and applies filter and keyword defaults", () => {
    expect(parseRules(validInput, config)).toEqual({
      ok: true,
      value: {
        tickets: validInput.tickets,
        subsOnly: false,
        followersOnly: false,
        minAccountAgeDays: null,
        claimKeyword: null,
        excludeRecentWinners: null,
        chatKeyword: null,
        pageEntry: true,
        subEntry: false,
        pointsReward: null,
        minAge: null,
        excludedCountries: null,
        extraTerms: null,
        winnerForm: [],
      },
    })
  })

  it("parses the minimum age of a winner in whole years up to 99", () => {
    expect(parseRules({ ...validInput, minAge: 18 }, config)).toMatchObject({
      ok: true,
      value: { minAge: 18 },
    })
    expect(parseRules({ ...validInput, minAge: 99 }, config).ok).toBe(true)
    expect(parseRules({ ...validInput, minAge: null }, config)).toMatchObject({
      ok: true,
      value: { minAge: null },
    })
    for (const bad of [0, -1, 17.5, Number.NaN, Number.POSITIVE_INFINITY, "18"]) {
      expect(parseRules({ ...validInput, minAge: bad }, config)).toEqual({
        ok: false,
        issue: { field: "minAge", code: "not-a-positive-integer" },
      })
    }
    expect(parseRules({ ...validInput, minAge: 100 }, config)).toEqual({
      ok: false,
      issue: { field: "minAge", code: "too-large" },
    })
  })

  it("parses trimmed excluded countries and extra terms within their length limits", () => {
    expect(
      parseRules(
        { ...validInput, excludedCountries: " Quebec ", extraTerms: " Shipping in the EU only. " },
        config,
      ),
    ).toMatchObject({
      ok: true,
      value: { excludedCountries: "Quebec", extraTerms: "Shipping in the EU only." },
    })
    for (const field of ["excludedCountries", "extraTerms"] as const) {
      expect(parseRules({ ...validInput, [field]: null }, config)).toMatchObject({
        ok: true,
        value: { [field]: null },
      })
      expect(parseRules({ ...validInput, [field]: " " }, config)).toEqual({
        ok: false,
        issue: { field, code: "blank" },
      })
      expect(parseRules({ ...validInput, [field]: 1 }, config)).toEqual({
        ok: false,
        issue: { field, code: "not-a-string" },
      })
    }
    expect(parseRules({ ...validInput, excludedCountries: "a".repeat(20) }, config).ok).toBe(true)
    expect(parseRules({ ...validInput, excludedCountries: "a".repeat(21) }, config)).toEqual({
      ok: false,
      issue: { field: "excludedCountries", code: "too-long" },
    })
    expect(parseRules({ ...validInput, extraTerms: "a".repeat(30) }, config).ok).toBe(true)
    expect(parseRules({ ...validInput, extraTerms: "a".repeat(31) }, config)).toEqual({
      ok: false,
      issue: { field: "extraTerms", code: "too-long" },
    })
  })

  it("parses the winner form fields in the order given", () => {
    expect(
      parseRules({ ...validInput, winnerForm: ["address", "name", "platform-id"] }, config),
    ).toMatchObject({ ok: true, value: { winnerForm: ["address", "name", "platform-id"] } })
    expect(parseRules({ ...validInput, winnerForm: [] }, config)).toMatchObject({
      ok: true,
      value: { winnerForm: [] },
    })
  })

  it("refuses a winner form that is not a list, or has an unknown or a repeated field", () => {
    for (const [winnerForm, field, code] of [
      [null, "winnerForm", "not-a-list"],
      ["name", "winnerForm", "not-a-list"],
      [{ 0: "name" }, "winnerForm", "not-a-list"],
      [["phone"], "winnerForm.0", "unknown-kind"],
      [["name", "constructor"], "winnerForm.1", "unknown-kind"],
      [["name", 1], "winnerForm.1", "unknown-kind"],
      [["email", "email"], "winnerForm.1", "duplicate"],
    ] as const) {
      expect(parseRules({ ...validInput, winnerForm }, config)).toEqual({
        ok: false,
        issue: { field, code },
      })
    }
  })

  it("parses sub entry and the points reward, trimming the reward's text", () => {
    expect(
      parseRules(
        { ...validInput, subEntry: true, pointsReward: { id: " r-1 ", title: " Enter " } },
        config,
      ),
    ).toMatchObject({
      ok: true,
      value: { subEntry: true, pointsReward: { id: "r-1", title: "Enter" } },
    })
    expect(parseRules({ ...validInput, pointsReward: null }, config)).toMatchObject({
      ok: true,
      value: { pointsReward: null },
    })
  })

  it("refuses a sub entry flag or a points reward of the wrong shape", () => {
    const cases: readonly [Record<string, unknown>, string, RulesIssueCode][] = [
      [{ subEntry: "yes" }, "subEntry", "not-a-boolean"],
      [{ pointsReward: "r-1" }, "pointsReward", "not-an-object"],
      [{ pointsReward: ["r-1"] }, "pointsReward", "not-an-object"],
      [{ pointsReward: { title: "Enter" } }, "pointsReward.id", "missing"],
      [{ pointsReward: { id: 7, title: "Enter" } }, "pointsReward.id", "not-a-string"],
      [{ pointsReward: { id: " ", title: "Enter" } }, "pointsReward.id", "blank"],
      [{ pointsReward: { id: "r-1", title: "x".repeat(101) } }, "pointsReward.title", "too-long"],
      [{ pointsReward: { id: "r-1" } }, "pointsReward.title", "missing"],
    ]
    for (const [input, field, code] of cases) {
      expect(parseRules({ ...validInput, ...input }, config)).toEqual({
        ok: false,
        issue: { field, code },
      })
    }
    expect(
      parseRules({ ...validInput, pointsReward: { id: "r-1", title: "x".repeat(100) } }, config).ok,
    ).toBe(true)
  })

  it("refuses sub or points entry without a free way in: the page or the chat keyword", () => {
    const paidOnly = {
      ...validInput,
      pageEntry: false,
      chatKeyword: null,
      subEntry: true,
      pointsReward: { id: "r-1", title: "Enter" },
    }
    expect(parseRules(paidOnly, config)).toEqual({
      ok: false,
      issue: { field: "pageEntry", code: "no-entry-way" },
    })
    expect(parseRules({ ...paidOnly, chatKeyword: "!enter" }, config).ok).toBe(true)
  })

  it("keeps page entry on unless it is turned off, and only next to a chat keyword", () => {
    expect(
      parseRules({ ...validInput, pageEntry: false, chatKeyword: "!enter" }, config),
    ).toMatchObject({
      ok: true,
      value: { pageEntry: false, chatKeyword: "!enter" },
    })
    expect(parseRules({ ...validInput, pageEntry: false }, config)).toEqual({
      ok: false,
      issue: { field: "pageEntry", code: "no-entry-way" },
    })
    expect(parseRules({ ...validInput, pageEntry: "no" }, config)).toEqual({
      ok: false,
      issue: { field: "pageEntry", code: "not-a-boolean" },
    })
  })

  it("parses a trimmed chat keyword and checks it like the claim keyword", () => {
    expect(parseRules({ ...validInput, chatKeyword: " !enter " }, config)).toMatchObject({
      ok: true,
      value: { chatKeyword: "!enter" },
    })
    expect(parseRules({ ...validInput, chatKeyword: null }, config)).toMatchObject({
      ok: true,
      value: { chatKeyword: null },
    })
    expect(parseRules({ ...validInput, chatKeyword: " " }, config)).toEqual({
      ok: false,
      issue: { field: "chatKeyword", code: "blank" },
    })
    expect(parseRules({ ...validInput, chatKeyword: 1 }, config)).toEqual({
      ok: false,
      issue: { field: "chatKeyword", code: "not-a-string" },
    })
    expect(parseRules({ ...validInput, chatKeyword: "a".repeat(11) }, config)).toEqual({
      ok: false,
      issue: { field: "chatKeyword", code: "too-long" },
    })
  })

  it("parses filters, minimum age and a trimmed keyword", () => {
    const parsed = parseRules(
      {
        ...validInput,
        subsOnly: true,
        followersOnly: true,
        minAccountAgeDays: 7,
        claimKeyword: " !claim ",
      },
      config,
    )
    expect(parsed).toMatchObject({
      ok: true,
      value: { subsOnly: true, followersOnly: true, minAccountAgeDays: 7, claimKeyword: "!claim" },
    })
  })

  it("reads a minimum account age of 0 as no minimum", () => {
    const parsed = parseRules({ ...validInput, minAccountAgeDays: 0 }, config)
    expect(parsed).toMatchObject({ ok: true, value: { minAccountAgeDays: null } })
    if (!parsed.ok) throw new Error("expected valid rules")
    const outcome = evaluateEligibility(parsed.value, { ...viewer, accountAgeDays: null }, "999")
    expect(outcome.eligible).toBe(true)
  })

  it("accepts 0 tickets for a group", () => {
    const parsed = parseRules({ tickets: { ...validInput.tickets, viewer: 0 } }, config)
    expect(parsed.ok).toBe(true)
  })

  it("rejects input that is not an object", () => {
    for (const input of [null, undefined, "x", 1, [], [validInput]]) {
      expect(parseRules(input, config)).toEqual({
        ok: false,
        issue: { field: "rules", code: "not-an-object" },
      })
    }
  })

  it("rejects missing tickets", () => {
    expect(parseRules({}, config)).toEqual({
      ok: false,
      issue: { field: "tickets", code: "not-an-object" },
    })
  })

  it("rejects a missing group", () => {
    const { vip: _vip, ...withoutVip } = validInput.tickets
    expect(parseRules({ tickets: withoutVip }, config)).toEqual({
      ok: false,
      issue: { field: "tickets.vip", code: "missing" },
    })
  })

  it("rejects a negative, fractional, non-finite or non-number ticket count", () => {
    for (const bad of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1",
      null,
      Number.MAX_VALUE,
    ]) {
      expect(parseRules({ tickets: { ...validInput.tickets, sub_t2: bad } }, config)).toEqual({
        ok: false,
        issue: { field: "tickets.sub_t2", code: "not-a-non-negative-integer" },
      })
    }
  })

  it("accepts the maximum tickets of a group and refuses one more", () => {
    expect(parseRules({ tickets: { ...validInput.tickets, vip: 100 } }, config).ok).toBe(true)

    for (const big of [101, Number.MAX_SAFE_INTEGER]) {
      expect(parseRules({ tickets: { ...validInput.tickets, vip: big } }, config)).toEqual({
        ok: false,
        issue: { field: "tickets.vip", code: "too-large" },
      })
    }
  })

  it("does not read a group from the prototype chain", () => {
    const inherited = Object.create(validInput.tickets)
    expect(parseRules({ tickets: inherited }, config)).toEqual({
      ok: false,
      issue: { field: "tickets.viewer", code: "missing" },
    })
  })

  it("keeps an own __proto__ key from becoming the rules", () => {
    const input: unknown = JSON.parse('{"__proto__": {"tickets": {}}}')
    expect(parseRules(input, config)).toEqual({
      ok: false,
      issue: { field: "tickets", code: "not-an-object" },
    })
  })

  it("rejects a filter that is not a boolean", () => {
    expect(parseRules({ ...validInput, subsOnly: "yes" }, config)).toEqual({
      ok: false,
      issue: { field: "subsOnly", code: "not-a-boolean" },
    })
    expect(parseRules({ ...validInput, followersOnly: 1 }, config)).toEqual({
      ok: false,
      issue: { field: "followersOnly", code: "not-a-boolean" },
    })
  })

  it("rejects a negative, fractional or non-finite minimum account age", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "7"]) {
      expect(parseRules({ ...validInput, minAccountAgeDays: bad }, config)).toEqual({
        ok: false,
        issue: { field: "minAccountAgeDays", code: "not-a-non-negative-integer" },
      })
    }
  })

  it("rejects a blank keyword and a non-string keyword", () => {
    for (const blank of ["", " ", "\t"]) {
      expect(parseRules({ ...validInput, claimKeyword: blank }, config)).toEqual({
        ok: false,
        issue: { field: "claimKeyword", code: "blank" },
      })
    }
    expect(parseRules({ ...validInput, claimKeyword: 5 }, config)).toEqual({
      ok: false,
      issue: { field: "claimKeyword", code: "not-a-string" },
    })
  })

  it("accepts a keyword at the maximum length and rejects one longer", () => {
    expect(parseRules({ ...validInput, claimKeyword: "a".repeat(10) }, config).ok).toBe(true)
    expect(parseRules({ ...validInput, claimKeyword: "a".repeat(11) }, config)).toEqual({
      ok: false,
      issue: { field: "claimKeyword", code: "too-long" },
    })
  })

  it("measures the keyword length after trimming", () => {
    const padded = ` ${"a".repeat(10)} `
    expect(parseRules({ ...validInput, claimKeyword: padded }, config).ok).toBe(true)
  })
})

describe("parseRules recent winners", () => {
  it("reads an absent or null exclusion as none", () => {
    for (const excludeRecentWinners of [undefined, null]) {
      expect(parseRules({ ...validInput, excludeRecentWinners }, config)).toMatchObject({
        ok: true,
        value: { excludeRecentWinners: null },
      })
    }
  })

  it("parses the last giveaways and the last days up to their maximum", () => {
    expect(
      parseRules({ ...validInput, excludeRecentWinners: { kind: "giveaways", count: 10 } }, config),
    ).toMatchObject({ ok: true, value: { excludeRecentWinners: { kind: "giveaways", count: 10 } } })
    expect(
      parseRules({ ...validInput, excludeRecentWinners: { kind: "days", count: 90 } }, config),
    ).toMatchObject({ ok: true, value: { excludeRecentWinners: { kind: "days", count: 90 } } })
  })

  it("refuses a count above the maximum of its kind", () => {
    expect(
      parseRules({ ...validInput, excludeRecentWinners: { kind: "giveaways", count: 11 } }, config),
    ).toEqual({ ok: false, issue: { field: "excludeRecentWinners.count", code: "too-large" } })
    expect(
      parseRules({ ...validInput, excludeRecentWinners: { kind: "days", count: 91 } }, config),
    ).toEqual({ ok: false, issue: { field: "excludeRecentWinners.count", code: "too-large" } })
  })

  it("refuses a count of 0, a negative, fractional, non-finite or non-number count", () => {
    for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
      expect(
        parseRules({ ...validInput, excludeRecentWinners: { kind: "days", count } }, config),
      ).toEqual({
        ok: false,
        issue: { field: "excludeRecentWinners.count", code: "not-a-positive-integer" },
      })
    }
  })

  it("refuses an unknown kind, a prototype key as kind and a non-object", () => {
    for (const kind of ["weeks", "constructor", "__proto__", "", undefined]) {
      expect(
        parseRules({ ...validInput, excludeRecentWinners: { kind, count: 1 } }, config),
      ).toEqual({ ok: false, issue: { field: "excludeRecentWinners.kind", code: "unknown-kind" } })
    }
    for (const excludeRecentWinners of [3, "days", []]) {
      expect(parseRules({ ...validInput, excludeRecentWinners }, config)).toEqual({
        ok: false,
        issue: { field: "excludeRecentWinners", code: "not-an-object" },
      })
    }
  })
})

describe("unsupportedRule", () => {
  const twitch: PlatformCapabilities = {
    followerCheck: true,
    subTiers: true,
    vip: true,
    accountAge: true,
    moderatorRole: true,
    pageEntry: true,
    chatEntry: true,
    subEntry: true,
    pointsEntry: true,
    chatBadgeGroups: [],
  }
  // Kick: no follower lookup, no VIP and no account age.
  const kick: PlatformCapabilities = {
    ...twitch,
    followerCheck: false,
    vip: false,
    accountAge: false,
  }
  const kickRules: GiveawayRules = { ...rules, tickets: { ...rules.tickets, follower: 0, vip: 0 } }

  it("accepts every rule on a platform that can check them all", () => {
    const everything: GiveawayRules = {
      ...rules,
      subsOnly: true,
      followersOnly: true,
      minAccountAgeDays: 30,
      chatKeyword: "!enter",
    }
    expect(unsupportedRule(everything, twitch)).toBeNull()
  })

  it("accepts rules that leave out what the platform cannot check", () => {
    expect(unsupportedRule(kickRules, kick)).toBeNull()
  })

  it("refuses followers only, a minimum account age and VIP tickets on Kick", () => {
    expect(unsupportedRule({ ...kickRules, followersOnly: true }, kick)).toEqual({
      field: "followersOnly",
      code: "unsupported",
    })
    expect(unsupportedRule({ ...kickRules, minAccountAgeDays: 1 }, kick)).toEqual({
      field: "minAccountAgeDays",
      code: "unsupported",
    })
    expect(
      unsupportedRule({ ...kickRules, tickets: { ...kickRules.tickets, vip: 1 } }, kick),
    ).toEqual({ field: "tickets.vip", code: "unsupported" })
    expect(
      unsupportedRule({ ...kickRules, tickets: { ...kickRules.tickets, follower: 1 } }, kick),
    ).toEqual({ field: "tickets.follower", code: "unsupported" })
  })

  it("refuses subscribers only and tier tickets without sub tiers", () => {
    const noTiers: PlatformCapabilities = { ...twitch, subTiers: false }
    const tierless: GiveawayRules = {
      ...rules,
      tickets: { ...rules.tickets, sub_t1: 0, sub_t2: 0, sub_t3: 0 },
    }
    expect(unsupportedRule(tierless, noTiers)).toBeNull()
    expect(unsupportedRule({ ...tierless, subsOnly: true }, noTiers)).toEqual({
      field: "subsOnly",
      code: "unsupported",
    })
    expect(
      unsupportedRule({ ...tierless, tickets: { ...tierless.tickets, sub_t2: 2 } }, noTiers),
    ).toEqual({ field: "tickets.sub_t2", code: "unsupported" })
  })

  it("accepts chat badge group tickets only when no entrant comes by the page or points", () => {
    const badges: PlatformCapabilities = {
      ...twitch,
      subTiers: false,
      moderatorRole: false,
      chatBadgeGroups: ["sub_t1", "moderator"],
    }
    const chatOnly: GiveawayRules = {
      ...rules,
      tickets: { ...rules.tickets, sub_t1: 2, sub_t2: 0, sub_t3: 0, moderator: 3 },
      chatKeyword: "!enter",
      pageEntry: false,
      subEntry: true,
    }

    expect(unsupportedRule(chatOnly, badges)).toBeNull()
    expect(unsupportedRule({ ...chatOnly, pageEntry: true }, badges)).toEqual({
      field: "tickets.sub_t1",
      code: "unsupported",
    })
    expect(
      unsupportedRule({ ...chatOnly, pointsReward: { id: "r-1", title: "Enter" } }, badges),
    ).toEqual({ field: "tickets.sub_t1", code: "unsupported" })
    expect(
      unsupportedRule({ ...chatOnly, tickets: { ...chatOnly.tickets, sub_t2: 1 } }, badges),
    ).toEqual({ field: "tickets.sub_t2", code: "unsupported" })
  })

  it("refuses an entry way the platform does not offer", () => {
    expect(unsupportedRule(rules, { ...twitch, pageEntry: false })).toEqual({
      field: "pageEntry",
      code: "unsupported",
    })
    expect(
      unsupportedRule({ ...rules, chatKeyword: "!enter" }, { ...twitch, chatEntry: false }),
    ).toEqual({ field: "chatKeyword", code: "unsupported" })
    expect(unsupportedRule({ ...rules, subEntry: true }, { ...twitch, subEntry: false })).toEqual({
      field: "subEntry",
      code: "unsupported",
    })
    expect(
      unsupportedRule(
        { ...rules, pointsReward: { id: "r-1", title: "Enter" } },
        { ...twitch, pointsEntry: false },
      ),
    ).toEqual({ field: "pointsReward", code: "unsupported" })
  })
})

describe("isEntryMessage", () => {
  it("matches the keyword alone or as the first word, in any letter case", () => {
    expect(isEntryMessage("!enter", "!enter")).toBe(true)
    expect(isEntryMessage("  !ENTER  ", "!enter")).toBe(true)
    expect(isEntryMessage("!enter please", "!Enter")).toBe(true)
  })

  it("refuses the keyword inside another word or later in the message", () => {
    expect(isEntryMessage("!entering", "!enter")).toBe(false)
    expect(isEntryMessage("do !enter", "!enter")).toBe(false)
    expect(isEntryMessage("", "!enter")).toBe(false)
  })
})

describe("accountAgeDays", () => {
  it("counts whole days and never goes below 0", () => {
    const day = 86_400_000
    expect(accountAgeDays(10 * day - 1, 0)).toBe(9)
    expect(accountAgeDays(10 * day, 0)).toBe(10)
    expect(accountAgeDays(0, day)).toBe(0)
  })
})

describe("parseClaimSeconds", () => {
  it("takes the configured default when absent", () => {
    expect(parseClaimSeconds(undefined, config)).toEqual({ ok: true, value: 300 })
  })

  it("accepts a positive integer", () => {
    expect(parseClaimSeconds(60, config)).toEqual({ ok: true, value: 60 })
  })

  it("accepts the maximum claim time and refuses more", () => {
    expect(parseClaimSeconds(3600, config)).toEqual({ ok: true, value: 3600 })

    for (const big of [3601, Number.MAX_SAFE_INTEGER]) {
      expect(parseClaimSeconds(big, config)).toEqual({
        ok: false,
        issue: { field: "claimSeconds", code: "too-large" },
      })
    }
  })

  it("rejects 0, negative, fractional, non-finite and non-number values", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "60", null]) {
      expect(parseClaimSeconds(bad, config)).toEqual({
        ok: false,
        issue: { field: "claimSeconds", code: "not-a-positive-integer" },
      })
    }
  })
})
