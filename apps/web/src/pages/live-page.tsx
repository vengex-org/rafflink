import { useState } from "react"
import { useParams } from "react-router"
import type { EntrantsDelta, LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import {
  closeEntries,
  drawWinners,
  liveSnapshotPath,
  parseLiveSnapshot,
  markClaimed,
  rerollWinner,
} from "../api/client.ts"
import { ConfirmAction } from "../components/confirm-action.tsx"
import { EntrantsSection } from "../components/entrants-table.tsx"
import {
  ActivityIcon,
  AlertIcon,
  CheckCircleIcon,
  LockIcon,
  RefreshIcon,
  ShuffleIcon,
  TagIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { EntrantNames, Stat, StatusPill, WinnerList } from "../components/live-parts.tsx"
import { Failed, Loading, NotFound, SignIn, Status } from "../components/notice.tsx"
import { ObsSteps, ShareLinks } from "../components/share-panel.tsx"
import { StepIndicator } from "../components/step-indicator.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { giveawayName } from "../lib/messages.ts"
import { peopleText } from "../lib/rules-text.ts"
import { useAction } from "../lib/use-action.ts"
import { useLive } from "../lib/use-live.ts"

const stepNames = ["live.step.collect", "live.step.draw", "live.step.claim"] as const

export function LivePage() {
  const { id } = useParams()
  return id === undefined ? <NotFound title="notFound.giveaway" /> : <Loaded id={id} />
}

function Loaded({ id }: { readonly id: string }) {
  const live = useLive(liveSnapshotPath(id), parseLiveSnapshot)
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
      return <SignIn why="signIn.why.live" />
    case "not-found":
      return <NotFound title="notFound.giveaway" />
    case "ready":
      return (
        <Controls
          id={id}
          snapshot={live.snapshot}
          connected={live.connected}
          entrantsAfter={live.entrantsAfter}
          overlayToken={live.overlayToken}
        />
      )
  }
}

const isUnclaimed = (winner: LiveWinner) =>
  winner.claim.state === "waiting" || winner.claim.state === "expired"

function Controls({
  id,
  snapshot,
  connected,
  entrantsAfter,
  overlayToken,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly connected: boolean
  readonly entrantsAfter: EntrantsDelta | null
  readonly overlayToken: string | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { message, busy, run } = useAction()

  const winnerActions = (winner: LiveWinner) => {
    const open = winner.claim.state === "waiting"
    const expired = winner.claim.state === "expired"
    const name = winner.displayName ?? t("live.winnerFallback", { n: winner.n + 1 })
    return (
      <span className="actions">
        {snapshot.chatClaimUnavailable && open ? (
          <button
            type="button"
            className="button tonal small"
            disabled={busy}
            aria-label={t("live.mark.aria", { name })}
            onClick={() =>
              void run(
                () => markClaimed(id, winner.n),
                (outcome) => `markResult.${outcome}`,
              )
            }
          >
            <CheckCircleIcon />
            {t("live.mark.label")}
          </button>
        ) : null}
        {(open || expired) && snapshot.rerollOpen ? (
          <ConfirmAction
            icon={<RefreshIcon />}
            label={t("live.reroll.label")}
            question={t("live.reroll.question", { name })}
            detail={t("live.reroll.detail", { name })}
            confirmLabel={t("live.reroll.confirm")}
            busy={busy}
            disabled={false}
            quiet={open}
            onConfirm={() =>
              void run(
                () => rerollWinner(id, winner.n),
                (outcome) => `rerollResult.${outcome}`,
              )
            }
          />
        ) : null}
      </span>
    )
  }

  return (
    <>
      {connected ? null : <output className="status">{t("live.reconnecting")}</output>}
      <header className="page-head">
        <div>
          <h1>{giveawayName(i18n, snapshot.title, snapshot.code)}</h1>
          <p className="muted">{t("live.code", { code: snapshot.code })}</p>
        </div>
        <StatusPill status={snapshot.status} />
      </header>
      <StepIndicator steps={stepNames} current={stepOf(snapshot.status)} />
      <div className="live-grid">
        <div className="live-main">
          {snapshot.chatClaimUnavailable ? (
            <section role="alert" className="card banner" data-tone="warning">
              <span className="state-icon">
                <AlertIcon />
              </span>
              <h2>{t("live.chatOff.title")}</h2>
              <p>{t("live.chatOff.text")}</p>
            </section>
          ) : null}
          {snapshot.status === "drawn"
          && !snapshot.rerollOpen
          && snapshot.winners.some(isUnclaimed) ? (
            <section className="card banner" data-tone="warning">
              <span className="state-icon">
                <AlertIcon />
              </span>
              <p>{t("live.reroll.over")}</p>
            </section>
          ) : null}
          {snapshot.status === "open" ? (
            <OpenStep id={id} snapshot={snapshot} busy={busy} run={run} />
          ) : null}
          {snapshot.status === "closed" ? (
            <DrawStep id={id} snapshot={snapshot} busy={busy} run={run} />
          ) : null}
          {snapshot.status === "drawn" ? (
            <section className="card next" aria-labelledby="winners-title">
              <h2 id="winners-title">{t("live.winners.title")}</h2>
              <p>
                {snapshot.chatClaimUnavailable
                  ? t("live.winners.page")
                  : t("live.winners.pageOrChat")}
              </p>
              <WinnerList winners={snapshot.winners} actions={winnerActions} />
            </section>
          ) : null}
          {message === null ? null : <Status>{t(message)}</Status>}
          <Problems snapshot={snapshot} />
        </div>
        <aside className="live-side">
          <section className="card" aria-labelledby="entrants-title">
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
              <Stat
                icon={<TagIcon />}
                value={i18n.number(snapshot.ticketTotal)}
                label={t("stat.tickets")}
              />
            </dl>
            <h2 id="entrants-title">{t("entrants.latest")}</h2>
            <EntrantNames names={snapshot.lastNames} />
          </section>
          {snapshot.status === "open" ? (
            <section className="card" aria-labelledby="share-title">
              <h2 id="share-title">{t("live.share.title")}</h2>
              <ShareLinks code={snapshot.code} />
            </section>
          ) : null}
          {overlayToken === null ? null : (
            <section className="card" aria-labelledby="overlay-title">
              <h2 id="overlay-title">{t("live.overlay.title")}</h2>
              <ObsSteps giveaway={{ id, overlayToken }} />
            </section>
          )}
        </aside>
      </div>
      <EntrantsSection
        key={id}
        id={id}
        feed={{ connected, entrantsAfter }}
        winners={snapshot.winners}
      />
    </>
  )
}

type Run = ReturnType<typeof useAction>["run"]

function OpenStep({
  id,
  snapshot,
  busy,
  run,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly busy: boolean
  readonly run: Run
}) {
  const { t, dateTime } = useI18n()
  return (
    <section className="card next" aria-labelledby="open-title">
      <h2 id="open-title">{t("live.open.title")}</h2>
      {snapshot.closesAt === null ? null : (
        <p className="muted">{t("live.closesAt", { time: dateTime(snapshot.closesAt) })}</p>
      )}
      <ConfirmAction
        icon={<LockIcon />}
        label={t("live.close.label")}
        question={t("live.close.question")}
        detail={t("live.close.detail")}
        confirmLabel={t("live.close.confirm")}
        busy={busy}
        disabled={false}
        quiet={false}
        onConfirm={() =>
          void run(
            () => closeEntries(id),
            (outcome) => `closeResult.${outcome}`,
          )
        }
      />
    </section>
  )
}

function DrawStep({
  id,
  snapshot,
  busy,
  run,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly busy: boolean
  readonly run: Run
}) {
  const i18n = useI18n()
  const { t } = i18n
  const [count, setCount] = useState("1")
  const winners = Number(count)
  const countValid = count.trim() !== "" && Number.isInteger(winners) && winners >= 1
  const blocked =
    snapshot.entrantCount === 0 ? t("live.draw.nobody") : countValid ? null : t("live.draw.invalid")
  return (
    <section className="card next" aria-labelledby="draw-title">
      <h2 id="draw-title">{t("live.draw.title")}</h2>
      <p>{t("live.draw.text", { people: peopleText(i18n, snapshot.entrantCount) })}</p>
      <div className="field">
        <label htmlFor="draw-count">{t("live.draw.count")}</label>
        <input
          id="draw-count"
          type="number"
          min={1}
          value={count}
          aria-describedby="draw-help"
          onChange={(event) => setCount(event.currentTarget.value)}
        />
        <p id="draw-help" className="help">
          {blocked
            ?? (countValid && winners > snapshot.entrantCount
              ? t("live.draw.fewer", { count: i18n.number(snapshot.entrantCount) })
              : t("live.draw.random"))}
        </p>
      </div>
      <ConfirmAction
        icon={<ShuffleIcon />}
        label={t("live.draw.label")}
        question={i18n.plural("drawQuestion", winners)}
        detail={t("live.draw.detail")}
        confirmLabel={t("live.draw.confirm")}
        busy={busy}
        disabled={blocked !== null}
        quiet={false}
        onConfirm={() =>
          void run(
            () => drawWinners(id, winners),
            (outcome) => `drawResult.${outcome}`,
          )
        }
      />
    </section>
  )
}

function Problems({ snapshot }: { readonly snapshot: LiveSnapshot }) {
  const { t, plural } = useI18n()
  if (snapshot.roleRefreshFailures === 0 && snapshot.eventSubFailures === 0) return null
  return (
    <section className="card" aria-labelledby="problems-title">
      <h2 id="problems-title">{t("live.problems.title")}</h2>
      <ul>
        {snapshot.roleRefreshFailures === 0 ? null : (
          <li>{plural("roleFailures", snapshot.roleRefreshFailures)}</li>
        )}
        {snapshot.eventSubFailures === 0 ? null : (
          <li>{plural("chatFailures", snapshot.eventSubFailures)}</li>
        )}
      </ul>
    </section>
  )
}

function stepOf(status: LiveSnapshot["status"]): number {
  switch (status) {
    case "open":
      return 1
    case "closed":
      return 2
    case "drawn":
      return 3
  }
}
