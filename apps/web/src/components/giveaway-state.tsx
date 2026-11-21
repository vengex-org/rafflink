import type { ReactNode } from "react"
import type { EntrySummary } from "@rafflink/core/room/rows"
import type { Tone } from "./state-card.tsx"

/**
 * One state of the viewer page as one block. `win` is the lime block of a win moment, `success` the card of a
 * viewer who is in (lime check); the other tones are neutral cards with a soft icon.
 */
export function GiveawayState({
  tone,
  title,
  icon,
  line,
  aside,
  children,
}: {
  readonly tone: Tone
  readonly title: string
  /** The round icon before the title; a win block has none. */
  readonly icon?: ReactNode
  /** A line under the title, such as the prize. */
  readonly line?: string
  /** What sits at the end of the title row, such as the claim clock. */
  readonly aside?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="viewer-state" data-tone={tone}>
      <div className="viewer-state-head">
        {icon === undefined ? null : <span className="viewer-state-icon">{icon}</span>}
        <div className="viewer-state-title">
          <h2>{title}</h2>
          {line === undefined ? null : <p>{line}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** The number is decoration for the eye; the sentence beside it says the same in words. */
export function TicketBox({
  tickets,
  children,
}: {
  readonly tickets: EntrySummary
  readonly children: ReactNode
}) {
  return (
    <div className="viewer-tickets">
      <strong aria-hidden="true">{tickets.tickets}</strong>
      <p>{children}</p>
    </div>
  )
}
