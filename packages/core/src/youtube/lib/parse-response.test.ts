import { describe, expect, it } from "bun:test"
import {
  errorReasonOf,
  parseChannels,
  parseChatPage,
  parseGoogleTokens,
  parseLiveChatIds,
  parseTokenInfo,
} from "./parse-response.ts"

const malformed = { ok: false, issue: "malformed" } as const

function textItem(overrides: Record<string, unknown> = {}) {
  return {
    snippet: {
      type: "textMessageEvent",
      publishedAt: "2026-11-23T10:00:00.5+00:00",
      textMessageDetails: { messageText: "!enter" },
    },
    authorDetails: { channelId: "UC1", displayName: "@one", isChatSponsor: true },
    ...overrides,
  }
}

describe("YouTube response parsing", () => {
  it("reads a refresh answer without a refresh token and refuses a token answer without a lifetime", () => {
    expect(parseGoogleTokens({ access_token: "a", expires_in: 3599 })).toEqual({
      ok: true,
      value: { accessToken: "a", refreshToken: null, expiresInSeconds: 3599 },
    })
    for (const body of [
      null,
      [],
      { access_token: "a" },
      { access_token: "a", expires_in: 0 },
      { access_token: "a", expires_in: Number.NaN },
      { access_token: "a", expires_in: 60, refresh_token: 5 },
      { expires_in: 60 },
    ]) {
      expect(parseGoogleTokens(body)).toEqual(malformed)
    }
  })

  it("reads the audience of token info and refuses a body without one", () => {
    expect(parseTokenInfo({ aud: "client" })).toEqual({ ok: true, value: "client" })
    expect(parseTokenInfo({ aud: 1 })).toEqual(malformed)
    expect(parseTokenInfo("aud")).toEqual(malformed)
  })

  it("reads no channels from an answer without items and refuses a channel without a title", () => {
    expect(parseChannels({ kind: "youtube#channelListResponse" })).toEqual({ ok: true, value: [] })
    expect(parseChannels({ items: [{ id: "UC1", snippet: {} }] })).toEqual(malformed)
    expect(
      parseChannels({ items: [{ id: "UC1", snippet: { title: "T", customUrl: 3 } }] }),
    ).toEqual(malformed)
    expect(parseChannels({ items: {} })).toEqual(malformed)
  })

  it("skips a broadcast without a chat and refuses a chat id that is not text", () => {
    expect(
      parseLiveChatIds({ items: [{ snippet: {} }, { snippet: { liveChatId: "c" } }] }),
    ).toEqual({ ok: true, value: ["c"] })
    expect(parseLiveChatIds({ items: [{ snippet: { liveChatId: 7 } }] })).toEqual(malformed)
    expect(parseLiveChatIds({ items: [null] })).toEqual(malformed)
  })

  it("keeps text messages only and reads a missing role as no role", () => {
    const page = parseChatPage({
      nextPageToken: "n",
      pollingIntervalMillis: 2000,
      items: [
        textItem(),
        textItem({ snippet: { type: "superChatEvent", publishedAt: "2026-11-23T10:00:00Z" } }),
      ],
    })

    expect(page).toEqual({
      ok: true,
      value: {
        items: [
          {
            authorChannelId: "UC1",
            displayName: "@one",
            text: "!enter",
            publishedAt: Date.parse("2026-11-23T10:00:00.5Z"),
            isChatSponsor: true,
            isChatModerator: false,
            isChatOwner: false,
          },
        ],
        nextPageToken: "n",
        pollingIntervalMillis: 2000,
        offline: false,
      },
    })
  })

  it("refuses a chat page without a page token or interval, or with a broken message", () => {
    const valid = { nextPageToken: "n", pollingIntervalMillis: 1000 }
    for (const body of [
      { pollingIntervalMillis: 1000 },
      { nextPageToken: "n" },
      { nextPageToken: "n", pollingIntervalMillis: Number.POSITIVE_INFINITY },
      { ...valid, items: [textItem({ authorDetails: { displayName: "@x" } })] },
      {
        ...valid,
        items: [textItem({ snippet: { type: "textMessageEvent", publishedAt: "soon" } })],
      },
      { ...valid, items: [{ snippet: { type: "textMessageEvent" } }] },
    ]) {
      expect(parseChatPage(body)).toEqual(malformed)
    }
    expect(parseChatPage({ ...valid, offlineAt: "2026-11-23T11:00:00Z" })).toMatchObject({
      ok: true,
      value: { offline: true },
    })
  })

  it("names the reason of an API error or an OAuth error, and none for anything else", () => {
    expect(errorReasonOf({ error: { errors: [{ reason: "liveChatEnded" }] } })).toBe(
      "liveChatEnded",
    )
    expect(errorReasonOf({ error: "invalid_grant" })).toBe("invalid_grant")
    expect(errorReasonOf({ error: { errors: [] } })).toBeNull()
    expect(errorReasonOf("oops")).toBeNull()
  })
})
