import { useCallback, useId, useState, type ReactNode } from "react"
import { useParams, useSearchParams } from "react-router"
import { groups, type Tickets } from "@rafflink/core/domain/groups"
import type { EntrantsDelta, LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import { liveSnapshotPath, parseLiveSnapshot } from "../api/client.ts"
import { ActorLog } from "../components/actor-log.tsx"
import { ActivityIcon, AlertIcon, EyeOffIcon, LogInIcon } from "../components/icons.tsx"
import { EntrantsSection, Tiers } from "../components/entrants-table.tsx"
import { ClaimStatus, isUnsettled, LiveActions, LiveSettings } from "../components/live-bar.tsx"
import { LiveBrand, LiveFrame, LiveTopBar } from "../components/live-frame.tsx"
import { LiveStage } from "../components/live-stage.tsx"
import { Failed, Loading, Notice, NotFound, SignIn, Status } from "../components/notice.tsx"
import { WinnerAnswersPanel } from "../components/winner-answers.tsx"
import type { GiveawayView } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { findBySeq } from "../lib/entrant-list.ts"
import { featureReconnectPath, livePath } from "../lib/routes.ts"
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
      <NotFound title="notFound.live" />
    </Plain>
  ) : (
    <Loaded id={id} />
  )
}

/** A state with no giveaway to show: the frame with the brand only. */
export function Plain({ children }: { readonly children: ReactNode }) {
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
    case "forbidden":
    case "not-found":
      return (
        <Plain>
          <NotFound title="notFound.live" />
        </Plain>
      )
    case "ready":
      return (
        <Connected
          key={id}
          id={id}
          snapshot={live.snapshot}
          connected={live.connected}
          entrantsAfter={live.entrantsAfter}
          overlayToken={live.overlayToken}
          donateUrl={live.donateUrl}
        />
      )
  }
}

/** The live page over the API: loads the giveaway's facts and the entrant list that the controls show. */
function Connected({
  id,
  snapshot,
  connected,
  entrantsAfter,
  overlayToken,
  donateUrl,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly connected: boolean
  readonly entrantsAfter: EntrantsDelta | null
  readonly overlayToken: string | null
  readonly donateUrl: string | null
}) {
  const { facts } = useGiveawayFacts(snapshot.code)
  const entrants = useEntrants(id, { connected, entrantsAfter })
  return (
    <LiveControls
      id={id}
      snapshot={snapshot}
      connected={connected}
      overlayToken={overlayToken}
      donateUrl={donateUrl}
      cleanModeKey={liveCleanModeKey}
      facts={facts}
      entrants={entrants}
      winnerAnswers
    />
  )
}

/** The live page for data it is given; a hosted demo (site seam) gives it a simulated giveaway, a moderator link's page its own requests. */
export function LiveControls({
  id,
  snapshot,
  connected,
  overlayToken,
  donateUrl,
  cleanModeKey,
  facts,
  entrants,
  winnerAnswers,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly connected: boolean
  readonly overlayToken: string | null
  readonly donateUrl: string | null
  /** Where the clean-mode choice is stored, so a hosted demo (site seam) does not share it with the real page. */
  readonly cleanModeKey: string
  readonly facts: GiveawayView | null
  readonly entrants: ReturnType<typeof useEntrants>
  /** Shows the winners' form answers: true on the streamer's own page only, never on a moderator link's. */
  readonly winnerAnswers: boolean
}) {
  const { t } = useI18n()
  const { message, busy, run } = useAction()
  const [clean, toggleClean] = useCleanMode(cleanModeKey)
  const rerollOver = rerollOverText(snapshot)
  // With the chat watch stopped, its own banner says which entry way that costs.
  const entryWayOff = snapshot.chatClaimUnavailable ? null : entryWayOffText(snapshot)
  const current = currentWinner(snapshot.winners)
  const currentEntrant =
    current === null || current.entrySeq === null
      ? null
      : (findBySeq(entrants.rows, current.entrySeq) ?? null)

  return (
    <LiveFrame bar={<LiveTopBar snapshot={snapshot} facts={facts} controls={!clean} />}>
      <div className="live-page" data-clean={clean}>
        <div className="live-left">
          {connected ? null : <output className="status">{t("live.reconnecting")}</output>}
          {snapshot.chatClaimUnavailable ? (
            <section role="alert" className="card banner" data-tone="warning">
              <span className="state-icon">
                <AlertIcon />
              </span>
              <h2>{t("live.chatOff.title")}</h2>
              <p>{t(chatOffText(snapshot))}</p>
            </section>
          ) : null}
          {entryWayOff !== null ? (
            <section role="alert" className="card banner" data-tone="warning">
              <span className="state-icon">
                <AlertIcon />
              </span>
              <h2>{t("live.entryWayOff.title")}</h2>
              <p>{t(entryWayOff)}</p>
            </section>
          ) : null}
          {/* Only the streamer can reconnect, so a moderator link's page leaves it out. */}
          {snapshot.rolesPaused && winnerAnswers ? <RolesPausedNotice id={id} /> : null}
          {rerollOver !== null && snapshot.winners.some(isUnsettled) ? (
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
            showChat={!clean}
          />
          {message === null ? null : <Status>{t(message)}</Status>}
          <Problems snapshot={snapshot} />
          <EntrantsSection
            entrants={entrants}
            snapshot={snapshot}
            current={current}
            controls={clean ? null : { id, busy, run }}
          />
        </div>
        {clean ? null : (
          <LiveActions id={id} busy={busy} run={run} snapshot={snapshot} current={current} />
        )}
        <aside className="live-side" aria-label={t("live.side.label")}>
          {clean || snapshot.status !== "drawn" ? null : (
            <ClaimStatus winners={snapshot.winners} current={current} />
          )}
          {winnerAnswers
          && !clean
          && snapshot.status === "drawn"
          && facts !== null
          && facts.rules.winnerForm.length > 0 ? (
            <WinnerAnswersPanel id={id} winners={snapshot.winners} />
          ) : null}
          <LiveStats snapshot={snapshot} facts={facts} rows={entrants.rows} />
          <ActorLog actors={snapshot.actors} />
          {clean ? (
            <button type="button" className="live-btn ghost live-show" onClick={toggleClean}>
              <EyeOffIcon />
              {t("live.clean.show")}
            </button>
          ) : (
            <LiveSettings
              id={id}
              busy={busy}
              run={run}
              snapshot={snapshot}
              overlayToken={overlayToken}
              donateUrl={donateUrl}
              modsOffered={facts === null || facts.capabilities.moderatorRole}
              onHide={toggleClean}
            />
          )}
        </aside>
      </div>
    </LiveFrame>
  )
}

/** The numbers beside the list: how fast people enter while entries are open, and how many entered per tier when some tiers get bonus tickets or the rules are unknown. */
function LiveStats({
  snapshot,
  facts,
  rows,
}: {
  readonly snapshot: LiveSnapshot
  readonly facts: GiveawayView | null
  readonly rows: ReturnType<typeof useEntrants>["rows"]
}) {
  const i18n = useI18n()
  const { t } = i18n
  const headId = useId()
  const open = snapshot.status === "open"
  const tickets = facts === null ? null : facts.rules.tickets
  const showTiers = tickets === null ? rows.length > 0 : hasBonusTickets(tickets)
  if (!open && !showTiers) return null
  return (
    <section className="live-card live-stats" aria-labelledby={headId}>
      <h2 id={headId}>{t("live.stats.title")}</h2>
      {open ? (
        <p className="live-rate">
          <ActivityIcon />
          <strong>{i18n.decimal(snapshot.entriesPerSecond)}</strong> {t("stat.perSecond")}
        </p>
      ) : null}
      {showTiers ? <Tiers rows={rows} ticketsPerGroup={tickets} /> : null}
    </section>
  )
}

/** Whether the groups that may enter get different numbers of tickets. */
function hasBonusTickets(tickets: Tickets): boolean {
  return new Set(groups.map((group) => tickets[group]).filter((count) => count > 0)).size > 1
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

const liveCleanModeKey = "rafflink-live-clean"

/**
 * Clean mode hides the controls for the stream. The choice is stored; the c key flips it unless the streamer is typing or a question is open.
 * A link with `?clean=1` (or `0`) opens the page in that mode whatever is stored; flipping it from then on is the stored choice again.
 */
function useCleanMode(storageKey: string): readonly [boolean, () => void] {
  const [params, setParams] = useSearchParams()
  const [clean, setClean] = useState(() => {
    const linked = params.get("clean")
    return linked === null ? readStored(storageKey) === "1" : linked === "1"
  })
  const toggle = useCallback(() => {
    writeStored(storageKey, clean ? "0" : "1")
    setClean(!clean)
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete("clean")
        return next
      },
      { replace: true },
    )
  }, [clean, storageKey, setParams])
  useShortcut("c", toggle)
  return [clean, toggle]
}

/** What the stopped watch costs: chat entry while it is on, else the sub or points entry, else the chat claim. */
function chatOffText(snapshot: LiveSnapshot): MessageKey {
  if (snapshot.chatEntryOff) return "live.chatEntryOff.text"
  return entryWayOffText(snapshot) ?? "live.chatOff.text"
}

/** Which of sub and points entry is off, or null while every way the giveaway takes works. */
function entryWayOffText(snapshot: LiveSnapshot): MessageKey | null {
  if (snapshot.subEntryOff && snapshot.pointsEntryOff) return "live.channelEntryOff.text"
  if (snapshot.subEntryOff) return "live.subEntryOff.text"
  return snapshot.pointsEntryOff ? "live.pointsEntryOff.text" : null
}

/** Why the streamer cannot pick another winner, or null while they can (or nothing is left to pick). */
function rerollOverText(snapshot: LiveSnapshot): MessageKey | null {
  if (snapshot.status !== "drawn") return null
  switch (snapshot.rerollBlocked) {
    case "window-over":
      return "live.reroll.over"
    case "nobody-left":
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

/**
 * The streamer's token cannot read VIPs and moderators, so they enter with viewer tickets until the streamer
 * reconnects; entries go on meanwhile and the notice goes once a role refresh succeeds.
 */
function RolesPausedNotice({ id }: { readonly id: string }) {
  const { t } = useI18n()
  return (
    <Notice tone="warning">
      <p>{t("live.rolesPaused")}</p>
      <div className="notice-action">
        <a
          className="button outlined"
          href={featureReconnectPath("twitch", ["roles"], livePath(id))}
        >
          <LogInIcon />
          {t("wizard.reconnect.button", { platform: "Twitch" })}
        </a>
      </div>
    </Notice>
  )
}
