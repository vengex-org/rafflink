import { useCallback, useEffect, useId, useState } from "react"
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
import { CopyField } from "../components/copy-field.tsx"
import { EntrantsSection } from "../components/entrants-table.tsx"
import { Segmented, type SegmentOption } from "../components/form-fields.tsx"
import {
  ActivityIcon,
  AlertIcon,
  CheckCircleIcon,
  LockIcon,
  RefreshIcon,
  ShuffleIcon,
  TagIcon,
  TvIcon,
  UsersIcon,
} from "../components/icons.tsx"
import {
  CurrentWinner,
  EntrantNames,
  Stat,
  StatusPill,
  WinnerList,
} from "../components/live-parts.tsx"
import { Failed, Loading, NotFound, SignIn, Status } from "../components/notice.tsx"
import { ObsStepList, ShareLinks } from "../components/share-panel.tsx"
import { StepIndicator } from "../components/step-indicator.tsx"
import { WinnerChat } from "../components/winner-chat.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { overlayUrl, shareUrl } from "../lib/links.ts"
import { giveawayName } from "../lib/messages.ts"
import { overlayModes, withOverlayOptions, type OverlayMode } from "../lib/overlay-options.ts"
import { peopleText } from "../lib/rules-text.ts"
import { readStored, writeStored } from "../lib/safe-storage.ts"
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
  const { t, dateTime } = i18n
  const { message, busy, run } = useAction()
  const [clean, toggleClean] = useCleanMode()
  const rerollOver = rerollOverText(snapshot)
  const current = currentWinner(snapshot.winners)

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

  const peopleStat = (
    <Stat
      icon={<UsersIcon />}
      value={i18n.number(snapshot.entrantCount)}
      label={t("stat.people")}
    />
  )

  return (
    <div className="live-page" data-clean={clean}>
      {connected ? null : <output className="status">{t("live.reconnecting")}</output>}
      <header className="page-head">
        <div>
          <h1>{giveawayName(i18n, snapshot.title, snapshot.code)}</h1>
          <p className="muted">{t("live.code", { code: snapshot.code })}</p>
        </div>
        <div className="live-head-end">
          <dl className="stats live-numbers">
            {snapshot.status === "drawn" ? peopleStat : null}
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
          <StatusPill status={snapshot.status} />
        </div>
      </header>
      {clean ? null : <StepIndicator steps={stepNames} current={stepOf(snapshot.status)} />}
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
          {rerollOver !== null && snapshot.winners.some(isUnclaimed) ? (
            <section className="card banner" data-tone="warning">
              <span className="state-icon">
                <AlertIcon />
              </span>
              <p>{t(rerollOver)}</p>
            </section>
          ) : null}
          {snapshot.status === "open" ? (
            <section className="card live-stage" aria-labelledby="open-title">
              <h2 id="open-title">{t("live.open.title")}</h2>
              <p className="live-link">
                {new URL(shareUrl(snapshot.code)).host}/<em>{snapshot.code}</em>
              </p>
              {snapshot.closesAt === null ? null : (
                <p className="muted">{t("live.closesAt", { time: dateTime(snapshot.closesAt) })}</p>
              )}
              <dl className="stats live-count">{peopleStat}</dl>
              <h3>{t("entrants.latest")}</h3>
              <EntrantNames names={snapshot.lastNames} />
              <ShareLinks code={snapshot.code} />
            </section>
          ) : null}
          {snapshot.status === "closed" ? (
            <section className="card live-stage" aria-labelledby="draw-title">
              <h2 id="draw-title">{t("live.draw.title")}</h2>
              <dl className="stats live-count">{peopleStat}</dl>
              <p>{t("live.draw.text", { people: peopleText(i18n, snapshot.entrantCount) })}</p>
            </section>
          ) : null}
          {snapshot.status === "drawn" ? (
            <section className="card live-stage" aria-labelledby="winners-title">
              <h2 id="winners-title">{t("live.winners.title")}</h2>
              {current === null ? null : <CurrentWinner winner={current} />}
              <p>
                {snapshot.chatClaimUnavailable
                  ? t("live.winners.page")
                  : t("live.winners.pageOrChat")}
              </p>
              <WinnerList winners={snapshot.winners} actions={clean ? null : winnerActions} />
            </section>
          ) : null}
          <WinnerChat lines={snapshot.winnerChat} />
          {message === null ? null : <Status>{t(message)}</Status>}
          <Problems snapshot={snapshot} />
          {clean ? (
            <button type="button" className="button text small live-show" onClick={toggleClean}>
              {t("live.clean.show")}
            </button>
          ) : (
            <div className="card live-bar" role="toolbar" aria-label={t("live.bar.label")}>
              {snapshot.status === "open" ? <CloseStep id={id} busy={busy} run={run} /> : null}
              {snapshot.status === "closed" ? (
                <DrawStep id={id} snapshot={snapshot} busy={busy} run={run} />
              ) : null}
              <span className="live-bar-end">
                {overlayToken === null ? null : <OverlayLink id={id} overlayToken={overlayToken} />}
                <button
                  type="button"
                  className="button text"
                  aria-keyshortcuts="c"
                  onClick={toggleClean}
                >
                  {t("live.clean.hide")}
                  <kbd aria-hidden="true">C</kbd>
                </button>
              </span>
            </div>
          )}
        </div>
        <aside className="live-side">
          <EntrantsSection
            key={id}
            id={id}
            feed={{ connected, entrantsAfter }}
            winners={snapshot.winners}
          />
        </aside>
      </div>
    </div>
  )
}

type Run = ReturnType<typeof useAction>["run"]

function CloseStep({
  id,
  busy,
  run,
}: {
  readonly id: string
  readonly busy: boolean
  readonly run: Run
}) {
  const { t } = useI18n()
  return (
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
    <div className="live-draw">
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
    </div>
  )
}

/** The overlay link and the OBS steps in a popover, so they take no room on the page that is shown on stream. The streamer picks what the overlay shows and the link follows. */
function OverlayLink({ id, overlayToken }: { readonly id: string; readonly overlayToken: string }) {
  const { t } = useI18n()
  const popoverId = useId()
  const [mode, setMode] = useState<OverlayMode>("auto")
  const [qr, setQr] = useState(false)
  const modeOptions: readonly SegmentOption<OverlayMode>[] = overlayModes.map((value) => ({
    value,
    label: t(`live.overlay.mode.${value}`),
    icon: null,
    description: t(`live.overlay.mode.${value}.help`),
  }))
  const qrOptions: readonly SegmentOption<"on" | "off">[] = [
    { value: "off", label: t("live.overlay.qr.off"), icon: null, description: "" },
    { value: "on", label: t("live.overlay.qr.on"), icon: null, description: "" },
  ]
  return (
    <>
      <button type="button" className="button text" popoverTarget={popoverId}>
        <TvIcon />
        {t("live.overlay.title")}
      </button>
      <div id={popoverId} popover="auto" className="live-overlay">
        <h2>{t("live.overlay.title")}</h2>
        <ObsStepList />
        <Segmented
          name="overlay-mode"
          legend={t("live.overlay.mode")}
          help={null}
          options={modeOptions}
          value={mode}
          onSelect={setMode}
        />
        <Segmented
          name="overlay-qr"
          legend={t("live.overlay.qr")}
          help={t("live.overlay.qr.help")}
          options={qrOptions}
          value={qr ? "on" : "off"}
          onSelect={(choice) => setQr(choice === "on")}
        />
        <CopyField
          label={t("share.overlay")}
          value={withOverlayOptions(overlayUrl(id, overlayToken), { mode, qr })}
          buttonLabel={t("share.copyOverlay")}
        />
      </div>
    </>
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

const cleanModeKey = "rafflink-live-clean"

/** Clean mode hides the controls for the stream. The choice is stored; the c key flips it unless the streamer is typing or a question is open. */
function useCleanMode(): readonly [boolean, () => void] {
  const [clean, setClean] = useState(() => readStored(cleanModeKey) === "1")
  const toggle = useCallback(() => {
    writeStored(cleanModeKey, clean ? "0" : "1")
    setClean(!clean)
  }, [clean])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c" || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target) || document.querySelector("dialog[open]") !== null) return
      toggle()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  return [clean, toggle]
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

/** Why the streamer cannot pick another winner, or null while they can (or nothing is left to pick). */
function rerollOverText(snapshot: LiveSnapshot): MessageKey | null {
  if (snapshot.status !== "drawn") return null
  switch (snapshot.rerollBlocked) {
    case "window-over":
      return "live.reroll.over"
    case "nobody-left":
      return "live.reroll.nobodyLeft"
    case null:
      return null
  }
}

/** The newest pick whose claim is still open, else the newest pick that was not replaced. */
function currentWinner(winners: readonly LiveWinner[]): LiveWinner | null {
  const open = winners.filter((winner) => winner.claim.state === "waiting")
  const standing = winners.filter((winner) => winner.claim.state !== "rerolled")
  return open.at(-1) ?? standing.at(-1) ?? null
}
