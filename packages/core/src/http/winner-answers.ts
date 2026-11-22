import type { Giveaway } from "../accounts/account-store.ts"
import {
  winnerFieldKinds,
  type WinnerAnswers,
  type WinnerFieldKind,
} from "../domain/winner-form.ts"
import { openSecret, sealSecret, SealError } from "../lib/seal.ts"
import type { AppDeps } from "./deps.ts"
import type { WinnerAnswersJson } from "./json.ts"

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

/** The form and the claimed picks with their opened answers, as the streamer's live page shows them. */
export async function winnerAnswersJson(
  deps: Pick<AppDeps, "keyRing" | "rooms">,
  giveaway: Giveaway,
): Promise<WinnerAnswersJson> {
  const room = deps.rooms.get(giveaway.id)
  const [picks, sealed] = await Promise.all([room.picks(), room.winnerAnswers()])
  const sealedByPick = new Map(sealed.map((row) => [row.n, row.sealed]))
  const claimed = picks.filter((pick) => pick.claim.state === "claimed")
  return {
    form: giveaway.rules.winnerForm,
    picks: await Promise.all(
      claimed.map(async (pick) => {
        const value = sealedByPick.get(pick.n)
        return {
          n: pick.n,
          answers: pick.answers,
          deliveredAt: pick.deliveredAt,
          values:
            value === undefined ? null : await openWinnerAnswers(deps, giveaway.id, pick.n, value),
        }
      }),
    ),
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
  return answersOf(JSON.parse(plaintext))
}

function answersAad(giveawayId: string, n: number): string {
  return `winner-answers:${giveawayId}:${n}`
}

// The plaintext is what `sealWinnerAnswers` wrote, authenticated by AES-GCM; this only narrows its type.
function answersOf(value: unknown): WinnerAnswers {
  const answers: Partial<Record<WinnerFieldKind, string>> = {}
  if (typeof value !== "object" || value === null) return answers
  for (const kind of winnerFieldKinds) {
    const answer: unknown = Object.hasOwn(value, kind) ? Reflect.get(value, kind) : undefined
    if (typeof answer === "string") answers[kind] = answer
  }
  return answers
}
