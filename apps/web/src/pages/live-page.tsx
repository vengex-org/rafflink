import { useState } from "react"
import { useParams } from "react-router"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import {
  closeEntries,
  drawWinners,
  liveSnapshotPath,
  markClaimed,
  rerollWinner,
} from "../api/client.ts"
import { ConfirmAction } from "../components/confirm-action.tsx"
import { AlertIcon } from "../components/icons.tsx"
import { EntrantNames, Stat, WinnerList } from "../components/live-parts.tsx"
import { Failed, Loading, NotFound, SignIn, Status } from "../components/notice.tsx"
import { ShareLinks } from "../components/share-panel.tsx"
import { StepIndicator } from "../components/step-indicator.tsx"
import { closeText, drawText, markClaimedText, rerollText, statusLabel } from "../lib/messages.ts"
import { peopleText } from "../lib/rules-text.ts"
import { useAction } from "../lib/use-action.ts"
import { useLive } from "../lib/use-live.ts"

const stepNames = ["Collect entries", "Draw winners", "Winners claim"] as const

export function LivePage() {
  const { id } = useParams()
  return id === undefined ? <NotFound title="Giveaway not found" /> : <Loaded id={id} />
}

function Loaded({ id }: { readonly id: string }) {
  const live = useLive(liveSnapshotPath(id))
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
      return <SignIn why="Sign in with Twitch to open the live page of your giveaway." />
    case "not-found":
      return <NotFound title="Giveaway not found" />
    case "ready":
      return <Controls id={id} snapshot={live.snapshot} connected={live.connected} />
  }
}

function Controls({
  id,
  snapshot,
  connected,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly connected: boolean
}) {
  const { message, busy, run } = useAction()

  const winnerActions = (winner: LiveWinner) => {
    const open = winner.claim.state === "waiting"
    const expired = winner.claim.state === "expired"
    const name = winner.displayName ?? `winner ${winner.n + 1}`
    return (
      <span className="actions">
        {snapshot.chatClaimUnavailable && open ? (
          <button
            type="button"
            className="button small"
            disabled={busy}
            aria-label={`Mark as claimed for ${name}`}
            onClick={() => void run(() => markClaimed(id, winner.n), markClaimedText)}
          >
            Mark as claimed
          </button>
        ) : null}
        {open || expired ? (
          <ConfirmAction
            label="Pick another winner"
            question={`Pick another winner instead of ${name}?`}
            detail={`${name} loses the prize. This cannot be undone.`}
            confirmLabel="Yes, pick another winner"
            busy={busy}
            disabled={false}
            quiet={open}
            onConfirm={() => void run(() => rerollWinner(id, winner.n), rerollText)}
          />
        ) : null}
      </span>
    )
  }

  return (
    <>
      {connected ? null : <output className="status">Reconnecting to the live feed…</output>}
      <header className="page-head">
        <div>
          <h1>{snapshot.title}</h1>
          <p className="muted">Code {snapshot.code}</p>
        </div>
        <span className="pill" data-status={snapshot.status}>
          {statusLabel[snapshot.status]}
        </span>
      </header>
      <StepIndicator steps={stepNames} current={stepOf(snapshot.status)} />
      {snapshot.chatClaimUnavailable ? (
        <section role="alert" className="card banner" data-tone="warning">
          <span className="state-icon">
            <AlertIcon />
          </span>
          <h2>Chat watch is off</h2>
          <p>
            Chat claim unavailable: Rafflink cannot read your chat right now, so winners cannot
            claim by typing there. When a winner tells you they are in, press Mark as claimed next
            to their name.
          </p>
        </section>
      ) : null}
      {snapshot.status === "open" ? (
        <OpenStep id={id} snapshot={snapshot} busy={busy} run={run} />
      ) : null}
      {snapshot.status === "closed" ? (
        <DrawStep id={id} snapshot={snapshot} busy={busy} run={run} />
      ) : null}
      {snapshot.status === "drawn" ? (
        <section className="card next" aria-labelledby="winners-title">
          <h2 id="winners-title">Winners</h2>
          <p>
            Each winner has a limited time to claim the prize. They claim on the giveaway page
            {snapshot.chatClaimUnavailable ? "." : " or by typing in your chat."}
          </p>
          <WinnerList winners={snapshot.winners} actions={winnerActions} />
        </section>
      ) : null}
      {message === null ? null : <Status>{message}</Status>}
      <Problems snapshot={snapshot} />
    </>
  )
}

type Run = ReturnType<typeof useAction>["run"]

function OpenStep({
  id,
  snapshot,
  busy,
  run,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly busy: boolean
  readonly run: Run
}) {
  return (
    <>
      <section className="card next" aria-labelledby="open-title">
        <h2 id="open-title">Entries are open</h2>
        <dl className="stats">
          <Stat value={snapshot.entrantCount.toLocaleString("en-US")} label="people entered" />
          <Stat value={snapshot.entriesPerSecond.toFixed(1)} label="entries per second" />
          <Stat value={snapshot.ticketTotal.toLocaleString("en-US")} label="tickets in total" />
        </dl>
        <h3>Latest entrants</h3>
        <EntrantNames names={snapshot.lastNames} />
        {snapshot.closesAt === null ? null : (
          <p className="muted">
            Entries close by themselves at {new Date(snapshot.closesAt).toLocaleString()}.
          </p>
        )}
        <ConfirmAction
          label="Close entries"
          question="Close entries now?"
          detail="Nobody new can enter after this. You cannot undo it."
          confirmLabel="Yes, close entries"
          busy={busy}
          disabled={false}
          quiet={false}
          onConfirm={() => void run(() => closeEntries(id), closeText)}
        />
      </section>
      <section className="card" aria-labelledby="share-title">
        <h2 id="share-title">Share with your chat</h2>
        <ShareLinks code={snapshot.code} />
      </section>
    </>
  )
}

function DrawStep({
  id,
  snapshot,
  busy,
  run,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly busy: boolean
  readonly run: Run
}) {
  const [count, setCount] = useState("1")
  const winners = Number(count)
  const countValid = count.trim() !== "" && Number.isInteger(winners) && winners >= 1
  const blocked =
    snapshot.entrantCount === 0
      ? "Nobody entered, so there is nobody to draw."
      : countValid
        ? null
        : "Enter a whole number of winners, at least 1."
  return (
    <section className="card next" aria-labelledby="draw-title">
      <h2 id="draw-title">Entries are closed</h2>
      <p>
        {peopleText(snapshot.entrantCount)}. Now choose how many winners you want and draw them.
      </p>
      <div className="field">
        <label htmlFor="draw-count">How many winners?</label>
        <input
          id="draw-count"
          type="number"
          min={1}
          value={count}
          aria-describedby="draw-help"
          onChange={(event) => setCount(event.currentTarget.value)}
        />
        <p id="draw-help" className="help">
          {blocked
            ?? (countValid && winners > snapshot.entrantCount
              ? `Only ${snapshot.entrantCount} entered, so you may get fewer winners than this.`
              : "Winners are picked at random from everyone who entered.")}
        </p>
      </div>
      <ConfirmAction
        label="Draw winners"
        question={`Draw ${winners} ${winners === 1 ? "winner" : "winners"} now?`}
        detail="The winners are picked at random. You cannot undo this."
        confirmLabel="Yes, draw winners"
        busy={busy}
        disabled={blocked !== null}
        quiet={false}
        onConfirm={() => void run(() => drawWinners(id, winners), drawText)}
      />
    </section>
  )
}

function Problems({ snapshot }: { readonly snapshot: LiveSnapshot }) {
  if (snapshot.roleRefreshFailures === 0 && snapshot.eventSubFailures === 0) return null
  return (
    <section className="card" aria-labelledby="problems-title">
      <h2 id="problems-title">Problems</h2>
      <ul>
        {snapshot.roleRefreshFailures === 0 ? null : (
          <li>
            {snapshot.roleRefreshFailures} times Rafflink could not load your VIP and moderator
            lists from Twitch. Those viewers may be missing extra tickets.
          </li>
        )}
        {snapshot.eventSubFailures === 0 ? null : (
          <li>
            {snapshot.eventSubFailures} times Rafflink lost the connection to your chat. Chat watch
            may have missed messages.
          </li>
        )}
      </ul>
    </section>
  )
}

function stepOf(status: LiveSnapshot["status"]): number {
  switch (status) {
    case "open":
      return 1
    case "closed":
      return 2
    case "drawn":
      return 3
  }
}
