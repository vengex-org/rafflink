import type { ResolvedConfig } from "../config.ts"
import { fromBase64 } from "../lib/encoding.ts"
import { errorClass } from "../lib/error-class.ts"
import { PlatformError } from "../platform/errors.ts"
import type {
  ChannelEntryEvent,
  ChannelViewer,
  ChatMessage,
  ChatterRoles,
} from "../platform/chat-source.ts"
import type { WebhookDelivery } from "../platform/provider.ts"
import type { Clock, Instant } from "../ports.ts"
import type { ChannelReaders, KickChatWatches } from "./chat-watches.ts"
import { kickEvents, type KickClient, type KickEvent } from "./kick-client.ts"
import { isRecord, isUserId } from "./lib/parse-response.ts"

export type KickWebhookConfig = Pick<
  ResolvedConfig,
  "kickWebhookMaxAgeSeconds" | "kickPublicKeyRefreshSeconds" | "kickOrphanRetrySeconds"
>

export interface KickWebhookDeps {
  readonly key: KickWebhookKey
  readonly orphans: KickOrphanSubscriptions
  readonly watches: Pick<KickChatWatches, "chatReaders" | "channelEntryReaders" | "firstDelivery">
  readonly clock: Clock
  readonly config: KickWebhookConfig
}

/**
 * Answers one Kick webhook: checks the signature and the timestamp, then hands a chat message, the
 * subscriptions or a redemption to the rooms that read them, unless the same message id was handed on
 * before. A check that fails is a 4xx, so only a forged or broken request fails, except a 503 while
 * Kick's key cannot be read or may have just rotated, which Kick sends again. Kick drops a subscription
 * whose webhook fails for a day. An event of a channel no room watches cancels the subscription it came by.
 */
export async function receiveKickWebhook(
  deps: KickWebhookDeps,
  request: Request,
  deliver: WebhookDelivery,
): Promise<Response> {
  const headers = webhookHeaders(request.headers)
  if (headers === null) return status(400)
  const declaredLength = Number(request.headers.get("content-length") ?? 0)
  if (declaredLength > maxBodyBytes) return status(413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > maxBodyBytes) return status(413)
  const body = new TextDecoder().decode(bytes)
  const now = deps.clock.now()
  const sentAt = Date.parse(headers.timestamp)
  if (!Number.isFinite(sentAt)) return status(400)
  if (Math.abs(now - sentAt) > deps.config.kickWebhookMaxAgeSeconds * 1000) {
    console.warn("kick webhook outside the time window", { messageId: headers.messageId })
    return status(401)
  }
  // Copied so the bytes sit in a plain ArrayBuffer, which the Workers types require for `subtle.verify`.
  const signed = new Uint8Array(
    new TextEncoder().encode(`${headers.messageId}.${headers.timestamp}.${body}`),
  )
  let verdict: KeyVerdict
  try {
    verdict = await deps.key.verify(signed, headers.signature)
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    console.warn("kick webhook key unavailable", { errorClass: errorClass(error) })
    return status(503)
  }
  if (verdict !== "valid") {
    console.warn("kick webhook signature refused", { messageId: headers.messageId, verdict })
    // Kick may have rotated its key since the last read; it sends a webhook again after a 5xx.
    return status(verdict === "key-pending" ? 503 : 401)
  }
  const event = kickEvents.find(
    (candidate) => candidate.name === headers.type && String(candidate.version) === headers.version,
  )
  if (event === undefined) {
    console.info("kick webhook event ignored", { type: headers.type, version: headers.version })
    return status(204)
  }
  const parsed = parseKickEvent(event, body)
  if (parsed === null) {
    console.warn("kick webhook event malformed", { messageId: headers.messageId, type: event.name })
    return status(400)
  }
  if (parsed.kind === "ignored") return status(204)
  const { watched, readers } = await readersOf(deps, parsed)
  if (!watched) {
    await deps.orphans.cancel(headers.subscriptionId)
    return status(204)
  }
  if (readers.length === 0) return status(204)
  const forgetBefore = now - deps.config.kickWebhookMaxAgeSeconds * 1000
  if (!(await deps.watches.firstDelivery(headers.messageId, now, forgetBefore))) {
    console.info("kick webhook replay dropped", { messageId: headers.messageId })
    return status(204)
  }
  // Each room gets the event on its own: one that fails must not keep it from the others.
  const results = await Promise.allSettled(
    readers.map((id) =>
      parsed.kind === "chat"
        ? deliver.chat(id, parsed.message)
        : deliver.channelEntries(id, parsed.events),
    ),
  )
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn("kick webhook delivery failed", {
        giveawayId: readers[index],
        type: event.name,
        errorClass: errorClass(result.reason),
      })
    }
  })
  return status(204)
}

// The events of one webhook are of one channel and one kind, and a redemption's of one reward, so the first tells the readers of all.
function readersOf(
  deps: KickWebhookDeps,
  parsed: ChatEvent | ChannelEntries,
): Promise<ChannelReaders> {
  if (parsed.kind === "chat") {
    return deps.watches.chatReaders(
      parsed.broadcasterId,
      parsed.message.platformUserId,
      parsed.message.text,
    )
  }
  return deps.watches.channelEntryReaders(parsed.broadcasterId, parsed.events[0])
}

/**
 * Cancels the subscriptions whose webhooks find no watch: one left over when Kick did not answer the
 * delete, or made by a room that could not store it. Each subscription is tried at most once per
 * `kickOrphanRetrySeconds` in this process, so a busy chat does not send a delete per message.
 */
export class KickOrphanSubscriptions {
  private readonly triedAt = new Map<string, Instant>()

  constructor(
    private readonly client: Pick<KickClient, "unsubscribe">,
    private readonly watches: Pick<KickChatWatches, "forgetSubscription">,
    private readonly clock: Clock,
    private readonly config: Pick<ResolvedConfig, "kickOrphanRetrySeconds">,
  ) {}

  async cancel(subscriptionId: string): Promise<void> {
    const now = this.clock.now()
    const last = this.triedAt.get(subscriptionId)
    if (last !== undefined && now - last < this.config.kickOrphanRetrySeconds * 1000) return
    this.triedAt.set(subscriptionId, now)
    try {
      await this.client.unsubscribe(subscriptionId)
      await this.watches.forgetSubscription(subscriptionId)
      console.info("kick orphan subscription cancelled", { subscriptionId })
    } catch (error) {
      console.warn("kick orphan subscription cancel failed", {
        subscriptionId,
        errorClass: errorClass(error),
      })
    }
  }
}

/** `key-pending`: the signature fails, but the key was read too recently to read it again, so Kick may have rotated it since. */
export type KeyVerdict = "valid" | "invalid" | "key-pending"

/**
 * Kick's webhook public key, read from Kick on first use and kept. A signature that fails with the kept
 * key reads the key again, since Kick may rotate it, but not sooner than `kickPublicKeyRefreshSeconds`
 * after the last read; a read that failed is not repeated sooner either.
 */
export class KickWebhookKey {
  private key: Promise<CryptoKey> | null = null
  private failed = false
  private readAt: Instant | null = null

  constructor(
    private readonly client: Pick<KickClient, "publicKey">,
    private readonly clock: Clock,
    private readonly config: Pick<ResolvedConfig, "kickPublicKeyRefreshSeconds">,
  ) {}

  /** Whether Kick's private key signed `signed`; throws a `PlatformError` when the key cannot be read. */
  async verify(
    signed: Uint8Array<ArrayBuffer>,
    signature: Uint8Array<ArrayBuffer>,
  ): Promise<KeyVerdict> {
    if (await verifyWith(await this.current(), signed, signature)) return "valid"
    if (this.readRecently()) return "key-pending"
    this.key = null
    return (await verifyWith(await this.current(), signed, signature)) ? "valid" : "invalid"
  }

  private readRecently(): boolean {
    const readAt = this.readAt ?? Number.NEGATIVE_INFINITY
    return this.clock.now() - readAt < this.config.kickPublicKeyRefreshSeconds * 1000
  }

  private current(): Promise<CryptoKey> {
    if (this.key === null || (this.failed && !this.readRecently())) {
      this.readAt = this.clock.now()
      this.failed = false
      const reading = this.read()
      reading.catch(() => {
        if (this.key === reading) this.failed = true
      })
      this.key = reading
    }
    return this.key
  }

  private async read(): Promise<CryptoKey> {
    const pem = await this.client.publicKey()
    const der = fromBase64(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""))
    if (der === null) throw new TypeError("Kick's public key is not base64 PEM")
    return crypto.subtle.importKey("spki", der, signatureAlgorithm, false, ["verify"])
  }
}

// A chat message body is a few kilobytes; a larger one is not Kick's and is not read further.
const maxBodyBytes = 65_536

// Kick signs with RSA PKCS#1 v1.5 over SHA-256 (docs.kick.com, webhook security).
const signatureAlgorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const

function verifyWith(
  key: CryptoKey,
  signed: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  return crypto.subtle.verify(signatureAlgorithm, key, signature, signed)
}

interface WebhookHeaders {
  readonly messageId: string
  readonly subscriptionId: string
  readonly timestamp: string
  readonly signature: Uint8Array<ArrayBuffer>
  readonly type: string
  readonly version: string
}

function webhookHeaders(headers: Headers): WebhookHeaders | null {
  const messageId = headers.get("kick-event-message-id")
  const timestamp = headers.get("kick-event-message-timestamp")
  const signature = fromBase64(headers.get("kick-event-signature") ?? "")
  const type = headers.get("kick-event-type")
  const version = headers.get("kick-event-version")
  const subscriptionId = headers.get("kick-event-subscription-id")
  if (messageId === null || messageId === "" || timestamp === null || signature === null)
    return null
  if (type === null || version === null || subscriptionId === null || subscriptionId === "") {
    return null
  }
  return { messageId, subscriptionId, timestamp, signature, type, version }
}

interface ChatEvent {
  readonly kind: "chat"
  readonly broadcasterId: string
  readonly message: ChatMessage
}

interface ChannelEntries {
  readonly kind: "channel-entries"
  readonly broadcasterId: string
  readonly events: readonly [ChannelEntryEvent, ...ChannelEntryEvent[]]
}

/** A well-formed event that enters nobody: a redemption the streamer rejected, or a gift with no recipient. */
interface IgnoredEvent {
  readonly kind: "ignored"
}

/**
 * The body of one of {@link kickEvents} (each version 1); `null` for any other shape. Kick has one
 * subscriber level, read as tier 1, and names no tier in its events. A gift enters its recipients, not
 * the gifter. A redemption enters while pending or accepted; one the streamer rejected enters nobody.
 */
export function parseKickEvent(
  event: KickEvent,
  body: string,
): ChatEvent | ChannelEntries | IgnoredEvent | null {
  const json = parseJson(body)
  if (!isRecord(json) || !isRecord(json.broadcaster) || !isUserId(json.broadcaster.user_id)) {
    return null
  }
  const broadcasterId = String(json.broadcaster.user_id)
  switch (event.name) {
    case "chat.message.sent": {
      const sender = viewerOf(json.sender)
      if (sender === null || !isRecord(json.sender) || typeof json.content !== "string") return null
      return {
        kind: "chat",
        broadcasterId,
        message: { ...sender, text: json.content, roles: rolesOf(json.sender.identity) },
      }
    }
    case "channel.subscription.new":
    case "channel.subscription.renewal":
      return subscriptions(broadcasterId, [json.subscriber])
    case "channel.subscription.gifts":
      return Array.isArray(json.giftees) ? subscriptions(broadcasterId, json.giftees) : null
    case "channel.reward.redemption.updated": {
      const redeemer = viewerOf(json.redeemer)
      const rewardId = isRecord(json.reward) ? json.reward.id : null
      if (redeemer === null || typeof rewardId !== "string") return null
      switch (json.status) {
        case "pending":
        case "accepted":
          return {
            kind: "channel-entries",
            broadcasterId,
            events: [{ via: "points", viewer: redeemer, rewardId }],
          }
        case "rejected":
          return { kind: "ignored" }
        default:
          return null
      }
    }
  }
}

function subscriptions(
  broadcasterId: string,
  users: readonly unknown[],
): ChannelEntries | IgnoredEvent | null {
  const events: ChannelEntryEvent[] = []
  for (const user of users) {
    const viewer = viewerOf(user)
    if (viewer === null) return null
    events.push({ via: "sub", viewer, subTier: 1 })
  }
  const [first, ...rest] = events
  return first === undefined
    ? { kind: "ignored" }
    : { kind: "channel-entries", broadcasterId, events: [first, ...rest] }
}

function viewerOf(user: unknown): ChannelViewer | null {
  if (!isRecord(user) || !isUserId(user.user_id) || typeof user.username !== "string") return null
  return {
    platformUserId: String(user.user_id),
    login: user.username.toLowerCase(),
    displayName: user.username,
  }
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

// Kick has one subscriber level, read as tier 1; a badge list Kick left out or changed reads as no role.
function rolesOf(identity: unknown): ChatterRoles {
  const badges =
    isRecord(identity) && Array.isArray(identity.badges)
      ? identity.badges.flatMap((badge) =>
          isRecord(badge) && typeof badge.type === "string" ? [badge.type] : [],
        )
      : []
  return {
    subTier: badges.includes("subscriber") ? 1 : null,
    isVip: badges.includes("vip"),
    isModerator: badges.includes("moderator"),
  }
}

function status(code: 204 | 400 | 401 | 413 | 503): Response {
  return new Response(null, { status: code })
}
