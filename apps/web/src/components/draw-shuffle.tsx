import { useEffect, useState } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"

const flashMs = 90
const reducedMotion = "(prefers-reduced-motion: reduce)"

/**
 * The winner slot while a draw is pending: entrant names flash in it, picked at random on the page and
 * unrelated to the draw. Under reduced motion it shows the countdown to the round instead.
 */
export function DrawShuffle({
  names,
  waitMs,
}: {
  readonly names: readonly string[]
  /** Milliseconds to the committed round, by the room's clock; null before the commit. */
  readonly waitMs: number | null
}) {
  const { t } = useI18n()
  const calm = window.matchMedia(reducedMotion).matches
  return (
    <div className="winner-plate" data-shuffling="true">
      <span className="sr-only">{t("live.draw.due")}</span>
      {calm ? <Countdown waitMs={waitMs} /> : <FlashingName names={names} />}
    </div>
  )
}

function FlashingName({ names }: { readonly names: readonly string[] }) {
  const [name, setName] = useState(() => pickName(names))
  useEffect(() => {
    const timer = setInterval(() => setName(pickName(names)), flashMs)
    return () => clearInterval(timer)
  }, [names])
  return (
    <span className="winner-plate-name" aria-hidden="true">
      {name}
    </span>
  )
}

function Countdown({ waitMs }: { readonly waitMs: number | null }) {
  const remaining = useRemainingMs(waitMs ?? 0)
  return (
    <span className="winner-plate-name" aria-hidden="true">
      {remaining > 0 ? formatClock(remaining) : "…"}
    </span>
  )
}

function pickName(names: readonly string[]): string {
  return names[Math.floor(Math.random() * names.length)] ?? "…"
}
