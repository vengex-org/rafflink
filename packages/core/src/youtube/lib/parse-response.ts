import type { Parsed } from "../../lib/parsed.ts"
import type { Instant } from "../../ports.ts"

type Malformed = Parsed<never, "malformed">

const malformed: Malformed = { ok: false, issue: "malformed" }

/** Google's token endpoint answer. A refresh answer carries no refresh token: the one sent stays valid. */
export interface GoogleTokens {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresInSeconds: number
}

/** A YouTube channel as `channels.list` answers it with `part=id,snippet`. */
export interface YouTubeChannel {
  readonly id: string
  readonly title: string
  /** The channel's handle with its `@`, such as `@rafflink`; null for a channel that has none. */
  readonly handle: string | null
}

/** One chat message of `liveChatMessages.list` with `part=snippet,authorDetails`. */
export interface YouTubeChatItem {
  readonly authorChannelId: string
  readonly displayName: string
  readonly text: string
  readonly publishedAt: Instant
  readonly isChatSponsor: boolean
  readonly isChatModerator: boolean
  readonly isChatOwner: boolean
}

/** A page of a live chat: its text messages, where the next page starts and when to ask for it. */
export interface YouTubeChatPage {
  readonly items: readonly YouTubeChatItem[]
  readonly nextPageToken: string
  readonly pollingIntervalMillis: number
  /** Set once the chat has ended; the next page would be refused. */
  readonly offline: boolean
}

export function parseGoogleTokens(body: unknown): Parsed<GoogleTokens, "malformed"> {
  if (!isRecord(body)) return malformed
  const {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresInSeconds,
  } = body
  if (typeof accessToken !== "string") return malformed
  if (refreshToken !== undefined && typeof refreshToken !== "string") return malformed
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds)) return malformed
  if (expiresInSeconds <= 0) return malformed
  return {
    ok: true,
    value: { accessToken, refreshToken: refreshToken ?? null, expiresInSeconds },
  }
}

/** The audience (`aud`) of `tokeninfo`: the client the access token was issued to. */
export function parseTokenInfo(body: unknown): Parsed<string, "malformed"> {
  return isRecord(body) && typeof body.aud === "string" ? { ok: true, value: body.aud } : malformed
}

/** The channels of `channels.list`; YouTube leaves `items` out when there are none. */
export function parseChannels(body: unknown): Parsed<readonly YouTubeChannel[], "malformed"> {
  const items = itemsOf(body)
  if (!items.ok) return items
  const channels: YouTubeChannel[] = []
  for (const item of items.value) {
    if (!isRecord(item) || typeof item.id !== "string" || !isRecord(item.snippet)) return malformed
    const { title, customUrl } = item.snippet
    if (typeof title !== "string") return malformed
    if (customUrl !== undefined && typeof customUrl !== "string") return malformed
    channels.push({ id: item.id, title, handle: customUrl ?? null })
  }
  return { ok: true, value: channels }
}

/** The live chat ids of the broadcasts `liveBroadcasts.list` answers; a broadcast without a chat has none. */
export function parseLiveChatIds(body: unknown): Parsed<readonly string[], "malformed"> {
  const items = itemsOf(body)
  if (!items.ok) return items
  const ids: string[] = []
  for (const item of items.value) {
    if (!isRecord(item) || !isRecord(item.snippet)) return malformed
    const { liveChatId } = item.snippet
    if (liveChatId === undefined) continue
    if (typeof liveChatId !== "string") return malformed
    ids.push(liveChatId)
  }
  return { ok: true, value: ids }
}

/** A page of `liveChatMessages.list`; only text messages are kept, every other event type is left out. */
export function parseChatPage(body: unknown): Parsed<YouTubeChatPage, "malformed"> {
  if (!isRecord(body)) return malformed
  const { nextPageToken, pollingIntervalMillis, offlineAt } = body
  if (typeof nextPageToken !== "string") return malformed
  if (typeof pollingIntervalMillis !== "number" || !Number.isFinite(pollingIntervalMillis)) {
    return malformed
  }
  const items = itemsOf(body)
  if (!items.ok) return items
  const messages: YouTubeChatItem[] = []
  for (const item of items.value) {
    const message = chatItem(item)
    if (message === "malformed") return malformed
    if (message !== null) messages.push(message)
  }
  return {
    ok: true,
    value: {
      items: messages,
      nextPageToken,
      pollingIntervalMillis,
      offline: offlineAt !== undefined,
    },
  }
}

/** The first `errors[].reason` of a YouTube API error, or the OAuth `error` code; null when the body has neither. */
export function errorReasonOf(body: unknown): string | null {
  if (!isRecord(body)) return null
  if (typeof body.error === "string") return body.error
  if (!isRecord(body.error) || !Array.isArray(body.error.errors)) return null
  const [first] = body.error.errors
  return isRecord(first) && typeof first.reason === "string" ? first.reason : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Null for an event that is not a text message (a super chat, a membership, a deleted message).
function chatItem(item: unknown): YouTubeChatItem | null | "malformed" {
  if (!isRecord(item) || !isRecord(item.snippet) || !isRecord(item.authorDetails)) {
    return "malformed"
  }
  const { snippet, authorDetails: author } = item
  if (snippet.type !== "textMessageEvent") return null
  const text = isRecord(snippet.textMessageDetails) ? snippet.textMessageDetails.messageText : null
  const publishedAt =
    typeof snippet.publishedAt === "string" ? Date.parse(snippet.publishedAt) : NaN
  if (
    typeof text !== "string"
    || !Number.isFinite(publishedAt)
    || typeof author.channelId !== "string"
    || typeof author.displayName !== "string"
  ) {
    return "malformed"
  }
  return {
    authorChannelId: author.channelId,
    displayName: author.displayName,
    text,
    publishedAt,
    isChatSponsor: author.isChatSponsor === true,
    isChatModerator: author.isChatModerator === true,
    isChatOwner: author.isChatOwner === true,
  }
}

function itemsOf(body: unknown): Parsed<readonly unknown[], "malformed"> {
  if (!isRecord(body)) return malformed
  if (body.items === undefined) return { ok: true, value: [] }
  return Array.isArray(body.items) ? { ok: true, value: body.items } : malformed
}
