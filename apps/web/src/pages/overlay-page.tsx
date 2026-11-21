import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "react-router"
import type { LiveWinner, OverlaySnapshot } from "@rafflink/core/room/giveaway-room"
import { overlaySnapshotPath, parseOverlaySnapshot } from "../api/client.ts"
import { UsersIcon } from "../components/icons.tsx"
import { EntrantNames, msUntil, Stat } from "../components/live-parts.tsx"
import { Failed, Loading } from "../components/notice.tsx"
import { DrawShuffle } from "../components/draw-shuffle.tsx"
import { QrCode } from "../components/qr-code.tsx"
import { WinnerPlate } from "../components/winner-plate.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { shareUrl } from "../lib/links.ts"
import { giveawayDisplayName, giveawayName } from "../lib/messages.ts"
import { readOverlayOptions, type OverlayOptions } from "../lib/overlay-options.ts"
import { useLive } from "../lib/use-live.ts"
import { useGiveawayFacts } from "../lib/use-giveaway-facts.ts"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { useDrawShuffle } from "../lib/use-draw-shuffle.ts"

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
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
    case "not-found":
      return <OverlayNotFound />
    case "ready":
      return <Overlay snapshot={live.snapshot} options={options} />
  }
}

function Overlay({
  snapshot,
  options,
}: {
  readonly snapshot: OverlaySnapshot
  readonly options: OverlayOptions
}) {
  const i18n = useI18n()
  const { t } = i18n
  // The snapshot carries no prize and the overlay fetches it only for the winner plates, so the heading names the code.
  const heading = (
    <h1 className="sr-only">
      {giveawayDisplayName(i18n, { title: snapshot.title, prize: null, code: snapshot.code })}
    </h1>
  )
  const shuffle = useDrawShuffle(snapshot)
  const standing = standingWinners(snapshot.winners)
  const qr = options.qr ? <QrCode value={shareUrl(snapshot.code)} label={t("overlay.qr")} /> : null
  if (shuffle.shuffling) {
    const waitMs =
      snapshot.drawAvailableAt === null ? null : snapshot.drawAvailableAt - snapshot.now
    return (
      <main className="overlay">
        {heading}
        <ul className="overlay-winners">
          <li className="overlay-plate overlay-winner">
            <div>
              <p className="overlay-label">{t("live.draw.due")}</p>
              <DrawShuffle key={waitMs} names={shuffle.names} waitMs={waitMs} />
            </div>
          </li>
        </ul>
      </main>
    )
  }
  if (snapshot.status === "drawn" && options.mode !== "compact") {
    return (
      <main className="overlay">
        {heading}
        <FetchedWinnerPlates snapshot={snapshot} standing={standing} />
        {qr === null ? null : <div className="overlay-plate overlay-qr">{qr}</div>}
      </main>
    )
  }
  if (options.mode === "winner") {
    return (
      <main className="overlay">
        {heading}
        {qr === null ? null : <div className="overlay-plate overlay-qr">{qr}</div>}
      </main>
    )
  }
  const drawn = snapshot.status === "drawn"
  return (
    <main className="overlay">
      {heading}
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
                {new URL(shareUrl(snapshot.code)).host}/<em>{snapshot.code}</em>
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
      </div>
    </main>
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

/** One plate per standing winner with the prize line and, while the claim is open, its clock. */
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
          </li>
        ))}
      </ul>
    </>
  )
}

function ClaimTimer({ winner }: { readonly winner: LiveWinner }) {
  const { t } = useI18n()
  const [initial] = useState(() => msUntil(winner.claimUntil))
  const remaining = useRemainingMs(initial)
  return (
    <div className="overlay-timer">
      <strong role="timer">{formatClock(remaining)}</strong>
      <span>{t("home.stage.toClaim")}</span>
    </div>
  )
}
