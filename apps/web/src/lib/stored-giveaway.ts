import { errorClass } from "@rafflink/core/lib/error-class"
import { ApiShapeError, record, type Json } from "../api/decode.ts"
import {
  getGiveaway,
  giveawayLoadJson,
  parseGiveawayLoad,
  type GiveawayLoad,
} from "../api/client.ts"
import { readSessionStored, removeSessionStored, writeSessionStored } from "./safe-storage.ts"

// A reload inside this window shows the stored answer and asks the server nothing but the socket; starting guess, kept short because the socket keeps the page fresh and the window only has to cover a refresh habit.
export const storedGiveawayWindowMs = 30_000

const keyOf = (code: string) => `rafflink:giveaway:${code}`

/**
 * The giveaway page's load. With `allowStored` a copy younger than the window is used and the server
 * is not asked; a fresh answer is stored for the next reload.
 */
export async function loadGiveaway(
  code: string,
  allowStored: boolean,
): Promise<GiveawayLoad | null> {
  const stored = allowStored ? readStoredGiveaway(code, Date.now()) : null
  if (stored !== null) return stored
  const fresh = await getGiveaway(code)
  if (fresh !== null) {
    writeSessionStored(
      keyOf(code),
      JSON.stringify({ at: Date.now(), load: giveawayLoadJson(fresh) }),
    )
  }
  return fresh
}

/** Drops the stored copy: what it says about the viewer is out of date after an enter or a claim. */
export function forgetStoredGiveaway(code: string): void {
  removeSessionStored(keyOf(code))
}

function readStoredGiveaway(code: string, now: number): GiveawayLoad | null {
  const raw = readSessionStored(keyOf(code))
  if (raw === null) return null
  try {
    const stored = record(JSON.parse(raw), "stored")
    const at = storedTime(stored)
    if (now - at > storedGiveawayWindowMs || now < at) return null
    const load = parseGiveawayLoad(record(JSON.parse(storedText(stored)), "stored load"))
    return { giveaway: load.giveaway, me: ageClaim(load.me, now - at) }
  } catch (error) {
    if (!(error instanceof ApiShapeError || error instanceof SyntaxError)) throw error
    console.warn("stored giveaway ignored", { errorClass: errorClass(error) })
    return null
  }
}

function storedTime(stored: Json): number {
  const value = stored.at
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiShapeError("at")
  return value
}

function storedText(stored: Json): string {
  const value = stored.load
  if (typeof value !== "string") throw new ApiShapeError("load")
  return value
}

// The claim time left was measured when the answer arrived.
function ageClaim(me: GiveawayLoad["me"], ageMs: number): GiveawayLoad["me"] {
  return me.kind === "won"
    ? { ...me, claimRemainingMs: Math.max(0, me.claimRemainingMs - ageMs) }
    : me
}
