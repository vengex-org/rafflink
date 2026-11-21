import { useState } from "react"
import { Link } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import type { RoomStatus } from "@rafflink/core/room/rows"
import { listGiveaways, type CreateResult } from "../api/client.ts"
import { Disclosure } from "../components/disclosure.tsx"
import {
  ActivityIcon,
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  LinkIcon,
  PlusIcon,
  TvIcon,
} from "../components/icons.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { Page } from "../components/page.tsx"
import { ObsSteps, ShareLinks } from "../components/share-panel.tsx"
import type { Tone } from "../components/state-card.tsx"
import { StatusChip } from "../components/status-chip.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { giveawayName } from "../lib/messages.ts"
import { useLoad } from "../lib/use-load.ts"
import { CreateForm } from "./create-form.tsx"
import { initialValues, valuesFrom, type Values } from "./create-values.ts"

type Created = Extract<CreateResult, { kind: "created" }>

type View =
  | { readonly kind: "list" }
  | { readonly kind: "create"; readonly seed: Values }
  | { readonly kind: "created"; readonly created: Created }

export function DashboardPage() {
  const { t } = useI18n()
  const { result, reload } = useLoad(listGiveaways)
  const [view, setView] = useState<View>({ kind: "list" })
  const [signedOut, setSignedOut] = useState(false)

  if (signedOut) return <SignIn why="signIn.why.expired" />
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      if (result.value === "unauthorized") return <SignIn why="signIn.why.dashboard" />
      switch (view.kind) {
        case "create":
          return (
            <Page width="text" className="create">
              <div className="page-head">
                <h1>{t("dash.new.title")}</h1>
              </div>
              <CreateForm
                seed={view.seed}
                onCreated={(created) => {
                  setView({ kind: "created", created })
                  reload()
                }}
                onUnauthorized={() => setSignedOut(true)}
                onCancel={() => setView({ kind: "list" })}
              />
            </Page>
          )
        case "created":
          return <CreatedScreen created={view.created} onDone={() => setView({ kind: "list" })} />
        case "list":
          return (
            <GiveawayList
              giveaways={result.value}
              onCreate={(seed) => setView({ kind: "create", seed })}
            />
          )
      }
  }
}

function CreatedScreen({
  created,
  onDone,
}: {
  readonly created: Created
  readonly onDone: () => void
}) {
  const { t, rich, plural } = useI18n()
  const { giveaway } = created
  return (
    <div className="created">
      <div className="created-head">
        <span className="created-mark" aria-hidden="true">
          <CheckIcon />
        </span>
        <h1>{t("dash.created.title")}</h1>
      </div>
      {created.usageLow === null ? null : (
        <p role="alert" className="form-alert">
          {plural("usageLow", created.usageLow.remaining)}
        </p>
      )}
      {created.roomReady ? null : (
        <p role="alert" className="form-alert">
          {t("dash.roomNotReady")}
        </p>
      )}
      <div className="created-grid">
        <section className="card" aria-labelledby="share-title">
          <h2 id="share-title" className="sr-only">
            {t("live.share.title")}
          </h2>
          <p>{rich("dash.next", { code: <strong>{giveaway.code}</strong> })}</p>
          <ShareLinks code={giveaway.code} />
          <Link className="button large" to={`/live/${giveaway.id}`}>
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
          <ObsSteps giveaway={giveaway} />
        </section>
      </div>
      <button type="button" className="button outlined" onClick={onDone}>
        <ArrowLeftIcon />
        {t("dash.back")}
      </button>
    </div>
  )
}

function GiveawayList({
  giveaways,
  onCreate,
}: {
  readonly giveaways: readonly DashboardGiveaway[]
  readonly onCreate: (seed: Values) => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  if (giveaways.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1>{t("dash.title")}</h1>
        </div>
        <section className="card dash-empty" aria-labelledby="empty-title">
          <div>
            <h2 id="empty-title">{t("dash.empty.title")}</h2>
            <p>{t("dash.empty.text")}</p>
            <button type="button" className="button large" onClick={() => onCreate(initialValues)}>
              <PlusIcon />
              {t("dash.empty.button")}
            </button>
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
        <button type="button" className="button" onClick={() => onCreate(initialValues)}>
          <PlusIcon />
          {t("dash.new.button")}
        </button>
      </div>
      {pinned.length === 0 ? null : (
        <ul className="giveaways pinned">
          {pinned.map((giveaway) => (
            <GiveawayItem key={giveaway.id} giveaway={giveaway} pinned onCreate={onCreate} />
          ))}
        </ul>
      )}
      {rest.length === 0 ? null : (
        <ul className="giveaways rows">
          {rest.map((giveaway) => (
            <GiveawayItem
              key={giveaway.id}
              giveaway={giveaway}
              pinned={false}
              onCreate={onCreate}
            />
          ))}
        </ul>
      )}
    </>
  )
}

/** A giveaway still running is a card on top; a drawn one is a dense row below. */
function GiveawayItem({
  giveaway,
  pinned,
  onCreate,
}: {
  readonly giveaway: DashboardGiveaway
  readonly pinned: boolean
  readonly onCreate: (seed: Values) => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  // An untitled giveaway is named by its prize, as the viewer page does; "Giveaway CODE" would repeat the code line.
  const name =
    giveaway.title === null && giveaway.prize !== null
      ? giveaway.prize
      : giveawayName(i18n, giveaway.title, giveaway.code)
  const prizeLine = giveaway.title === null ? null : giveaway.prize
  return (
    <li className={pinned ? "card" : "row"} data-status={giveaway.status}>
      <div className="giveaway-head">
        <h2>{name}</h2>
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
        <Link className={pinned ? "button" : "button text"} to={`/live/${giveaway.id}`}>
          <ActivityIcon />
          {t("dash.openLive")}
        </Link>
        <button
          type="button"
          className={pinned ? "button outlined" : "button text"}
          aria-label={t("dash.duplicate.label", { name })}
          onClick={() => onCreate(valuesFrom(giveaway))}
        >
          <CopyIcon />
          {t("dash.duplicate")}
        </button>
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
