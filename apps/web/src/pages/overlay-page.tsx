import { useEffect } from "react"
import { useParams, useSearchParams } from "react-router"
import type { OverlayTheme } from "@rafflink/core/domain/overlay-theme"
import type { LiveWinner, OverlaySnapshot } from "@rafflink/core/room/giveaway-room"
import { overlaySnapshotPath, parseOverlaySnapshot } from "../api/client.ts"
import { Confetti } from "../components/confetti.tsx"
import { Failed, Loading } from "../components/notice.tsx"
import {
  EntryPlate,
  overlayFrameProps,
  ShufflePlate,
  WinnerPlates,
} from "../components/overlay-plates.tsx"
import { QrCode } from "../components/qr-code.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { shareUrl } from "../lib/links.ts"
import { giveawayDisplayName, giveawayName } from "../lib/messages.ts"
import { readOverlayOptions, type OverlayOptions } from "../lib/overlay-options.ts"
import { useLive } from "../lib/use-live.ts"
import { useGiveawayFacts } from "../lib/use-giveaway-facts.ts"
import { useOverlayTheme, useReloadOnReconnect } from "../lib/use-overlay-theme.ts"
import { useRevealCue } from "../lib/use-reveal-cue.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { useDrawShuffle, type DrawShuffle as ShuffleState } from "../lib/use-draw-shuffle.ts"

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
  const { theme, takePush, reload } = useOverlayTheme(id, token)
  const live = useLive(overlaySnapshotPath(id, token), parseOverlaySnapshot, takePush)
  useReloadOnReconnect(live.state === "ready" && live.connected, reload)
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
    case "forbidden":
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
