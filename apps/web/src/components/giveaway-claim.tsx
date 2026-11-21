import { claimPrize, type GiveawayView } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { forgetStoredGiveaway } from "../lib/stored-giveaway.ts"
import { giveawayName } from "../lib/messages.ts"
import { useAction } from "../lib/use-action.ts"
import { useRemainingMs } from "../lib/use-remaining.ts"
import type { WonView } from "../lib/viewer-outcome.ts"
import { claimTone, Countdown } from "./countdown.tsx"
import { AlertIcon, CheckIcon, ClockIcon } from "./icons.tsx"
import { GiveawayState, TicketBox } from "./giveaway-state.tsx"
import { Status } from "./notice.tsx"

const ringRadius = 52
const ringLength = 2 * Math.PI * ringRadius

// The countdown is a timer role without a live region: announcing every second would drown the outcome.
export function ClaimPanel({
  code,
  win,
  giveaway,
}: {
  readonly code: string
  readonly win: WonView
  readonly giveaway: GiveawayView
}) {
  const i18n = useI18n()
  const { t, rich } = i18n
  const remaining = useRemainingMs(win.claimRemainingMs)
  const { message, busy, run } = useAction()
  const keyword = giveaway.rules.claimKeyword
  // The page heading shows the prize; the live region still says it, so a win is announced with what was won.
  const prize = giveaway.prize ?? giveawayName(i18n, giveaway.title, code)

  if (win.claim.state === "rerolled") {
    return (
      <GiveawayState tone="warning" icon={<AlertIcon />} title={t("win.another.title")}>
        <p className="viewer-note">{t("viewerClaim.rerolled")}</p>
      </GiveawayState>
    )
  }
  const claimed = win.claim.state === "claimed" || message === "viewerClaim.claimed"
  if (claimed) {
    return (
      <GiveawayState tone="win" title={t("win.claimed.title")} spokenLine={prize}>
        {win.entry === null ? null : <TicketBox tickets={win.entry} />}
        {win.claim.state === "claimed" ? (
          <p className="viewer-note">{t("win.claimedAt", { at: i18n.dateTime(win.claim.at) })}</p>
        ) : null}
        <p className="viewer-note">{t("viewerClaim.claimed")}</p>
      </GiveawayState>
    )
  }
  if (win.claim.state === "expired" || remaining === 0) {
    return (
      <GiveawayState tone="danger" icon={<ClockIcon />} title={t("win.up.title")}>
        <div className="viewer-notes">
          <p className="viewer-note">{t("viewerClaim.expired")}</p>
          <p className="viewer-note">{t("win.up.text")}</p>
        </div>
      </GiveawayState>
    )
  }
  return (
    <GiveawayState
      tone="win"
      title={t("win.title")}
      spokenLine={prize}
      aside={
        <ClaimRing
          remainingMs={remaining}
          windowMs={Math.max(giveaway.claimSeconds * 1000, win.claimRemainingMs, 1)}
          initialMs={win.claimRemainingMs}
        />
      }
    >
      {win.entry === null ? null : <TicketBox tickets={win.entry} />}
      <p className="viewer-note">{t("win.press")}</p>
      <button
        type="button"
        className="button block"
        disabled={busy}
        onClick={() =>
          void run(
            async () => {
              const outcome = await claimPrize(code)
              forgetStoredGiveaway(code)
              return outcome
            },
            (outcome) => `viewerClaim.${outcome}`,
          )
        }
      >
        <CheckIcon />
        {t("win.claim")}
      </button>
      {win.chatClaimAvailable ? (
        <p className="viewer-alt">
          {keyword === null
            ? t("win.orAny")
            : rich("win.orType", { keyword: <strong>{keyword}</strong> })}
        </p>
      ) : null}
      {message === null ? null : <Status>{t(message)}</Status>}
    </GiveawayState>
  )
}

/** The claim clock as a ring that empties with the time left; the tone changes the ring's colors and the clock's words. */
function ClaimRing({
  remainingMs,
  windowMs,
  initialMs,
}: {
  readonly remainingMs: number
  readonly windowMs: number
  readonly initialMs: number
}) {
  return (
    <div className="claim-ring" data-tone={claimTone(remainingMs)}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="claim-ring-track" cx="60" cy="60" r={ringRadius} />
        <circle
          className="claim-ring-bar"
          cx="60"
          cy="60"
          r={ringRadius}
          strokeDasharray={ringLength}
          strokeDashoffset={ringLength * (1 - Math.min(1, remainingMs / windowMs))}
        />
      </svg>
      <Countdown initialMs={initialMs} />
    </div>
  )
}
