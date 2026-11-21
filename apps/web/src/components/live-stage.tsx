import { useId, useState } from "react"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { Entrant } from "@rafflink/core/room/rows"
import type { GiveawayView } from "../api/client.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { peopleText } from "../lib/rules-text.ts"
import { useRemainingMs } from "../lib/use-remaining.ts"
import { claimTone, Countdown } from "./countdown.tsx"
import { DrawShuffle } from "./draw-shuffle.tsx"
import { UsersIcon } from "./icons.tsx"
import { Avatar, claimLabel, claimOutcome, msUntil, Stat } from "./live-parts.tsx"
import type { Tone } from "./state-card.tsx"
import { StatusChip } from "./status-chip.tsx"
import { WinnerChat } from "./winner-chat.tsx"
import { WinnerPlate } from "./winner-plate.tsx"
import { standingWinners } from "../lib/standing-winners.ts"
import { useDrawShuffle } from "../lib/use-draw-shuffle.ts"

/** What the stage shows for each step: that entries are open, the closed count, or the winner of the moment with the claim clock. */
export function LiveStage({
  snapshot,
  facts,
  current,
  currentEntrant,
  showChat,
}: {
  readonly snapshot: LiveSnapshot
  readonly facts: GiveawayView | null
  /** The winner on the plate; null before the draw or when nobody was drawn. */
  readonly current: LiveWinner | null
  /** The entrant behind `current`, once the entrants list has loaded far enough to contain them. */
  readonly currentEntrant: Entrant | null
  /** False in clean mode: viewers' chat text must not reach a shared screen. */
  readonly showChat: boolean
}) {
  const shuffle = useDrawShuffle(snapshot)
  if (shuffle.shuffling) {
    return <ShuffleStage names={shuffle.names} waitMs={waitMsOf(snapshot)} />
  }
  switch (snapshot.status) {
    case "open":
      return <OpenStage snapshot={snapshot} />
    case "closed":
      return <ClosedStage snapshot={snapshot} />
    case "drawn":
      return (
        <DrawnStage
          snapshot={snapshot}
          facts={facts}
          current={current}
          currentEntrant={currentEntrant}
          showChat={showChat}
        />
      )
  }
}

/** The winner slot while a draw is pending: names flash and the pick lands in its place. Picks stay out of it until the shuffle ends. */
function ShuffleStage({
  names,
  waitMs,
}: {
  readonly names: readonly string[]
  readonly waitMs: number | null
}) {
  const { t } = useI18n()
  const headId = useId()
  return (
    <section className="live-stage" aria-labelledby={headId}>
      <div className="live-stage-head">
        <h2 id={headId}>{t("live.draw.due")}</h2>
      </div>
      <div className="live-reveal">
        <div className="live-winner">
          <DrawShuffle key={waitMs} names={names} waitMs={waitMs} />
        </div>
      </div>
    </section>
  )
}

const waitMsOf = (snapshot: LiveSnapshot) =>
  snapshot.drawAvailableAt === null ? null : snapshot.drawAvailableAt - snapshot.now

function OpenStage({ snapshot }: { readonly snapshot: LiveSnapshot }) {
  const { t, dateTime } = useI18n()
  const headId = useId()
  return (
    <section className="live-stage" aria-labelledby={headId}>
      <div className="live-stage-head">
        <h2 id={headId}>{t("live.open.title")}</h2>
        {snapshot.closesAt === null ? null : (
          <p>{t("live.closesAt", { time: dateTime(snapshot.closesAt) })}</p>
        )}
      </div>
    </section>
  )
}

function ClosedStage({ snapshot }: { readonly snapshot: LiveSnapshot }) {
  const i18n = useI18n()
  const { t } = i18n
  const headId = useId()
  return (
    <section className="live-stage" aria-labelledby={headId}>
      <div className="live-stage-head">
        <h2 id={headId}>{t("live.draw.title")}</h2>
      </div>
      <div className="live-closed">
        <dl className="stats live-big-count">
          <Stat
            icon={<UsersIcon />}
            value={i18n.number(snapshot.entrantCount)}
            label={t("stat.people")}
          />
        </dl>
        <p>{t("live.draw.text", { people: peopleText(i18n, snapshot.entrantCount) })}</p>
      </div>
    </section>
  )
}

function DrawnStage({
  snapshot,
  facts,
  current,
  currentEntrant,
  showChat,
}: {
  readonly snapshot: LiveSnapshot
  readonly facts: GiveawayView | null
  readonly current: LiveWinner | null
  readonly currentEntrant: Entrant | null
  readonly showChat: boolean
}) {
  const i18n = useI18n()
  const { t } = i18n
  const headId = useId()
  const standing = standingWinners(snapshot.winners)
  const name = current?.displayName ?? t("winner.removed")
  return (
    <section className="live-stage" aria-labelledby={headId}>
      <div className="live-stage-head">
        <h2 id={headId}>
          {current === null
            ? t("live.winners.title")
            : t("live.winnerOf", {
                n: i18n.number(standing.indexOf(current) + 1),
                total: i18n.number(standing.length),
              })}
        </h2>
        <p>{t("live.pickedFrom", { tickets: i18n.plural("ticket", snapshot.ticketTotal) })}</p>
        <Progress standing={standing} current={current} />
      </div>
      {current === null ? null : (
        <div className="live-reveal" data-settled={current.claim.state !== "waiting"}>
          <div className="live-winner">
            <div className="live-who">
              <Avatar name={name} imageUrl={current.profileImageUrl} />
              {currentEntrant === null ? null : (
                <div className="live-meta">
                  <span className="live-badge">{tierText(currentEntrant, t)}</span>
                  <span className="live-stub">{i18n.plural("ticket", currentEntrant.tickets)}</span>
                </div>
              )}
            </div>
            <WinnerPlate key={current.n} name={name} />
            {current.claim.state === "waiting" ? (
              <p className="live-claim-hint">
                <ClaimHint snapshot={snapshot} facts={facts} name={name} />
              </p>
            ) : (
              <div className="live-settled">
                <StatusChip tone={settledTone(current)}>{claimOutcome(current, t)}</StatusChip>
                {current.claim.state === "claimed" ? (
                  <p>{i18n.dateTime(current.claim.at)}</p>
                ) : null}
              </div>
            )}
            {showChat ? (
              <WinnerChat
                lines={snapshot.winnerChat}
                hint={
                  snapshot.chatClaimUnavailable
                  || snapshot.rerollBlocked === "window-over" ? null : (
                    <ChatHint facts={facts} waiting={current.claim.state === "waiting"} />
                  )
                }
              />
            ) : null}
          </div>
          {current.claim.state === "waiting" ? (
            <div className="live-timer">
              <ClaimRing
                key={`${current.n}-${current.claimUntil}`}
                until={current.claimUntil}
                windowMs={facts === null ? null : facts.claimSeconds * 1000}
              />
              {facts === null ? null : (
                <p>{t("live.claimWindow", { seconds: i18n.number(facts.claimSeconds) })}</p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

/** One segment per winner still in the draw: settled ones filled, the one on the plate in the accent. */
function Progress({
  standing,
  current,
}: {
  readonly standing: readonly LiveWinner[]
  readonly current: LiveWinner | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <ol className="live-progress" aria-label={t("live.progress")}>
      {standing.map((winner) => (
        <li key={winner.n} data-state={segmentState(winner, current)}>
          <span className="sr-only">
            {winner.displayName ?? t("winner.removed")}: {claimLabel(winner, i18n)}
          </span>
        </li>
      ))}
    </ol>
  )
}

function segmentState(winner: LiveWinner, current: LiveWinner | null): "now" | "done" | "todo" {
  if (winner === current) return "now"
  return winner.claim.state === "waiting" ? "todo" : "done"
}

const ringRadius = 52
const ringLength = 2 * Math.PI * ringRadius

/** The claim clock as a ring that empties with the time left. `windowMs` is the whole claim window when it is known; otherwise the ring starts full when the page first shows it. */
function ClaimRing({
  until,
  windowMs,
}: {
  readonly until: number
  readonly windowMs: number | null
}) {
  const [initial] = useState(() => msUntil(until))
  const remaining = useRemainingMs(initial)
  const whole = Math.max(windowMs ?? initial, initial, 1)
  return (
    <div className="live-ring" data-tone={claimTone(remaining)}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="live-ring-track" cx="60" cy="60" r={ringRadius} />
        <circle
          className="live-ring-bar"
          cx="60"
          cy="60"
          r={ringRadius}
          strokeDasharray={ringLength}
          strokeDashoffset={ringLength * (1 - Math.min(1, remaining / whole))}
        />
      </svg>
      <Countdown initialMs={initial} />
    </div>
  )
}

function ClaimHint({
  snapshot,
  facts,
  name,
}: {
  readonly snapshot: LiveSnapshot
  readonly facts: GiveawayView | null
  readonly name: string
}) {
  const { t, rich } = useI18n()
  const who = <strong>{name}</strong>
  if (snapshot.chatClaimUnavailable) return rich("live.claimHint.page", { name: who })
  if (facts === null) return t("live.winners.pageOrChat")
  const keyword = facts.rules.claimKeyword
  return keyword === null
    ? rich("live.claimHint.anyChat", { name: who })
    : rich("live.claimHint.keyword", { name: who, keyword: <strong>{keyword}</strong> })
}

/** What the winner chat box will show once the winner writes, and, while the claim is open, whether a message claims the prize. */
function ChatHint({
  facts,
  waiting,
}: {
  readonly facts: GiveawayView | null
  readonly waiting: boolean
}) {
  const { t, rich } = useI18n()
  if (!waiting) return t("live.chat.hint.settled")
  if (facts === null) return t("live.chat.hint")
  const keyword = facts.rules.claimKeyword
  return keyword === null
    ? t("live.chat.hint.anyChat")
    : rich("live.chat.hint.keyword", { keyword: <strong>{keyword}</strong> })
}

function tierText(entrant: Entrant, t: I18n["t"]): string {
  const tier = t(`tier.${entrant.group}`)
  return entrant.group.startsWith("sub_") ? t("live.winnerSub", { tier }) : tier
}

function settledTone(winner: LiveWinner): Tone {
  switch (winner.claim.state) {
    case "claimed":
      return "success"
    case "waiting":
      return "info"
    case "expired":
    case "rerolled":
      return "danger"
  }
}
