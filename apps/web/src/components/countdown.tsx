import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"
import type { Tone } from "./state-card.tsx"

type ClaimTone = Extract<Tone, "info" | "warning" | "danger">

const claimWarningBelowMs = 15_000
const claimDangerBelowMs = 5_000

const toneLabel: Readonly<Record<ClaimTone, MessageKey>> = {
  info: "claim.tone.info",
  warning: "claim.tone.warning",
  danger: "claim.tone.danger",
}

/** How urgent a claim with `ms` left is; the text label and the color both follow it. */
export function claimTone(ms: number): ClaimTone {
  if (ms < claimDangerBelowMs) return "danger"
  if (ms < claimWarningBelowMs) return "warning"
  return "info"
}

/** The claim clock counted down from what the server computed, with words for how urgent it is. */
export function Countdown({ initialMs }: { readonly initialMs: number }) {
  const { t } = useI18n()
  const remaining = useRemainingMs(initialMs)
  const tone = claimTone(remaining)
  return (
    <span className="countdown" data-tone={tone}>
      <span role="timer">{formatClock(remaining)}</span>{" "}
      <span className="countdown-label">{t(toneLabel[tone])}</span>
    </span>
  )
}
