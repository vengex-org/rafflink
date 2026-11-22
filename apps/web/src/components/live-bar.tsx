import { useCallback, useId, useState, type ReactNode } from "react"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"
import { useLiveApi } from "../lib/live-api.ts"
import { overlayUrl } from "../lib/links.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { useShortcut } from "../lib/use-shortcut.ts"
import { overlayModes, type OverlayMode } from "../lib/overlay-options.ts"
import type { useAction } from "../lib/use-action.ts"
import { ConfirmAction } from "./confirm-action.tsx"
import { CopyLink } from "./copy-field.tsx"
import { DonateLink } from "./donate-link.tsx"
import { Segmented, Stepper, type SegmentOption } from "./form-fields.tsx"
import { GiveawayOverlayStyle } from "./overlay-style.tsx"
import {
  CheckCircleIcon,
  CopyIcon,
  EyeOffIcon,
  LockIcon,
  RefreshIcon,
  ShuffleIcon,
} from "./icons.tsx"
import { ObsStepList } from "./share-panel.tsx"

export type Run = ReturnType<typeof useAction>["run"]

/** What a button needs to send a request for the giveaway `id`; `busy` while one runs. */
export interface Doing {
  readonly id: string
  readonly busy: boolean
  readonly run: Run
}

/** Whether the pick can be replaced: it is unsettled and the reroll window is open. */
export function canReroll(winner: LiveWinner, snapshot: LiveSnapshot): boolean {
  return isUnsettled(winner) && snapshot.rerollOpen
}

/** A pick the streamer can still act on: its claim is open or ran out. */
export const isUnsettled = (winner: LiveWinner) =>
  winner.claim.state === "waiting" || winner.claim.state === "expired"

const nameOf = (winner: LiveWinner, t: I18n["t"]) =>
  winner.displayName ?? t("live.winnerFallback", { n: winner.n + 1 })

/** The next step of the draw: the Draw winner button in every step, and beside it mark or replace the winner on the plate while that pick is unsettled. */
export function LiveActions({
  id,
  busy,
  run,
  snapshot,
  current,
}: Doing & {
  readonly snapshot: LiveSnapshot
  readonly current: LiveWinner | null
}) {
  const { t } = useI18n()
  return (
    <div className="live-actions" role="toolbar" aria-label={t("live.bar.label")}>
      <DrawStep id={id} busy={busy} run={run} snapshot={snapshot} />
      {snapshot.status === "drawn" && current !== null ? (
        <>
          <MarkClaimed
            id={id}
            busy={busy}
            run={run}
            winner={current}
            label={t("live.mark.label")}
            className="live-btn secondary"
          />
          <RerollPick
            id={id}
            busy={busy}
            run={run}
            snapshot={snapshot}
            winner={current}
            label={
              <>
                <span aria-hidden="true">{t("live.reroll.label")}</span>
                <span className="sr-only">
                  {t("live.reroll.bar", { name: nameOf(current, t) })}
                </span>
              </>
            }
            className="live-btn secondary"
            shortcut="r"
          />
        </>
      ) : null}
    </div>
  )
}

/** What the streamer sets around the draw: the planned winner count, the entries switch, the overlay link and the way to hide the controls. */
export function LiveSettings({
  id,
  busy,
  run,
  snapshot,
  overlayToken,
  donateUrl,
  onHide,
}: Doing & {
  readonly snapshot: LiveSnapshot
  readonly overlayToken: string | null
  readonly donateUrl: string | null
  readonly onHide: () => void
}) {
  const { t } = useI18n()
  const headId = useId()
  return (
    <section className="live-card live-settings" aria-labelledby={headId}>
      <h2 id={headId}>{t("live.settings.title")}</h2>
      <WinnerCountControl id={id} busy={busy} run={run} winnerCount={snapshot.winnerCount} />
      <EntriesSwitch id={id} busy={busy} run={run} status={snapshot.status} />
      <span className="live-settings-end">
        {overlayToken === null ? null : <OverlayLink id={id} overlayToken={overlayToken} />}
        <button type="button" className="live-btn ghost" aria-keyshortcuts="c" onClick={onHide}>
          <EyeOffIcon />
          {t("live.clean.hide")}
        </button>
        {donateUrl === null ? null : <DonateLink url={donateUrl}>{t("live.support")}</DonateLink>}
      </span>
    </section>
  )
}

/** The mark and reroll buttons in the row of a pick, as icons; the names are for screen readers. */
export function PickActions({
  id,
  busy,
  run,
  snapshot,
  winner,
}: Doing & { readonly snapshot: LiveSnapshot; readonly winner: LiveWinner }) {
  const { t } = useI18n()
  const name = nameOf(winner, t)
  return (
    <>
      <MarkClaimed
        id={id}
        busy={busy}
        run={run}
        winner={winner}
        label={null}
        className="icon-button entrants-act"
      />
      <RerollPick
        id={id}
        busy={busy}
        run={run}
        snapshot={snapshot}
        winner={winner}
        label={<span className="sr-only">{t("live.reroll.bar", { name })}</span>}
        className="icon-button entrants-act"
        shortcut={null}
      />
    </>
  )
}

/** One line for screen readers once winners are drawn: whose claim is open, who claimed, or that nobody did. */
export function ClaimStatus({
  winners,
  current,
}: {
  readonly winners: readonly LiveWinner[]
  readonly current: LiveWinner | null
}) {
  const { t } = useI18n()
  return <p className="sr-only">{claimStatusText(winners, current, t)}</p>
}

/** The streamer's own word that the winner claimed, offered for a pick that is neither claimed nor rerolled, after its claim time too. */
function MarkClaimed({
  id,
  busy,
  run,
  winner,
  label,
  className,
}: Doing & {
  readonly winner: LiveWinner
  readonly label: ReactNode
  readonly className: string
}) {
  const { t } = useI18n()
  const { markClaimed } = useLiveApi()
  if (!isUnsettled(winner)) return null
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-label={t("live.mark.aria", { name: nameOf(winner, t) })}
      onClick={() =>
        void run(
          () => markClaimed(id, winner.n),
          (outcome) => `markResult.${outcome}`,
        )
      }
    >
      <CheckCircleIcon />
      {label}
    </button>
  )
}

function RerollPick({
  id,
  busy,
  run,
  snapshot,
  winner,
  label,
  className,
  shortcut,
}: Doing & {
  readonly snapshot: LiveSnapshot
  readonly winner: LiveWinner
  readonly label: ReactNode
  readonly className: string
  readonly shortcut: string | null
}) {
  const { t } = useI18n()
  const { rerollWinner } = useLiveApi()
  if (!canReroll(winner, snapshot)) return null
  const name = nameOf(winner, t)
  return (
    <ConfirmAction
      icon={<RefreshIcon />}
      label={label}
      question={t("live.reroll.question", { name })}
      detail={t("live.reroll.detail", { name })}
      confirmLabel={t("live.reroll.confirm")}
      busy={busy}
      disabled={false}
      className={className}
      shortcut={shortcut}
      onConfirm={() =>
        void run(
          () => rerollWinner(id, winner.n),
          (outcome) => `rerollResult.${outcome}`,
        )
      }
    />
  )
}

/** Entries only close: from Open the Closed side asks first, and once closed nothing reopens them. */
function EntriesSwitch({
  id,
  busy,
  run,
  status,
}: Doing & { readonly status: LiveSnapshot["status"] }) {
  const { t } = useI18n()
  const { closeEntries } = useLiveApi()
  const labelId = useId()
  const open = status === "open"
  return (
    <div className="live-seg">
      <span id={labelId} className="live-seg-label">
        {t("live.entries.label")}
      </span>
      <fieldset className="live-seg-options" aria-labelledby={labelId}>
        <button type="button" aria-pressed={open} disabled>
          {t("live.entries.open")}
        </button>
        {open ? (
          <ConfirmAction
            icon={<LockIcon />}
            label={t("live.entries.closed")}
            question={t("live.close.question")}
            detail={t("live.close.detail")}
            confirmLabel={t("live.close.confirm")}
            busy={busy}
            disabled={false}
            className="live-seg-close"
            shortcut={null}
            onConfirm={() =>
              void run(
                () => closeEntries(id),
                (outcome) => `closeResult.${outcome}`,
              )
            }
          />
        ) : (
          <button type="button" aria-pressed disabled>
            <LockIcon />
            {t("live.entries.closed")}
          </button>
        )}
      </fieldset>
    </div>
  )
}

/** The Draw winner button with what it will do next: it is there in every step and draws the next winner. */
function DrawStep({ id, busy, run, snapshot }: Doing & { readonly snapshot: LiveSnapshot }) {
  // A round-pending answer covers a snapshot older than the commit.
  const [pendingMs, setPendingMs] = useState<number | null>(null)
  const snapshotWaitMs =
    snapshot.drawAvailableAt === null ? null : snapshot.drawAvailableAt - snapshot.now
  const waitMs = snapshotWaitMs ?? pendingMs
  return (
    <DrawControls
      key={waitMs}
      id={id}
      busy={busy}
      run={run}
      snapshot={snapshot}
      waitMs={waitMs ?? 0}
      onPending={setPendingMs}
    />
  )
}

// Keyed by the wait it was given, so a new snapshot or answer restarts the countdown from its own server clock.
function DrawControls({
  id,
  busy,
  run,
  snapshot,
  waitMs,
  onPending,
}: Doing & {
  readonly snapshot: LiveSnapshot
  readonly waitMs: number
  readonly onPending: (waitMs: number) => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { drawWinners } = useLiveApi()
  const remainingMs = useRemainingMs(waitMs)
  const { status, drawRequested, entrantCount } = snapshot
  const blocked = blockedText(snapshot, t)
  const batch = batchSize(snapshot)
  const draw = (count: number) =>
    void run(
      async () => {
        const answer = await drawWinners(id, count)
        if (answer.kind !== "round-pending") return answer.kind
        const pendingMs = answer.availableAt - answer.now
        onPending(Math.max(0, pendingMs))
        return pendingMs > 0 ? answer.kind : "round-due"
      },
      // The winner appears on the stage after the shuffle; a toast now would announce it early.
      (outcome) => (outcome === "drawn" ? null : `drawResult.${outcome}`),
    )
  return (
    <>
      <p id="draw-help" className="live-draw-help">
        {blocked
          ?? drawHelp(
            {
              status,
              drawRequested,
              remainingMs,
              standing: standingWinners(snapshot.winners).length,
              planned: snapshot.winnerCount,
            },
            i18n,
          )}
      </p>
      {status === "open" ? (
        <ConfirmAction
          icon={<ShuffleIcon />}
          label={t("live.draw.label")}
          question={t("live.draw.question")}
          detail={t("live.draw.detail")}
          confirmLabel={t("live.draw.confirm")}
          busy={busy}
          disabled={entrantCount === 0}
          className="live-btn primary"
          shortcut="d"
          onConfirm={() => draw(1)}
        />
      ) : (
        <>
          <DrawButton
            label={t(status === "drawn" ? "live.draw.next" : "live.draw.label")}
            disabled={busy || blocked !== null || drawRequested}
            onPress={() => draw(1)}
          />
          {batch > 1 ? (
            <button
              type="button"
              className="live-btn secondary"
              disabled={busy || blocked !== null || drawRequested}
              aria-describedby="draw-help"
              onClick={() => draw(batch)}
            >
              <ShuffleIcon />
              {i18n.plural("drawBatch", batch)}
            </button>
          ) : null}
        </>
      )}
    </>
  )
}

function DrawButton({
  label,
  disabled,
  onPress,
}: {
  readonly label: string
  readonly disabled: boolean
  readonly onPress: () => void
}) {
  useShortcut(
    "d",
    useCallback(() => {
      if (!disabled) onPress()
    }, [disabled, onPress]),
  )
  return (
    <button
      type="button"
      className="live-btn primary"
      disabled={disabled}
      aria-keyshortcuts="d"
      aria-describedby="draw-help"
      onClick={onPress}
    >
      <ShuffleIcon />
      {label}
      <kbd aria-hidden="true">D</kbd>
    </button>
  )
}

// The planned winners not drawn yet, as far as entrants are left: what one press of the batch button draws.
function batchSize(snapshot: LiveSnapshot): number {
  const missing = snapshot.winnerCount - standingWinners(snapshot.winners).length
  return Math.min(missing, snapshot.entrantCount - snapshot.winners.length)
}

// Why the button cannot draw, or null while it can.
function blockedText(snapshot: LiveSnapshot, t: I18n["t"]): string | null {
  if (snapshot.entrantCount === 0) return t("live.draw.nobody")
  if (snapshot.status === "drawn" && snapshot.winners.length >= snapshot.entrantCount) {
    return t("live.draw.nobodyLeft")
  }
  return null
}

function drawHelp(
  state: {
    readonly status: LiveSnapshot["status"]
    readonly drawRequested: boolean
    readonly remainingMs: number
    readonly standing: number
    readonly planned: number
  },
  { t, number }: I18n,
): string {
  switch (state.status) {
    case "open":
      return t("live.draw.open")
    case "closed":
      if (state.remainingMs > 0)
        return t("live.draw.waiting", { clock: formatClock(state.remainingMs) })
      return t(state.drawRequested ? "live.draw.due" : "live.draw.random")
    case "drawn":
      return t("live.draw.fixed", { drawn: number(state.standing), planned: number(state.planned) })
  }
}

/** The planned winner count, editable in every step: the draw never stops there, the live page only shows progress against it. */
function WinnerCountControl({
  id,
  busy,
  run,
  winnerCount,
}: Doing & { readonly winnerCount: number }) {
  const { t } = useI18n()
  const { setWinnerCount } = useLiveApi()
  const [count, setCount] = useState(String(winnerCount))
  const winners = Number(count)
  const valid = count.trim() !== "" && Number.isInteger(winners) && winners >= 1
  return (
    <div className="live-draw-count">
      <label htmlFor="winner-count">{t("live.draw.count")}</label>
      <Stepper
        id="winner-count"
        name="winnerCount"
        value={count}
        min={1}
        invalid={!valid}
        describedBy={null}
        onChange={setCount}
        decreaseLabel={t("winners.fewer")}
        increaseLabel={t("winners.more")}
      />
      <button
        type="button"
        className="live-btn secondary"
        disabled={busy || !valid || winners === winnerCount}
        onClick={() =>
          void run(
            () => setWinnerCount(id, winners),
            (outcome) => `winnersResult.${outcome}`,
          )
        }
      >
        {t("live.winners.save")}
      </button>
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
  const optionedUrl = overlayUrl(id, overlayToken, { mode, qr })
  return (
    <>
      <button type="button" className="live-btn ghost" popoverTarget={popoverId}>
        <CopyIcon />
        {t("live.overlay.link")}
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
        <CopyLink
          label={t("share.overlay")}
          value={optionedUrl}
          buttonLabel={t("share.copyOverlay")}
          clipped
        >
          {optionedUrl}
        </CopyLink>
        <GiveawayOverlayStyle id={id} />
      </div>
    </>
  )
}

function claimStatusText(
  winners: readonly LiveWinner[],
  current: LiveWinner | null,
  t: I18n["t"],
): string {
  if (current?.claim.state === "waiting") {
    return t("live.bar.waiting", { name: nameOf(current, t) })
  }
  const claimed = winners.findLast((winner) => winner.claim.state === "claimed")
  return claimed === undefined
    ? t("live.bar.unclaimed")
    : t("live.bar.claimed", { name: nameOf(claimed, t) })
}
