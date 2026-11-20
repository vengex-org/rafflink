import type { ReactNode } from "react"
import type { Tone } from "./state-card.tsx"

/** A state in words behind a dot of its tone, so the color is never the only signal. */
export function StatusChip({
  tone,
  children,
}: {
  readonly tone: Tone
  readonly children: ReactNode
}) {
  return (
    <span className="status-chip" data-tone={tone}>
      <span className="status-chip-dot" aria-hidden="true" />
      {children}
    </span>
  )
}
