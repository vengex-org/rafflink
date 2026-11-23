import type { PublicHistoryJson } from "@rafflink/core/http/json"
import { useCallback } from "react"
import { Link, useParams } from "react-router"
import { getPublicHistory } from "../api/client.ts"
import { CheckCircleIcon } from "../components/icons.tsx"
import { Failed, Loading, NotFound } from "../components/notice.tsx"
import { Page } from "../components/page.tsx"
import { RunYourOwn } from "../components/run-your-own.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { giveawayDisplayName } from "../lib/messages.ts"
import { verifyPath } from "../lib/routes.ts"
import { useLoad } from "../lib/use-load.ts"

/** A streamer's drawn giveaways, newest first, each with a link to the check of its draw; only when the streamer turned the page on. */
export function HistoryPage() {
  const { platform = "", login = "" } = useParams()
  const load = useCallback(() => getPublicHistory(platform, login), [platform, login])
  const { result, reload } = useLoad(load)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return result.value === null ? (
        <NotFound title="notFound.history" />
      ) : (
        <History history={result.value} />
      )
  }
}

function History({ history }: { readonly history: PublicHistoryJson }) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <Page width="text" as="article" className="history">
      <header>
        <h1>{t("history.title", { name: history.streamer.displayName })}</h1>
        <p>{t("history.intro")}</p>
      </header>
      {history.giveaways.length === 0 ? (
        <p className="muted">{t("history.none")}</p>
      ) : (
        <ul className="history-list">
          {history.giveaways.map((giveaway) => {
            const name = giveawayDisplayName(i18n, giveaway)
            // An untitled giveaway is already named by its prize, so the prize line would repeat it.
            const prizeLine = giveaway.title === null ? null : giveaway.prize
            return (
              <li key={giveaway.code} className="card">
                <h2>{name}</h2>
                {prizeLine === null ? null : <p>{t("dash.prize", { prize: prizeLine })}</p>}
                <p className="muted">
                  {t("history.closed", { date: i18n.date(giveaway.closedAt) })}
                  {" · "}
                  {i18n.plural("entered", giveaway.entrantCount)}
                  {" · "}
                  {i18n.plural("winners", giveaway.winners)}
                </p>
                <Link
                  className="button text"
                  to={verifyPath(giveaway.code)}
                  aria-label={t("history.verify.label", { name })}
                >
                  <CheckCircleIcon />
                  {t("history.verify")}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <RunYourOwn />
    </Page>
  )
}
