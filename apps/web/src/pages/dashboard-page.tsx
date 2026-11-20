import { useState } from "react"
import { Link } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { listGiveaways, type CreateResult } from "../api/client.ts"
import { Disclosure } from "../components/disclosure.tsx"
import {
  ActivityIcon,
  ArrowLeftIcon,
  CheckIcon,
  GiftIcon,
  LinkIcon,
  PlusIcon,
  TvIcon,
} from "../components/icons.tsx"
import { StatusPill } from "../components/live-parts.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { ObsSteps, ShareLinks } from "../components/share-panel.tsx"
import { StateCard } from "../components/state-card.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { giveawayName } from "../lib/messages.ts"
import { useLoad } from "../lib/use-load.ts"
import { CreateForm } from "./create-form.tsx"

type Created = Extract<CreateResult, { kind: "created" }>

type View =
  | { readonly kind: "list" }
  | { readonly kind: "create" }
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
            <>
              <h1>{t("dash.new.title")}</h1>
              <CreateForm
                onCreated={(created) => {
                  setView({ kind: "created", created })
                  reload()
                }}
                onUnauthorized={() => setSignedOut(true)}
                onCancel={() => setView({ kind: "list" })}
              />
            </>
          )
        case "created":
          return <CreatedScreen created={view.created} onDone={() => setView({ kind: "list" })} />
        case "list":
          return (
            <GiveawayList giveaways={result.value} onCreate={() => setView({ kind: "create" })} />
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
    <div className="column">
      <StateCard tone="success" align="start" icon={<CheckIcon />} title={t("dash.created.title")}>
        {created.usageLow === null ? null : (
          <p role="alert">{plural("usageLow", created.usageLow.remaining)}</p>
        )}
        {created.roomReady ? null : <p role="alert">{t("dash.roomNotReady")}</p>}
        <p>{rich("dash.next", { code: <strong>{giveaway.code}</strong> })}</p>
        <ShareLinks code={giveaway.code} />
        <Link className="button block" to={`/live/${giveaway.id}`}>
          <ActivityIcon />
          {t("dash.openLive")}
        </Link>
      </StateCard>
      <section className="card" aria-labelledby="obs-title">
        <span className="state-icon">
          <TvIcon />
        </span>
        <h2 id="obs-title">{t("dash.obs.title")}</h2>
        <p>{t("dash.obs.text")}</p>
        <ObsSteps giveaway={giveaway} />
      </section>
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
  readonly onCreate: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  if (giveaways.length === 0) {
    return (
      <>
        <h1>{t("dash.title")}</h1>
        <StateCard tone="info" align="start" icon={<GiftIcon />} title={t("dash.empty.title")}>
          <p>{t("dash.empty.text")}</p>
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
          <button type="button" className="button block" onClick={onCreate}>
            <PlusIcon />
            {t("dash.empty.button")}
          </button>
        </StateCard>
      </>
    )
  }
  return (
    <>
      <div className="page-head">
        <h1>{t("dash.title")}</h1>
        <button type="button" className="button" onClick={onCreate}>
          <PlusIcon />
          {t("dash.new.button")}
        </button>
      </div>
      <ul className="giveaways">
        {giveaways.map((giveaway) => (
          <li key={giveaway.id} className="card" data-status={giveaway.status}>
            <div className="giveaway-head">
              <h2>{giveawayName(i18n, giveaway.title, giveaway.code)}</h2>
              <StatusPill status={giveaway.status} />
            </div>
            {giveaway.prize === null ? null : <p>{t("dash.prize", { prize: giveaway.prize })}</p>}
            <p className="muted">
              {t("dash.codeCreated", {
                code: giveaway.code,
                date: i18n.date(giveaway.createdAt),
              })}
            </p>
            <Link className="button tonal" to={`/live/${giveaway.id}`}>
              <ActivityIcon />
              {t("dash.openLive")}
            </Link>
            <Disclosure icon={<LinkIcon />} summary={t("dash.linkObs")} open={false}>
              <ShareLinks code={giveaway.code} />
              <ObsSteps giveaway={giveaway} />
            </Disclosure>
          </li>
        ))}
      </ul>
    </>
  )
}
