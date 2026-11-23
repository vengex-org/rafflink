import type { Giveaway } from "../accounts/account-store.ts"
import { winnerAnswersOf, type WinnerAnswers } from "../domain/winner-form.ts"
import { openSecret, sealSecret, SealError } from "../lib/seal.ts"
import type { AppDeps } from "./deps.ts"
import type { PickAnswersJson, WinnerAnswersJson } from "./json.ts"

type SealDeps = Pick<AppDeps, "keyRing" | "random">

/** Seals a winner's answers to their giveaway and pick: a sealed value copied to another pick fails to open. */
export function sealWinnerAnswers(
  deps: SealDeps,
  giveawayId: string,
  n: number,
  answers: WinnerAnswers,
): Promise<string> {
  return sealSecret(deps.keyRing, JSON.stringify(answers), answersAad(giveawayId, n), deps.random)
}

/** The form and the claimed picks with whether their answers are held, as the streamer's live page lists them. */
export async function winnerAnswersJson(
  deps: Pick<AppDeps, "rooms">,
  giveaway: Giveaway,
): Promise<WinnerAnswersJson> {
  const room = deps.rooms.get(giveaway.id)
  const [picks, sealed] = await Promise.all([room.picks(), room.winnerAnswers()])
  const held = new Set(sealed.map((row) => row.n))
  return {
    form: giveaway.rules.winnerForm,
    picks: picks
      .filter((pick) => pick.claim.state === "claimed")
      .map((pick) => ({
        n: pick.n,
        answers: pick.answers,
        deliveredAt: pick.deliveredAt,
        held: held.has(pick.n),
      })),
  }
}

/** The opened answers of claimed pick `n`, which the streamer asked to see; null when `n` is no claimed pick. */
export async function pickAnswersJson(
  deps: Pick<AppDeps, "keyRing" | "rooms">,
  giveaway: Giveaway,
  n: number,
): Promise<PickAnswersJson | null> {
  const room = deps.rooms.get(giveaway.id)
  const [picks, sealed] = await Promise.all([room.picks(), room.winnerAnswers()])
  if (!picks.some((pick) => pick.n === n && pick.claim.state === "claimed")) return null
  const value = sealed.find((row) => row.n === n)?.sealed
  return {
    values: value === undefined ? null : await openWinnerAnswers(deps, giveaway.id, n, value),
  }
}

// Null, logged without the value, when no key of the ring opens them any more.
async function openWinnerAnswers(
  deps: Pick<AppDeps, "keyRing">,
  giveawayId: string,
  n: number,
  sealed: string,
): Promise<WinnerAnswers | null> {
  let plaintext: string
  try {
    plaintext = await openSecret(deps.keyRing, sealed, answersAad(giveawayId, n))
  } catch (error) {
    if (!(error instanceof SealError)) throw error
    console.warn("winner answers unreadable", { giveawayId, n, reason: error.reason })
    return null
  }
  // The plaintext is what `sealWinnerAnswers` wrote, authenticated by AES-GCM; this only narrows its type.
  return winnerAnswersOf(JSON.parse(plaintext))
}

function answersAad(giveawayId: string, n: number): string {
  return `winner-answers:${giveawayId}:${n}`
}
