import type { ReactNode } from "react"
import { Link } from "react-router"
import type { LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import type { GiveawayView } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { shareUrl } from "../lib/links.ts"
import { giveawayDisplayName } from "../lib/messages.ts"
import { StatusPill } from "./live-parts.tsx"

/** The live page's own frame: a skip link, the top bar that `bar` fills, and the main landmark. The page shows on stream, so it has no shared app bar. */
export function LiveFrame({
  bar,
  children,
}: {
  readonly bar: ReactNode
  readonly children: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="live-frame">
      <a href="#main" className="skip-link">
        {t("nav.skip")}
      </a>
      <header className="live-top">{bar}</header>
      <main id="main">{children}</main>
    </div>
  )
}

export function LiveBrand() {
  return (
    <Link to="/" className="live-brand">
      <span className="live-mark" aria-hidden="true">
        <b>R</b>
      </span>
      Rafflink
    </Link>
  )
}

/** The brand, what is given away, how to enter, how many did, and whether entries are open. */
export function LiveTopBar({
  snapshot,
  facts,
}: {
  readonly snapshot: LiveSnapshot
  readonly facts: GiveawayView | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <>
      <LiveBrand />
      <span className="live-sep" aria-hidden="true" />
      <div className="live-title">
        <h1>
          {giveawayDisplayName(i18n, {
            title: snapshot.title,
            prize: facts?.prize ?? null,
            code: snapshot.code,
          })}
        </h1>
        {facts === null || facts.prize === null ? null : (
          <p>{t("live.gives", { streamer: facts.streamerName, prize: facts.prize })}</p>
        )}
      </div>
      <div className="live-link-chip">
        <span>{t("live.enterAt")}</span>
        <span className="live-link">
          {new URL(shareUrl(snapshot.code)).host}/<em>{snapshot.code}</em>
        </span>
      </div>
      <div className="live-count">
        <strong>{i18n.number(snapshot.entrantCount)}</strong>
        <span>{t("live.entered")}</span>
      </div>
      {snapshot.status === "open" ? (
        <span className="live-chip">{t("live.chip")}</span>
      ) : (
        <StatusPill status={snapshot.status} />
      )}
    </>
  )
}
