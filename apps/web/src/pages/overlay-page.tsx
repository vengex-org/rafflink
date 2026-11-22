import { useEffect, useState, type ReactNode } from "react"
import { useParams, useSearchParams } from "react-router"
import type { OverlayTheme } from "@rafflink/core/domain/overlay-theme"
import type { LiveWinner, OverlaySnapshot } from "@rafflink/core/room/giveaway-room"
import { overlaySnapshotPath, parseOverlaySnapshot } from "../api/client.ts"
import { Confetti } from "../components/confetti.tsx"
import { UsersIcon } from "../components/icons.tsx"
import { EntrantNames, Stat } from "../components/live-parts.tsx"
import { Failed, Loading } from "../components/notice.tsx"
import { DrawShuffle } from "../components/draw-shuffle.tsx"
import { QrCode } from "../components/qr-code.tsx"
import { WinnerPlate } from "../components/winner-plate.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { shareUrl, siteHost } from "../lib/links.ts"
import { giveawayDisplayName, giveawayName } from "../lib/messages.ts"
import { readOverlayOptions, type OverlayOptions } from "../lib/overlay-options.ts"
import { overlayThemeAttributes, overlayThemeStyle } from "../lib/overlay-theme.ts"
import { useLive } from "../lib/use-live.ts"
import { useGiveawayFacts } from "../lib/use-giveaway-facts.ts"
import { useOverlayTheme } from "../lib/use-overlay-theme.ts"
import { formatClock, useClock, useRemainingMs } from "../lib/use-remaining.ts"
import { useRevealCue } from "../lib/use-reveal-cue.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { useDrawShuffle, type DrawShuffle as ShuffleState } from "../lib/use-draw-shuffle.ts"

/** Names on the compact plate: what a viewer can read in a glance. */
const newestNames = 3

/** The read-only live view for an OBS browser source: no session, a transparent page, text only on solid plates. */
export function OverlayPage() {
  const { id, token } = useParams()
  const [params] = useSearchParams()
  useEffect(() => {
    document.documentElement.dataset.surface = "overlay"
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [])
  return id === undefined || token === undefined ? (
    <OverlayNotFound />
  ) : (
    <Loaded id={id} token={token} options={readOverlayOptions(params)} />
  )
}

/** No link back to the home page: this is on stream. */
function OverlayNotFound() {
  const { t } = useI18n()
  return (
    <main className="overlay">
      <h1 className="overlay-plate">{t("notFound.generic")}</h1>
    </main>
  )
}

function Loaded({
  id,
  token,
  options,
}: {
  readonly id: string
  readonly token: string
  readonly options: OverlayOptions
}) {
  const live = useLive(overlaySnapshotPath(id, token), parseOverlaySnapshot)
  const theme = useOverlayTheme(id, token)
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
    case "not-found":
      return <OverlayNotFound />
    case "ready":
      // Plates drawn before the theme is known would flash the default look on stream.
      return theme === null ? (
        <Loading />
      ) : (
        <Overlay snapshot={live.snapshot} options={options} theme={theme} />
      )
  }
}

function Overlay({
  snapshot,
  options,
  theme,
}: {
  readonly snapshot: OverlaySnapshot
  readonly options: OverlayOptions
  readonly theme: OverlayTheme
}) {
  const i18n = useI18n()
  const shuffle = useDrawShuffle(snapshot)
  const standing = standingWinners(snapshot.winners)
  const cue = useRevealCue(standing, shuffle.shuffling, theme)
  return (
    <main {...overlayFrameProps(theme)}>
      {/* The snapshot carries no prize and the overlay fetches it only for the winner plates, so the heading names the code. */}
      <h1 className="sr-only">
        {giveawayDisplayName(i18n, { title: snapshot.title, prize: null, code: snapshot.code })}
      </h1>
      <OverlayContent snapshot={snapshot} options={options} shuffle={shuffle} standing={standing} />
      {cue.confetti ? <Confetti key={cue.count} accent={theme.accent} text={theme.text} /> : null}
    </main>
  )
}

function OverlayContent({
  snapshot,
  options,
  shuffle,
  standing,
}: {
  readonly snapshot: OverlaySnapshot
  readonly options: OverlayOptions
  readonly shuffle: ShuffleState
  readonly standing: readonly LiveWinner[]
}) {
  const { t } = useI18n()
  const qr = options.qr ? <QrCode value={shareUrl(snapshot.code)} label={t("overlay.qr")} /> : null
  if (shuffle.shuffling) {
    const waitMs =
      snapshot.drawAvailableAt === null ? null : snapshot.drawAvailableAt - snapshot.now
    return <ShufflePlate names={shuffle.names} waitMs={waitMs} />
  }
  if (snapshot.status === "drawn" && options.mode !== "compact") {
    return (
      <>
        <FetchedWinnerPlates snapshot={snapshot} standing={standing} />
        {qr === null ? null : <div className="overlay-plate overlay-qr">{qr}</div>}
      </>
    )
  }
  if (options.mode === "winner") {
    return qr === null ? null : <div className="overlay-plate overlay-qr">{qr}</div>
  }
  return <EntryPlate snapshot={snapshot} qr={qr} />
}

/** The overlay root as a theme draws it: colors as custom properties, the rest as data attributes overlay.css reads. */
function overlayFrameProps(theme: OverlayTheme) {
  return { className: "overlay", style: overlayThemeStyle(theme), ...overlayThemeAttributes(theme) }
}

const previewSnapshot: OverlaySnapshot = {
  status: "open",
  closesAt: null,
  entrantCount: 128,
  ticketTotal: 128,
  winnerCount: 1,
  chatClaimUnavailable: false,
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
              {standing.map((winner) => winner.displayName ?? t("winner.removed")).join(", ")}
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

/** The prize is not in the snapshot, so it is fetched when the plates show; until then its line stays empty. */
function FetchedWinnerPlates({
  snapshot,
  standing,
}: {
  readonly snapshot: OverlaySnapshot
  readonly standing: readonly LiveWinner[]
}) {
  const i18n = useI18n()
  const { facts, pending } = useGiveawayFacts(snapshot.code)
  const named = facts?.prize
  const fallback = giveawayName(i18n, snapshot.title, snapshot.code)
  const prize = pending
    ? ""
    : named === null || named === undefined || named.trim() === ""
      ? fallback
      : named
  return <WinnerPlates standing={standing} prize={prize} />
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
