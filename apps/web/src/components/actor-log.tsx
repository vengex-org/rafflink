import { useId } from "react"
import { actorLinkId, type Actor } from "@rafflink/core/domain/actor"
import type { ActionActors } from "@rafflink/core/room/giveaway-room"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { linkName } from "./moderator-links.tsx"

/**
 * Who closed entries, drew, replaced and marked each winner, once a moderator link did any of it: the
 * streamer and the moderators then see whose button it was. Actions the room did by itself are left out.
 */
export function ActorLog({ actors }: { readonly actors: ActionActors }) {
  const { t } = useI18n()
  const headId = useId()
  const lines = actorLines(actors)
  if (!lines.some((line) => line.who !== "streamer")) return null
  return (
    <section className="live-card live-actors" aria-labelledby={headId}>
      <h2 id={headId}>{t("live.actors.title")}</h2>
      <ul>
        {lines.map((line) => (
          <li key={`${line.key}-${line.n}`}>
            {t(line.key, { n: line.n + 1, who: actorName(line.who, t) })}
          </li>
        ))}
      </ul>
    </section>
  )
}

interface ActorLine {
  readonly key: MessageKey
  /** The pick the line is about, from 0; -1 for the close. */
  readonly n: number
  readonly who: Actor
}

function actorLines(actors: ActionActors): ActorLine[] {
  const lines: ActorLine[] = []
  if (actors.closedBy !== null)
    lines.push({ key: "live.actors.closed", n: -1, who: actors.closedBy })
  for (const pick of actors.picks) {
    if (pick.drawnBy !== null)
      lines.push({ key: "live.actors.drawn", n: pick.n, who: pick.drawnBy })
    if (pick.rerolledBy !== null) {
      lines.push({ key: "live.actors.rerolled", n: pick.n, who: pick.rerolledBy })
    }
    if (pick.claimMarkedBy !== null) {
      lines.push({ key: "live.actors.marked", n: pick.n, who: pick.claimMarkedBy })
    }
  }
  return lines
}

function actorName(actor: Actor, t: I18n["t"]): string {
  const linkId = actorLinkId(actor)
  return linkId === null
    ? t("live.actors.streamer")
    : t("live.actors.moderator", { id: linkName(linkId) })
}
