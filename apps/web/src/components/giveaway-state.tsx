import type { ReactNode } from "react"
import type { EntrySummary } from "@rafflink/core/room/rows"
import { useI18n } from "../i18n/i18n.tsx"
import type { Tone } from "./state-card.tsx"

/**
 * One state of the viewer page as one block. `win` is the lime block of a win moment, `success` the card of a
 * viewer who is in (lime check); the other tones are neutral cards with a soft icon.
 */
export function GiveawayState({
  tone,
  title,
  icon,
  spokenLine,
  aside,
  children,
}: {
  readonly tone: Tone
  readonly title: string
  /** The round icon before the title; a win block has none. */
  readonly icon?: ReactNode
  /** A line under the title only screen readers hear, such as the prize the page heading already shows. */
  readonly spokenLine?: string
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
          {spokenLine === undefined ? null : <p className="sr-only">{spokenLine}</p>}
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
}: {
  readonly tickets: Pick<EntrySummary, "tickets" | "group">
}) {
  const i18n = useI18n()
  return (
    <div className="viewer-tickets">
      <strong aria-hidden="true">{tickets.tickets}</strong>
      <p>
        {i18n.t("entry.in.tickets", {
          tickets: i18n.plural("ticket", tickets.tickets),
          role: i18n.t(`entry.role.${tickets.group}`),
        })}
      </p>
    </div>
  )
}
