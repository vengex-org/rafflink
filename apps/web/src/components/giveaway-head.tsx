import type { GiveawayView } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { initialsOf } from "../lib/initials.ts"
import { giveawayName } from "../lib/messages.ts"
import { peopleText } from "../lib/rules-text.ts"
import { LockIcon, TrophyIcon } from "./icons.tsx"

/** The streamer's avatar, the giveaway title and the prize as the page headline; every state shows it. A preview inside another page passes `h2`. */
export function GiveawayHead({
  giveaway,
  as: Heading,
}: {
  readonly giveaway: GiveawayView
  readonly as: "h1" | "h2"
}) {
  const i18n = useI18n()
  const name = giveawayName(i18n, giveaway.title, giveaway.code)
  const byline =
    giveaway.prize === null ? giveaway.streamerName : `${giveaway.streamerName}, ${name}`
  return (
    <header className="viewer-head">
      <span className="viewer-host" aria-hidden="true">
        {initialsOf(giveaway.streamerName)}
      </span>
      <div>
        <p>{byline}</p>
        <Heading>{giveaway.prize ?? name}</Heading>
      </div>
    </header>
  )
}

/** Whether entries are open, with how many people are in. */
export function GiveawayPhase({ giveaway }: { readonly giveaway: GiveawayView }) {
  const i18n = useI18n()
  return (
    <div className="viewer-phase">
      <span className="viewer-phase-status">
        <PhaseMark status={giveaway.status} />
        {i18n.t(`giveaway.phase.${giveaway.status}`)}
      </span>
      <span>{peopleText(i18n, giveaway.entrantCount)}</span>
    </div>
  )
}

function PhaseMark({ status }: { readonly status: GiveawayView["status"] }) {
  switch (status) {
    case "open":
      return <span className="viewer-live-dot" aria-hidden="true" />
    case "closed":
      return <LockIcon />
    case "drawn":
      return <TrophyIcon />
  }
}
