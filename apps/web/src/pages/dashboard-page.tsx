import type { ReactNode } from "react"
import { Link, useLocation } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import type { RoomStatus } from "@rafflink/core/room/rows"
import { listGiveaways } from "../api/client.ts"
import { Disclosure } from "../components/disclosure.tsx"
import { DonateLink } from "../components/donate-link.tsx"
import { ActivityIcon, CopyIcon, LinkIcon, LockIcon, PlusIcon } from "../components/icons.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { ObsSteps, ShareLinks } from "../components/share-panel.tsx"
import { StateCard, type Tone } from "../components/state-card.tsx"
import { StatusChip } from "../components/status-chip.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { readNotice } from "../lib/dashboard-notice.ts"
import { giveawayDisplayName } from "../lib/messages.ts"
import { dashboardNewPath, livePath } from "../lib/routes.ts"
import { useLoad } from "../lib/use-load.ts"

/** The signed-in streamer's giveaways for the screen under it; the sign-in prompt, a loading state or a failure otherwise. */
export function DashboardGate({
  children,
}: {
  readonly children: (giveaways: readonly DashboardGiveaway[]) => ReactNode
}) {
  const { result, reload } = useLoad(listGiveaways)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return result.value === "unauthorized" ? (
        <SignIn why="signIn.why.dashboard" />
      ) : (
        children(result.value)
      )
  }
}

export function DashboardPage() {
  // The server's refusal outranks the session, which may not be loaded yet or may be stale.
  const notApproved = readNotice(useLocation().state)?.kind === "not-approved"
  return (
    <DashboardGate>
      {(giveaways) => <GiveawayList giveaways={giveaways} approved={!notApproved} />}
    </DashboardGate>
  )
}

function GiveawayList({
  giveaways,
  approved,
}: {
  readonly giveaways: readonly DashboardGiveaway[]
  /** False once the server refused a create with `streamer_not_approved`. */
  readonly approved: boolean
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { donateUrl, streamer } = useStreamerSession()
  // An unknown session is not a refusal: the server still enforces approval on create.
  const canCreate = approved && (streamer === null || streamer.canCreate)
  if (giveaways.length === 0) {
    if (!canCreate) {
      return (
        <>
          <div className="page-head">
            <h1>{t("dash.title")}</h1>
          </div>
          <AwaitingApproval />
        </>
      )
    }
    return (
      <>
        <div className="page-head">
          <h1>{t("dash.title")}</h1>
        </div>
        <section className="card dash-empty" aria-labelledby="empty-title">
          <div>
            <h2 id="empty-title">{t("dash.empty.title")}</h2>
            <p>{t("dash.empty.text")}</p>
            <Link className="button large" to={dashboardNewPath()}>
              <PlusIcon />
              {t("dash.empty.button")}
            </Link>
          </div>
          <ol className="explainer">
            <li>
              <strong>{t("dash.empty.create.lead")}</strong> {t("dash.empty.create.rest")}
            </li>
            <li>
              <strong>{t("dash.empty.share.lead")}</strong> {t("dash.empty.share.rest")}
            </li>
            <li>
              <strong>{t("dash.empty.draw.lead")}</strong> {t("dash.empty.draw.rest")}
            </li>
          </ol>
        </section>
      </>
    )
  }
  const pinned = giveaways.filter((giveaway) => giveaway.status !== "drawn")
  const rest = giveaways.filter((giveaway) => giveaway.status === "drawn")
  return (
    <>
      <div className="page-head">
        <h1>{t("dash.title")}</h1>
        {canCreate ? (
          <Link className="button" to={dashboardNewPath()}>
            <PlusIcon />
            {t("dash.new.button")}
          </Link>
        ) : null}
      </div>
      {canCreate ? null : <AwaitingApproval />}
      {pinned.length === 0 ? null : (
        <section className="dash-section" aria-labelledby="dash-running">
          <h2 id="dash-running">{t("dash.section.running")}</h2>
          <ul className="giveaways pinned">
            {pinned.map((giveaway) => (
              <GiveawayItem key={giveaway.id} giveaway={giveaway} pinned canDuplicate={canCreate} />
            ))}
          </ul>
        </section>
      )}
      {rest.length === 0 || donateUrl === null ? null : <SupportNote url={donateUrl} />}
      {rest.length === 0 ? null : (
        <section className="dash-section" aria-labelledby="dash-drawn">
          <h2 id="dash-drawn">{t("dash.section.drawn")}</h2>
          <ul className="giveaways drawn">
            {rest.map((giveaway) => (
              <GiveawayItem
                key={giveaway.id}
                giveaway={giveaway}
                pinned={false}
                canDuplicate={canCreate}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** What a signed-in streamer sees while signup is closed and no admin has approved the account. */
function AwaitingApproval() {
  const { t } = useI18n()
  return (
    <StateCard tone="warning" align="start" icon={<LockIcon />} title={t("dash.access.title")}>
      <p>{t("dash.access.text")}</p>
    </StateCard>
  )
}

/** A quiet line above the drawn giveaways, the moment a streamer has just seen a giveaway through. */
function SupportNote({ url }: { readonly url: string }) {
  const { t } = useI18n()
  return (
    <p className="support-note">
      {t("dash.support.text")}
      <DonateLink url={url}>{t("dash.support.link")}</DonateLink>
    </p>
  )
}

/** A giveaway still running is a card with filled buttons; a drawn one is a quieter card with text buttons. */
function GiveawayItem({
  giveaway,
  pinned,
  canDuplicate,
}: {
  readonly giveaway: DashboardGiveaway
  readonly pinned: boolean
  /** False when the streamer may not create giveaways, which also takes away duplicating one. */
  readonly canDuplicate: boolean
}) {
  const i18n = useI18n()
  const { t } = i18n
  const name = giveawayDisplayName(i18n, giveaway)
  // An untitled giveaway is already named by its prize, so the prize line would repeat it.
  const prizeLine = giveaway.title === null ? null : giveaway.prize
  return (
    <li className="card" data-status={giveaway.status}>
      <div className="giveaway-head">
        <h3>{name}</h3>
        <StatusChip tone={statusTone(giveaway.status)}>{t(`status.${giveaway.status}`)}</StatusChip>
      </div>
      {prizeLine === null ? null : <p>{t("dash.prize", { prize: prizeLine })}</p>}
      <p className="muted giveaway-meta">
        {i18n.rich("dash.codeCreated", {
          code: <span className="code-tag">{giveaway.code}</span>,
          date: i18n.date(giveaway.createdAt),
        })}
      </p>
      <div className="actions">
        <Link className={pinned ? "button" : "button text"} to={livePath(giveaway.id)}>
          <ActivityIcon />
          {t("dash.openLive")}
        </Link>
        {canDuplicate ? (
          <Link
            className={pinned ? "button outlined" : "button text"}
            aria-label={t("dash.duplicate.label", { name })}
            to={dashboardNewPath({ from: giveaway.id })}
          >
            <CopyIcon />
            {t("dash.duplicate")}
          </Link>
        ) : null}
      </div>
      <Disclosure icon={<LinkIcon />} summary={t("dash.linkObs")} open={false}>
        <ShareLinks code={giveaway.code} />
        <ObsSteps giveaway={giveaway} />
      </Disclosure>
    </li>
  )
}

function statusTone(status: RoomStatus): Tone {
  switch (status) {
    case "open":
      return "success"
    case "closed":
      return "warning"
    case "drawn":
      return "win"
  }
}
