import type { ResolvedConfig } from "../config.ts"
import { fromBase64 } from "../lib/encoding.ts"
import { errorClass } from "../lib/error-class.ts"
import { PlatformError } from "../platform/errors.ts"
import type { ChatMessage, ChatterRoles } from "../platform/chat-source.ts"
import type { ChatDelivery } from "../platform/provider.ts"
import type { Clock, Instant } from "../ports.ts"
import type { KickChatWatches } from "./chat-watches.ts"
import { chatMessageEvent, type KickClient } from "./kick-client.ts"
import { isRecord, isUserId } from "./lib/parse-response.ts"

export type KickWebhookConfig = Pick<
  ResolvedConfig,
  "kickWebhookMaxAgeSeconds" | "kickPublicKeyRefreshSeconds"
>

export interface KickWebhookDeps {
  readonly key: KickWebhookKey
  readonly watches: Pick<KickChatWatches, "readersOf" | "firstDelivery">
  readonly clock: Clock
  readonly config: KickWebhookConfig
}

/**
 * Answers one Kick webhook: checks the signature and the timestamp, then hands a chat message to the rooms
 * that read its sender, unless the same message id was handed on before. Every check that fails is a 4xx,
 * so only a forged or broken request fails; Kick drops a subscription whose webhook fails for a day.
 */
export async function receiveKickWebhook(
  deps: KickWebhookDeps,
  request: Request,
  deliver: ChatDelivery,
): Promise<Response> {
  const headers = webhookHeaders(request.headers)
  if (headers === null) return status(400)
  const body = await request.text()
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
  let verified: boolean
  try {
    verified = await deps.key.verify(signed, headers.signature)
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    console.warn("kick webhook key unavailable", { errorClass: errorClass(error) })
    return status(503)
  }
  if (!verified) {
    console.warn("kick webhook signature refused", { messageId: headers.messageId })
    return status(401)
  }
  if (
    headers.type !== chatMessageEvent.name
    || headers.version !== String(chatMessageEvent.version)
  ) {
    console.info("kick webhook event ignored", { type: headers.type, version: headers.version })
    return status(204)
  }
  const chat = parseChatEvent(body)
  if (chat === null) {
    console.warn("kick chat event malformed", { messageId: headers.messageId })
    return status(400)
  }
  const readers = await deps.watches.readersOf(chat.broadcasterId, chat.message.platformUserId)
  if (readers.length === 0) return status(204)
  const forgetBefore = now - deps.config.kickWebhookMaxAgeSeconds * 1000
  if (!(await deps.watches.firstDelivery(headers.messageId, now, forgetBefore))) {
    console.info("kick webhook replay dropped", { messageId: headers.messageId })
    return status(204)
  }
  // Each room gets the message on its own: one that fails must not keep it from the others.
  const results = await Promise.allSettled(readers.map((id) => deliver(id, chat.message)))
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn("kick chat delivery failed", {
        giveawayId: readers[index],
        errorClass: errorClass(result.reason),
      })
    }
  })
  return status(204)
}

/**
 * Kick's webhook public key, read from Kick on first use and kept. A signature that fails with the kept
 * key reads the key again, since Kick may rotate it, but not sooner than `kickPublicKeyRefreshSeconds`
 * after the last read.
 */
export class KickWebhookKey {
  private key: Promise<CryptoKey> | null = null
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
  ): Promise<boolean> {
    if (await verifyWith(await this.current(), signed, signature)) return true
    const readAt = this.readAt ?? 0
    if (this.clock.now() - readAt < this.config.kickPublicKeyRefreshSeconds * 1000) return false
    this.key = null
    return verifyWith(await this.current(), signed, signature)
  }

  private current(): Promise<CryptoKey> {
    if (this.key === null) {
      this.readAt = this.clock.now()
      const reading = this.read()
      // A failed read is not kept, so the next webhook tries again.
      reading.catch(() => {
        if (this.key === reading) this.key = null
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
  if (messageId === null || messageId === "" || timestamp === null || signature === null)
    return null
  if (type === null || version === null) return null
  return { messageId, timestamp, signature, type, version }
}

interface ChatEvent {
  readonly broadcasterId: string
  readonly message: ChatMessage
}

/** A `chat.message.sent` body (version 1); `null` for any other shape. */
export function parseChatEvent(body: string): ChatEvent | null {
  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(event) || !isRecord(event.broadcaster) || !isRecord(event.sender)) return null
  const { broadcaster, sender, content } = event
  if (!isUserId(broadcaster.user_id) || !isUserId(sender.user_id)) return null
  if (typeof sender.username !== "string" || typeof content !== "string") return null
  return {
    broadcasterId: String(broadcaster.user_id),
    message: {
      platformUserId: String(sender.user_id),
      login: sender.username.toLowerCase(),
      displayName: sender.username,
      text: content,
      roles: rolesOf(sender.identity),
    },
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

function status(code: 204 | 400 | 401 | 503): Response {
  return new Response(null, { status: code })
}
