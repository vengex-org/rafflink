import { useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { everyCapability } from "@rafflink/core/platform/provider"
import { Disclosure } from "../components/disclosure.tsx"
import { ActivityIcon, ArrowLeftIcon, CheckIcon, TvIcon } from "../components/icons.tsx"
import { Loading, NotFound, SignIn } from "../components/notice.tsx"
import { Page } from "../components/page.tsx"
import { ObsStepList, OverlayLink, ShareLinks } from "../components/share-panel.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { readNotice, type DashboardNotice } from "../lib/dashboard-notice.ts"
import { dashboardCreatedPath, dashboardPath, livePath } from "../lib/routes.ts"
import { CreateForm } from "./create-form.tsx"
import { initialValues, valuesFrom } from "./create-values.ts"
import { DashboardGate } from "./dashboard-page.tsx"

/** The create wizard. `?from=` fills it with the answers of one of the streamer's giveaways, which is how a giveaway is duplicated. */
export function NewGiveawayPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [query] = useSearchParams()
  const from = query.get("from")
  const [signedOut, setSignedOut] = useState(false)
  const { streamer, operator } = useStreamerSession()
  if (signedOut) return <SignIn why="signIn.why.expired" />
  return (
    <DashboardGate>
      {(giveaways) => {
        const source = giveaways.find((giveaway) => giveaway.id === from)
        // A copy waits for the session (the operator comes with it): its tickets are read with the platform's groups.
        if (source !== undefined && operator.state === "loading") return <Loading />
        const capabilities = streamer?.capabilities ?? everyCapability
        return (
          <Page width="text" className="create">
            <div className="page-head">
              <h1>{t("dash.new.title")}</h1>
            </div>
            <CreateForm
              seed={source === undefined ? initialValues : valuesFrom(source, capabilities)}
              onCreated={({ giveaway, roomReady, usageLow }) => {
                const notice: DashboardNotice = {
                  kind: "created",
                  roomReady,
                  usageLow: usageLow === null ? null : usageLow.remaining,
                }
                // Replaces only the review step: the earlier steps stay in history, and removing them would take a
                // history jump followed by a second navigation, which breaks once the streamer has used the browser's back button.
                navigate(dashboardCreatedPath(giveaway.id), { replace: true, state: notice })
              }}
              onUnauthorized={() => setSignedOut(true)}
              onNotApproved={() => {
                const notice: DashboardNotice = { kind: "not-approved" }
                navigate(dashboardPath, { replace: true, state: notice })
              }}
            />
          </Page>
        )
      }}
    </DashboardGate>
  )
}

/** What the streamer sees right after creating a giveaway, and at its address again after a reload. */
export function CreatedGiveawayPage() {
  const { id } = useParams()
  const notice = readNotice(useLocation().state)
  return (
    <DashboardGate>
      {(giveaways) => {
        const giveaway = giveaways.find((listed) => listed.id === id)
        return giveaway === undefined ? (
          <NotFound title="notFound.giveaway" />
        ) : (
          <CreatedScreen giveaway={giveaway} notice={notice?.kind === "created" ? notice : null} />
        )
      }}
    </DashboardGate>
  )
}

function CreatedScreen({
  giveaway,
  notice,
}: {
  readonly giveaway: DashboardGiveaway
  /** Null when the page was opened by its address: the warnings belong to the moment of creating. */
  readonly notice: Extract<DashboardNotice, { kind: "created" }> | null
}) {
  const { t, plural } = useI18n()
  return (
    <div className="created">
      <div className="created-head">
        <span className="created-mark" aria-hidden="true">
          <CheckIcon />
        </span>
        <h1>{t("dash.created.title")}</h1>
      </div>
      {notice === null || notice.usageLow === null ? null : (
        <p role="alert" className="form-alert">
          {plural("usageLow", notice.usageLow)}
        </p>
      )}
      {notice === null || notice.roomReady ? null : (
        <p role="alert" className="form-alert">
          {t("dash.roomNotReady")}
        </p>
      )}
      <div className="created-grid">
        <section className="card" aria-labelledby="share-title">
          <h2 id="share-title" className="sr-only">
            {t("live.share.title")}
          </h2>
          <p>{t("dash.next")}</p>
          <ShareLinks code={giveaway.code} />
          <Link className="button large" to={livePath(giveaway.id)}>
            <ActivityIcon />
            {t("dash.openLive")}
          </Link>
        </section>
        <section className="card" aria-labelledby="obs-title">
          <span className="state-icon">
            <TvIcon />
          </span>
          <h2 id="obs-title">{t("dash.obs.title")}</h2>
          <p>{t("dash.obs.text")}</p>
          <OverlayLink giveaway={giveaway} />
          <Disclosure icon={null} summary={t("dash.obs.steps")} open={false}>
            <ObsStepList />
          </Disclosure>
        </section>
      </div>
      <Link className="button outlined" to={dashboardPath}>
        <ArrowLeftIcon />
        {t("dash.back")}
      </Link>
    </div>
  )
}
