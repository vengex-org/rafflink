import { useId, useState } from "react"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { closeEntries, drawWinners, markClaimed, rerollWinner } from "../api/client.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { overlayUrl } from "../lib/links.ts"
import { overlayModes, withOverlayOptions, type OverlayMode } from "../lib/overlay-options.ts"
import type { useAction } from "../lib/use-action.ts"
import { ConfirmAction } from "./confirm-action.tsx"
import { CopyField } from "./copy-field.tsx"
import { Segmented, type SegmentOption } from "./form-fields.tsx"
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

/** Whether the pick can be replaced: its claim is open or ran out, and the reroll window is open. */
export function canReroll(winner: LiveWinner, snapshot: LiveSnapshot): boolean {
  return (
    (winner.claim.state === "waiting" || winner.claim.state === "expired") && snapshot.rerollOpen
  )
}

const nameOf = (winner: LiveWinner, t: I18n["t"]) =>
  winner.displayName ?? t("live.winnerFallback", { n: winner.n + 1 })

/** The buttons of the controls bar: the next step of the draw, the entries switch, the overlay link and the way to hide it all. */
export function LiveBar({
  id,
  busy,
  run,
  snapshot,
  current,
  overlayToken,
  onHide,
}: Doing & {
  readonly snapshot: LiveSnapshot
  readonly current: LiveWinner | null
  readonly overlayToken: string | null
  readonly onHide: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="live-bar" role="toolbar" aria-label={t("live.bar.label")}>
      {snapshot.status === "closed" ? (
        <DrawStep id={id} busy={busy} run={run} entrantCount={snapshot.entrantCount} />
      ) : null}
      {snapshot.status === "drawn" ? (
        <>
          <p className="sr-only">{claimStatusText(snapshot.winners, current, t)}</p>
          {current === null ? null : (
            <>
              <MarkClaimed
                id={id}
                busy={busy}
                run={run}
                snapshot={snapshot}
                winner={current}
                className="live-btn secondary"
              />
              <RerollPick
                id={id}
                busy={busy}
                run={run}
                snapshot={snapshot}
                winner={current}
                label={t("live.reroll.bar", { name: nameOf(current, t) })}
                className="live-btn secondary"
                shortcut="r"
              />
            </>
          )}
        </>
      ) : null}
      <EntriesSwitch id={id} busy={busy} run={run} status={snapshot.status} />
      <span className="live-bar-end">
        {overlayToken === null ? null : <OverlayLink id={id} overlayToken={overlayToken} />}
        <button type="button" className="live-btn ghost" aria-keyshortcuts="c" onClick={onHide}>
          <EyeOffIcon />
          {t("live.clean.hide")}
        </button>
      </span>
    </div>
  )
}

/** The buttons beside an earlier pick in the list of picks. */
export function PickActions({
  id,
  busy,
  run,
  snapshot,
  winner,
}: Doing & { readonly snapshot: LiveSnapshot; readonly winner: LiveWinner }) {
  const { t } = useI18n()
  return (
    <span className="live-hist-actions">
      <MarkClaimed
        id={id}
        busy={busy}
        run={run}
        snapshot={snapshot}
        winner={winner}
        className="button tonal small"
      />
      <RerollPick
        id={id}
        busy={busy}
        run={run}
        snapshot={snapshot}
        winner={winner}
        label={t("live.reroll.label")}
        className="button outlined small"
        shortcut={null}
      />
    </span>
  )
}

/** The streamer's own word that the winner claimed, offered only while chat watch is off and the claim is open. */
function MarkClaimed({
  id,
  busy,
  run,
  snapshot,
  winner,
  className,
}: Doing & {
  readonly snapshot: LiveSnapshot
  readonly winner: LiveWinner
  readonly className: string
}) {
  const { t } = useI18n()
  if (!snapshot.chatClaimUnavailable || winner.claim.state !== "waiting") return null
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
      {t("live.mark.label")}
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
  readonly label: string
  readonly className: string
  readonly shortcut: string | null
}) {
  const { t } = useI18n()
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

function DrawStep({ id, busy, run, entrantCount }: Doing & { readonly entrantCount: number }) {
  const i18n = useI18n()
  const { t } = i18n
  const [count, setCount] = useState("1")
  const winners = Number(count)
  const countValid = count.trim() !== "" && Number.isInteger(winners) && winners >= 1
  const blocked =
    entrantCount === 0 ? t("live.draw.nobody") : countValid ? null : t("live.draw.invalid")
  return (
    <>
      <p id="draw-help" className="live-draw-help">
        {blocked
          ?? (countValid && winners > entrantCount
            ? t("live.draw.fewer", { count: i18n.number(entrantCount) })
            : t("live.draw.random"))}
      </p>
      <div className="live-draw-count">
        <label htmlFor="draw-count">{t("live.draw.count")}</label>
        <input
          id="draw-count"
          type="number"
          autoComplete="off"
          min={1}
          value={count}
          aria-describedby="draw-help"
          onChange={(event) => setCount(event.currentTarget.value)}
        />
      </div>
      <ConfirmAction
        icon={<ShuffleIcon />}
        label={t("live.draw.label")}
        question={i18n.plural("drawQuestion", winners)}
        detail={t("live.draw.detail")}
        confirmLabel={t("live.draw.confirm")}
        busy={busy}
        disabled={blocked !== null}
        className="live-btn primary"
        shortcut="d"
        onConfirm={() =>
          void run(
            () => drawWinners(id, winners),
            (outcome) => `drawResult.${outcome}`,
          )
        }
      />
    </>
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
        <CopyField
          label={t("share.overlay")}
          value={withOverlayOptions(overlayUrl(id, overlayToken), { mode, qr })}
          buttonLabel={t("share.copyOverlay")}
        />
      </div>
    </>
  )
}

/** One line for screen readers once winners are drawn: whose claim is open, who claimed, or that nobody did. */
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
