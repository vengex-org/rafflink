import { useCallback, useState, type ReactNode } from "react"
import { useParams } from "react-router"
import type { EntrantsDelta, LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { liveSnapshotPath, parseLiveSnapshot } from "../api/client.ts"
import { AlertIcon, EyeOffIcon } from "../components/icons.tsx"
import { EntrantsSection } from "../components/entrants-table.tsx"
import { LiveBar } from "../components/live-bar.tsx"
import { LiveBrand, LiveFrame, LiveTopBar } from "../components/live-frame.tsx"
import { LiveStage } from "../components/live-stage.tsx"
import { Failed, Loading, NotFound, SignIn, Status } from "../components/notice.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { findBySeq } from "../lib/entrant-list.ts"
import { readStored, writeStored } from "../lib/safe-storage.ts"
import { useAction } from "../lib/use-action.ts"
import { useEntrants } from "../lib/use-entrants.ts"
import { useGiveawayFacts } from "../lib/use-giveaway-facts.ts"
import { useLive } from "../lib/use-live.ts"
import { useShortcut } from "../lib/use-shortcut.ts"
import { standingWinners } from "../lib/standing-winners.ts"

export function LivePage() {
  const { id } = useParams()
  return id === undefined ? (
    <Plain>
      <NotFound title="notFound.giveaway" />
    </Plain>
  ) : (
    <Loaded id={id} />
  )
}

/** A state with no giveaway to show: the frame with the brand only. */
function Plain({ children }: { readonly children: ReactNode }) {
  return <LiveFrame bar={<LiveBrand />}>{children}</LiveFrame>
}

function Loaded({ id }: { readonly id: string }) {
  const live = useLive(liveSnapshotPath(id), parseLiveSnapshot)
  switch (live.state) {
    case "loading":
      return (
        <Plain>
          <Loading />
        </Plain>
      )
    case "failed":
      return (
        <Plain>
          <Failed />
        </Plain>
      )
    case "unauthorized":
      return (
        <Plain>
          <SignIn why="signIn.why.live" />
        </Plain>
      )
    case "not-found":
      return (
        <Plain>
          <NotFound title="notFound.giveaway" />
        </Plain>
      )
    case "ready":
      return (
        <Controls
          key={id}
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
  const { t } = useI18n()
  const { message, busy, run } = useAction()
  const [clean, toggleClean] = useCleanMode()
  const facts = useGiveawayFacts(snapshot.code)
  const entrants = useEntrants(id, { connected, entrantsAfter })
  const rerollOver = rerollOverText(snapshot)
  const current = currentWinner(snapshot.winners)
  const currentEntrant =
    current === null || current.entrySeq === null
      ? null
      : (findBySeq(entrants.rows, current.entrySeq) ?? null)

  return (
    <LiveFrame bar={<LiveTopBar snapshot={snapshot} facts={facts} />}>
      <div className="live-page" data-clean={clean}>
        <div className="live-left">
          {connected ? null : <output className="status">{t("live.reconnecting")}</output>}
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
          <LiveStage
            snapshot={snapshot}
            facts={facts}
            current={current}
            currentEntrant={currentEntrant}
            pickControls={clean ? null : { id, busy, run }}
          />
          {message === null ? null : <Status>{t(message)}</Status>}
          <Problems snapshot={snapshot} />
          {clean ? (
            <button type="button" className="live-btn ghost live-show" onClick={toggleClean}>
              <EyeOffIcon />
              {t("live.clean.show")}
            </button>
          ) : (
            <LiveBar
              id={id}
              busy={busy}
              run={run}
              snapshot={snapshot}
              current={current}
              overlayToken={overlayToken}
              onHide={toggleClean}
            />
          )}
        </div>
        <EntrantsSection
          entrants={entrants}
          entrantCount={snapshot.entrantCount}
          ticketTotal={snapshot.ticketTotal}
          ticketsPerGroup={facts === null ? null : facts.rules.tickets}
          winners={snapshot.winners}
        />
      </div>
    </LiveFrame>
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

const cleanModeKey = "rafflink-live-clean"

/** Clean mode hides the controls for the stream. The choice is stored; the c key flips it unless the streamer is typing or a question is open. */
function useCleanMode(): readonly [boolean, () => void] {
  const [clean, setClean] = useState(() => readStored(cleanModeKey) === "1")
  const toggle = useCallback(() => {
    writeStored(cleanModeKey, clean ? "0" : "1")
    setClean(!clean)
  }, [clean])
  useShortcut("c", toggle)
  return [clean, toggle]
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
  const standing = standingWinners(winners)
  return open.at(-1) ?? standing.at(-1) ?? null
}
