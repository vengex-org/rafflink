import { useState, type ReactNode } from "react"
import type { OverlayTheme } from "@rafflink/core/domain/overlay-theme"
import type { LiveWinner, OverlaySnapshot } from "@rafflink/core/room/giveaway-room"
import { useI18n } from "../i18n/i18n.tsx"
import { siteHost } from "../lib/links.ts"
import { overlayThemeAttributes, overlayThemeStyle } from "../lib/overlay-theme.ts"
import { formatClock, useClock, useRemainingMs } from "../lib/use-remaining.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { DrawShuffle } from "./draw-shuffle.tsx"
import { UsersIcon } from "./icons.tsx"
import { EntrantNames, Stat } from "./live-parts.tsx"
import { WinnerPlate } from "./winner-plate.tsx"

/** Names on the compact plate: what a viewer can read in a glance. */
const newestNames = 3
/** Winner plates stacked one under another that fit a 1080p canvas; more standing winners share one list plate. */
const winnerPlatesMax = 3
/** Winner names a plate lists, the newest; the rest are counted, so a batch of hundreds never runs off the canvas. */
const listedWinnersMax = 24

/** The overlay root as a theme draws it: colors as custom properties, the rest as data attributes overlay.css reads. */
export function overlayFrameProps(theme: OverlayTheme) {
  return { className: "overlay", style: overlayThemeStyle(theme), ...overlayThemeAttributes(theme) }
}

/** The overlay as `theme` draws it, for the style settings: the entry plate and a winner's plate on a sample picture of a stream. */
export function OverlayPreview({ theme }: { readonly theme: OverlayTheme }) {
  const { t } = useI18n()
  return (
    <figure className="overlay-preview">
      <figcaption>{t("overlayStyle.preview")}</figcaption>
      <div className="overlay-preview-stage" aria-hidden="true">
        <div {...overlayFrameProps(theme)}>
          <EntryPlate snapshot={previewSnapshot} qr={null} />
          <WinnerPlates standing={previewWinners} prize={t("overlayStyle.preview.prize")} />
        </div>
      </div>
    </figure>
  )
}

/** The winner slot while a draw is pending. */
export function ShufflePlate({
  names,
  waitMs,
}: {
  readonly names: readonly string[]
  readonly waitMs: number | null
}) {
  const { t } = useI18n()
  return (
    <ul className="overlay-winners">
      <li className="overlay-plate overlay-winner">
        <div>
          <p className="overlay-label">{t("live.draw.due")}</p>
          <DrawShuffle key={waitMs} names={names} waitMs={waitMs} />
        </div>
        <PlateHost />
      </li>
    </ul>
  )
}

/** Where to enter and how many did while entries are open; the winners' names once drawn. */
export function EntryPlate({
  snapshot,
  qr,
}: {
  readonly snapshot: OverlaySnapshot
  readonly qr: ReactNode
}) {
  const i18n = useI18n()
  const { t } = i18n
  const drawn = snapshot.status === "drawn"
  const standing = standingWinners(snapshot.winners)
  return (
    <div className="overlay-plate overlay-open">
      <div className="overlay-link">
        <div className="overlay-chip">
          <span className="overlay-chip-label">
            {drawn
              ? t("overlay.winners")
              : snapshot.status === "open"
                ? t("overlay.enterAt")
                : t("status.closed")}
          </span>
          {drawn ? (
            <span className="overlay-winner-line">
              {standing
                .slice(-listedWinnersMax)
                .map((winner) => winner.displayName ?? t("winner.removed"))
                .join(", ")}
              {standing.length > listedWinnersMax
                ? ` ${t("overlay.moreWinners", { count: i18n.number(standing.length - listedWinnersMax) })}`
                : null}
            </span>
          ) : (
            <span className="overlay-url">
              {siteHost()}/<em>{snapshot.code}</em>
            </span>
          )}
        </div>
        {qr}
      </div>
      {drawn ? null : (
        <>
          <dl className="stats">
            <Stat
              icon={<UsersIcon />}
              value={i18n.number(snapshot.entrantCount)}
              label={t("stat.people")}
            />
          </dl>
          <EntrantNames names={snapshot.lastNames.slice(0, newestNames)} />
        </>
      )}
      {drawn ? <PlateHost /> : null}
    </div>
  )
}

/** One plate per standing winner with the prize line and, while the claim is open, its clock; the host alone when none stands. */
export function WinnerPlates({
  standing,
  prize,
}: {
  readonly standing: readonly LiveWinner[]
  readonly prize: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  if (standing.length > winnerPlatesMax)
    return <WinnerListPlate standing={standing} prize={prize} />
  return (
    <>
      <h2 className="sr-only">{t("overlay.winners")}</h2>
      <ul className="overlay-winners">
        {/* No plate to hold the host row when every pick was rerolled or none was made. */}
        {standing.length === 0 ? (
          <li className="overlay-plate overlay-winner">
            <PlateHost />
          </li>
        ) : null}
        {standing.map((winner, index) => (
          <li key={winner.n} className="overlay-plate overlay-winner">
            <div>
              <p className="overlay-label">
                {t("live.winnerOf", {
                  n: i18n.number(index + 1),
                  total: i18n.number(standing.length),
                })}
              </p>
              <WinnerPlate name={winner.displayName ?? t("winner.removed")} />
              <p className="overlay-prize">{prize}</p>
            </div>
            {winner.claim.state === "waiting" ? <ClaimTimer winner={winner} /> : null}
            {/* Once under the last plate, so several winners do not repeat it. */}
            {index === standing.length - 1 ? <PlateHost /> : null}
          </li>
        ))}
      </ul>
    </>
  )
}

const previewSnapshot: OverlaySnapshot = {
  status: "open",
  closesAt: null,
  entrantCount: 128,
  ticketTotal: 128,
  winnerCount: 1,
  chatClaimUnavailable: false,
  chatEntryOff: false,
  subEntryOff: false,
  pointsEntryOff: false,
  rerollOpen: false,
  rerollBlocked: null,
  title: null,
  code: "ABCDE",
  entriesPerSecond: 0,
  lastNames: ["pixel_fox", "nightowl", "ada_plays"],
  winners: [],
  roleRefreshFailures: 0,
  eventSubFailures: 0,
  drawAvailableAt: null,
  drawRequested: false,
  shuffleNames: [],
  now: 0,
}

const previewWinners: readonly LiveWinner[] = [
  {
    n: 0,
    entrySeq: 1,
    displayName: "nightowl",
    profileImageUrl: null,
    claimUntil: 0,
    claim: { state: "claimed", at: 0, via: "rafflink" },
  },
]

/**
 * The deployment's mark and host as the last row of a plate that does not show the entry link: the shuffle, the
 * winners, and the entry plate once it names the winners instead of the link.
 */
function PlateHost() {
  return (
    <p className="overlay-host">
      <span className="brand-mark" aria-hidden="true">
        R
      </span>
      {siteHost()}
    </p>
  )
}

/** A batch too large for one plate per winner: the newest names in columns on one plate, and how many more there are. */
function WinnerListPlate({
  standing,
  prize,
}: {
  readonly standing: readonly LiveWinner[]
  readonly prize: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  const hidden = standing.length - listedWinnersMax
  return (
    <div className="overlay-plate overlay-winner overlay-winner-list">
      <div>
        <h2 className="overlay-label">{t("overlay.winners")}</h2>
        <p className="overlay-prize">{prize}</p>
        <ol>
          {standing.slice(-listedWinnersMax).map((winner) => (
            <li key={winner.n}>{winner.displayName ?? t("winner.removed")}</li>
          ))}
        </ol>
        {hidden > 0 ? (
          <p className="overlay-label">
            {t("overlay.moreWinners", { count: i18n.number(hidden) })}
          </p>
        ) : null}
      </div>
      <PlateHost />
    </div>
  )
}

function ClaimTimer({ winner }: { readonly winner: LiveWinner }) {
  const { t } = useI18n()
  const { now } = useClock()
  const [initial] = useState(() => Math.max(0, winner.claimUntil - now()))
  const remaining = useRemainingMs(initial)
  return (
    <div className="overlay-timer">
      <strong role="timer">{formatClock(remaining)}</strong>
      <span>{t("home.stage.toClaim")}</span>
    </div>
  )
}
