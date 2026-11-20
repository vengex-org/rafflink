import { useEffect } from "react"
import { useParams } from "react-router"
import { overlaySnapshotPath, parseOverlaySnapshot } from "../api/client.ts"
import { ActivityIcon, UsersIcon } from "../components/icons.tsx"
import { EntrantNames, Stat, WinnerList } from "../components/live-parts.tsx"
import { Failed, Loading, NotFound } from "../components/notice.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { giveawayName } from "../lib/messages.ts"
import { useLive } from "../lib/use-live.ts"

/** The read-only live view for an OBS browser source: no session, a transparent background. */
export function OverlayPage() {
  const { id, token } = useParams()
  useEffect(() => {
    document.documentElement.dataset.surface = "overlay"
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [])
  return id === undefined || token === undefined ? (
    <NotFound title="notFound.generic" />
  ) : (
    <Loaded id={id} token={token} />
  )
}

function Loaded({ id, token }: { readonly id: string; readonly token: string }) {
  const i18n = useI18n()
  const { t } = i18n
  const live = useLive(overlaySnapshotPath(id, token), parseOverlaySnapshot)
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
    case "not-found":
      return <NotFound title="notFound.generic" />
    case "ready": {
      const { snapshot } = live
      return (
        <main className="overlay">
          <h1>{giveawayName(i18n, snapshot.title, snapshot.code)}</h1>
          <p className="overlay-code">{t("overlay.code", { code: snapshot.code })}</p>
          <dl className="stats">
            <Stat
              icon={<UsersIcon />}
              value={i18n.number(snapshot.entrantCount)}
              label={t("stat.people")}
            />
            <Stat
              icon={<ActivityIcon />}
              value={i18n.decimal(snapshot.entriesPerSecond)}
              label={t("stat.perSecond")}
            />
          </dl>
          <h2>{t("entrants.latest")}</h2>
          <EntrantNames names={snapshot.lastNames} />
          {snapshot.winners.length === 0 ? null : (
            <>
              <h2>{t("overlay.winners")}</h2>
              <WinnerList winners={snapshot.winners} actions={null} />
            </>
          )}
        </main>
      )
    }
  }
}
