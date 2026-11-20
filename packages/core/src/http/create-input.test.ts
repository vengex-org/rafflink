import { describe, expect, it } from "bun:test"
import { validRules } from "../../test/app-fixture.ts"
import { resolveConfig } from "../config.ts"
import { parseCreateGiveaway, type CreateIssue } from "./create-input.ts"

const config = resolveConfig({
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "s",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
  CLAIM_KEYWORD_MAX_LENGTH: "8",
  DEFAULT_CLAIM_SECONDS: "300",
})

const now = Date.parse("2026-12-01T10:00:00Z")
const valid = { title: "Title", prize: "Prize", rules: validRules }

function issue(body: unknown): CreateIssue | null {
  const parsed = parseCreateGiveaway(body, now, config)
  return parsed.ok ? null : parsed.issue
}

const claimSecondsIssue: CreateIssue = { field: "claimSeconds", code: "not-a-positive-integer" }

describe("parseCreateGiveaway", () => {
  it("accepts a body with only the required fields and defaults the claim time", () => {
    expect(parseCreateGiveaway(valid, now, config)).toEqual({
      ok: true,
      value: {
        title: "Title",
        prize: "Prize",
        rules: validRules,
        claimSeconds: 300,
        closesAt: null,
      },
    })
  })

  it("trims the title and the prize", () => {
    const parsed = parseCreateGiveaway({ ...valid, title: "  A  ", prize: " B " }, now, config)

    expect(parsed).toMatchObject({ ok: true, value: { title: "A", prize: "B" } })
  })

  it("reads an end time with a zone offset", () => {
    const parsed = parseCreateGiveaway(
      { ...valid, closesAt: "2026-12-01T12:00:01+02:00" },
      now,
      config,
    )

    expect(parsed).toMatchObject({ ok: true, value: { closesAt: now + 1000 } })
  })

  const bodies: readonly [string, unknown, CreateIssue][] = [
    ["a body that is not an object", "text", { field: "body", code: "not-an-object" }],
    ["a null body", null, { field: "body", code: "not-an-object" }],
    ["an array body", [], { field: "body", code: "not-an-object" }],
    ["a missing title", { ...valid, title: undefined }, { field: "title", code: "missing" }],
    ["an empty title", { ...valid, title: "" }, { field: "title", code: "blank" }],
    ["a title of spaces", { ...valid, title: "   " }, { field: "title", code: "blank" }],
    ["a numeric title", { ...valid, title: 5 }, { field: "title", code: "not-a-string" }],
    ["an empty prize", { ...valid, prize: "" }, { field: "prize", code: "blank" }],
    ["a prize of whitespace", { ...valid, prize: " \t" }, { field: "prize", code: "blank" }],
    ["a null prize", { ...valid, prize: null }, { field: "prize", code: "not-a-string" }],
    ["missing rules", { title: "T", prize: "P" }, { field: "rules", code: "not-an-object" }],
    [
      "rules that are a string",
      { ...valid, rules: "x" },
      { field: "rules", code: "not-an-object" },
    ],
    [
      "a negative ticket count",
      { ...valid, rules: { ...validRules, tickets: { ...validRules.tickets, vip: -1 } } },
      { field: "tickets.vip", code: "not-a-non-negative-integer" },
    ],
    [
      "a keyword of spaces",
      { ...valid, rules: { ...validRules, claimKeyword: "   " } },
      { field: "claimKeyword", code: "blank" },
    ],
    [
      "a keyword over the maximum length",
      { ...valid, rules: { ...validRules, claimKeyword: "123456789" } },
      { field: "claimKeyword", code: "too-long" },
    ],
    [
      "a numeric keyword",
      { ...valid, rules: { ...validRules, claimKeyword: 5 } },
      { field: "claimKeyword", code: "not-a-string" },
    ],
    ["a claim time of 0", { ...valid, claimSeconds: 0 }, claimSecondsIssue],
    ["a negative claim time", { ...valid, claimSeconds: -1 }, claimSecondsIssue],
    ["a fractional claim time", { ...valid, claimSeconds: 1.5 }, claimSecondsIssue],
    ["a NaN claim time", { ...valid, claimSeconds: Number.NaN }, claimSecondsIssue],
    ["an infinite claim time", { ...valid, claimSeconds: Infinity }, claimSecondsIssue],
    ["a text claim time", { ...valid, claimSeconds: "300" }, claimSecondsIssue],
    [
      "an end time in the past",
      { ...valid, closesAt: "2026-12-01T09:59:59Z" },
      { field: "closesAt", code: "in-the-past" },
    ],
    [
      "an end time of exactly now",
      { ...valid, closesAt: "2026-12-01T10:00:00Z" },
      { field: "closesAt", code: "in-the-past" },
    ],
    [
      "an end time that is not a date",
      { ...valid, closesAt: "tomorrow" },
      { field: "closesAt", code: "not-a-timestamp" },
    ],
    [
      "a date-only end time",
      { ...valid, closesAt: "2026-12-02" },
      { field: "closesAt", code: "not-a-timestamp" },
    ],
    [
      "an end time without a zone",
      { ...valid, closesAt: "2026-12-02T10:00:00" },
      { field: "closesAt", code: "not-a-timestamp" },
    ],
    [
      "an impossible end time",
      { ...valid, closesAt: "2026-13-45T10:00:00Z" },
      { field: "closesAt", code: "not-a-timestamp" },
    ],
    [
      "a numeric end time",
      { ...valid, closesAt: 1_800_000_000_000 },
      { field: "closesAt", code: "not-a-timestamp" },
    ],
  ]

  for (const [name, body, expected] of bodies) {
    it(`rejects ${name}`, () => {
      expect(issue(body)).toEqual(expected)
    })
  }

  it("maps an empty keyword field to any message", () => {
    const parsed = parseCreateGiveaway(
      { ...valid, rules: { ...validRules, claimKeyword: "" } },
      now,
      config,
    )

    expect(parsed).toMatchObject({ ok: true, value: { rules: { claimKeyword: null } } })
  })

  it("keeps a keyword of exactly the maximum length", () => {
    const parsed = parseCreateGiveaway(
      { ...valid, rules: { ...validRules, claimKeyword: "12345678" } },
      now,
      config,
    )

    expect(parsed).toMatchObject({ ok: true, value: { rules: { claimKeyword: "12345678" } } })
  })

  it("does not read a title from the prototype", () => {
    const body = Object.create({ title: "Inherited", prize: "Inherited", rules: validRules })

    expect(issue(body)).toEqual({ field: "title", code: "missing" })
  })
})
