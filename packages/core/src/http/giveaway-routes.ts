import { Hono, type Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Giveaway } from "../accounts/account-store.ts"
import type { ClaimOutcome, PublicSummary, WinnerPick } from "../room/giveaway-room.ts"
import type { PollOutcome } from "../queue/token-queue.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"
import type { AppDeps } from "./deps.ts"
import { errorClass } from "../lib/error-class.ts"
import type { PublicGiveaway, ViewerState } from "./json.ts"
import { timingSafeEqual } from "hono/utils/buffer"
import { viewerRoomHeader } from "./viewer-socket.ts"
import { webSocketOrigin } from "./websocket-origin.ts"
import {
  endPendingEntry,
  readPendingEntry,
  readViewerSession,
  startViewerSession,
  type ViewerSession,
} from "./session.ts"

export function giveawayRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.use("/api/g/:code/live", webSocketOrigin(deps.config, { allowMissing: false }))

  // One request per page load. The public part of an anonymous load comes from the cache when it can,
  // so a refresh reads neither the account store nor the room; a load with a viewer cookie is read
  // fresh, because it carries personal state. The response is never cached by a browser or a proxy.
  app.get("/api/g/:code", async (c) => {
    const code = c.req.param("code")
    c.header("Cache-Control", "no-store")
    const session = await readViewerSession(c, deps)
    const key = `${deps.config.publicUrl}/api/g/${encodeURIComponent(code)}`
    if (session === null) {
      const cached = await readPublicCache(deps, key)
      if (cached !== null) return jsonText(c, withViewer(cached, { kind: "signed-out" }))
    }
    const giveaway = await deps.accounts.findGiveawayByCode(code)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const room = deps.rooms.get(giveaway.id)
    const summary = await room.summary()
    const publicText = JSON.stringify(publicGiveaway(deps, giveaway, summary))
    if (session === null) {
      await writePublicCache(deps, key, publicText)
      return jsonText(c, withViewer(publicText, { kind: "signed-out" }))
    }
    const me = await viewerState(deps, giveaway, session, summary)
    return jsonText(c, withViewer(publicText, me))
  })

  // Only decides who may connect and which room the socket belongs to; the target's socket layer
  // sends the outcomes. The answer to the upgrade request never reaches a browser.
  app.get("/api/g/:code/live", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "upgrade-required" }, 426)
    }
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    c.header(viewerRoomHeader, giveaway.id)
    return c.body(null, 204)
  })

  app.get("/api/g/:code/pending/:ticket", async (c) => {
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const ticket = c.req.param("ticket")
    // The ticket travels in the page URL, which a viewer may share; only the queued browser's cookie
    // proves the ticket is theirs. Any other browser gets "dropped" (enter again) and the queued result
    // stays for its owner, so a copied URL cannot take over the entry or its viewer session.
    const pending = await readPendingEntry(c, deps, giveaway)
    if (pending === null || !(await timingSafeEqual(pending.ticket, ticket))) {
      return c.json(pendingOutcome({ kind: "gone" }, ticket))
    }
    const polled = await deps.queue.poll(ticket)
    if (polled.kind === "done") {
      endPendingEntry(c, giveaway)
      if (polled.userId !== null) {
        await startViewerSession(c, deps, { platform: giveaway.platform, userId: polled.userId })
      }
    }
    return c.json(pendingOutcome(polled, ticket))
  })

  app.post("/api/g/:code/claim", async (c) => {
    const session = await readViewerSession(c, deps)
    if (session === null) return c.json({ error: "unauthorized" }, 401)
    const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const pick = await pickOf(deps, giveaway, session)
    if (pick === undefined) return c.json({ kind: "not-a-winner" }, claimStatus["not-a-winner"])
    const outcome = await deps.rooms
      .get(giveaway.id)
      .claim(pick.n, { platform: pick.platform, platformUserId: pick.platformUserId }, "rafflink")
    return c.json({ kind: outcome.kind }, claimStatus[outcome.kind])
  })

  return app
}

const claimStatus: Readonly<Record<ClaimOutcome["kind"], ContentfulStatusCode>> = {
  claimed: 200,
  "already-claimed": 409,
  expired: 409,
  rerolled: 409,
  "not-a-winner": 403,
}

function pendingOutcome(polled: PollOutcome, ticket: string): CallbackOutcome {
  switch (polled.kind) {
    case "waiting":
      return { kind: "pending", ticket }
    case "done":
      return polled.outcome
    case "gone":
      return { kind: "dropped" }
  }
}

// The pick is matched on the cookie's platform too, so only the winner's own platform account claims.
async function pickOf(
  deps: AppDeps,
  giveaway: Giveaway,
  session: ViewerSession,
): Promise<WinnerPick | undefined> {
  const picks = await deps.rooms.get(giveaway.id).picks()
  return picks.find(
    (pick) => pick.platform === session.platform && pick.platformUserId === session.userId,
  )
}

function publicGiveaway(deps: AppDeps, giveaway: Giveaway, summary: PublicSummary): PublicGiveaway {
  return {
    code: giveaway.code,
    title: giveaway.title,
    prize: giveaway.prize,
    streamerName: giveaway.streamerName,
    rules: giveaway.rules,
    status: summary.status,
    closesAt: summary.closesAt,
    claimSeconds: giveaway.claimSeconds,
    entrantCount: summary.entrantCount,
    finished: summary.finished,
    poll: {
      intervalMs: deps.config.queuePollSeconds * 1000,
      maxMs: deps.config.queuePollMaxSeconds * 1000,
    },
  }
}

// A cache that fails is a cache that missed: the page still loads from the account store and the room.
async function readPublicCache(deps: AppDeps, key: string): Promise<string | null> {
  if (deps.config.publicGiveawayCacheSeconds === 0) return null
  try {
    return await deps.publicCache.read(key)
  } catch (error) {
    console.warn("public cache read failed", { errorClass: errorClass(error) })
    return null
  }
}

async function writePublicCache(deps: AppDeps, key: string, text: string): Promise<void> {
  if (deps.config.publicGiveawayCacheSeconds === 0) return
  try {
    await deps.publicCache.write(key, text, deps.config.publicGiveawayCacheSeconds)
  } catch (error) {
    console.warn("public cache write failed", { errorClass: errorClass(error) })
  }
}

// `publicText` is the JSON of an object this module wrote, so its last character closes that object.
function withViewer(publicText: string, me: ViewerState): string {
  return `${publicText.slice(0, -1)},"me":${JSON.stringify(me)}}`
}

function jsonText(c: Context, text: string): Response {
  return c.body(text, 200, { "Content-Type": "application/json" })
}

async function viewerState(
  deps: AppDeps,
  giveaway: Giveaway,
  session: ViewerSession,
  summary: PublicSummary,
): Promise<ViewerState> {
  const room = deps.rooms.get(giveaway.id)
  const entry = await room.entryOf({ platform: session.platform, platformUserId: session.userId })
  if (summary.status === "drawn") {
    const pick = await pickOf(deps, giveaway, session)
    if (pick !== undefined) {
      if (entry === null) throw new Error("winner has no entry")
      return {
        kind: "won",
        userId: session.userId,
        n: pick.n,
        tickets: entry.tickets,
        group: entry.group,
        claimRemainingMs: Math.max(0, pick.claimUntil - deps.clock.now()),
        claim: pick.claim,
        chatClaimAvailable: !summary.chatClaimUnavailable,
      }
    }
  }
  if (entry === null) return { kind: "not-entered", userId: session.userId }
  return summary.status === "drawn"
    ? { kind: "not-won", userId: session.userId }
    : { kind: "entered", userId: session.userId, entry }
}
