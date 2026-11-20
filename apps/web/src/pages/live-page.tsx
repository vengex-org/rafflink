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
import { LiveSummary } from "../components/live-summary.tsx"
import { Failed, Loading, NotFound, SignIn, Status } from "../components/notice.tsx"
import { closeText, drawText, markClaimedText, rerollText } from "../lib/messages.ts"
import { useAction } from "../lib/use-action.ts"
import { useLive } from "../lib/use-live.ts"

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
  const [count, setCount] = useState("1")

  const winnerActions = (winner: LiveWinner) => {
    const open = winner.claim.state === "waiting"
    const rerollable = open || winner.claim.state === "expired"
    return (
      <span className="actions">
        {snapshot.chatClaimUnavailable && open ? (
          <button
            type="button"
            disabled={busy}
            aria-label={`Mark winner ${winner.n + 1} as claimed`}
            onClick={() => void run(() => markClaimed(id, winner.n), markClaimedText)}
          >
            Mark claimed
          </button>
        ) : null}
        {rerollable ? (
          <button
            type="button"
            disabled={busy}
            aria-label={`Reroll winner ${winner.n + 1}`}
            onClick={() => void run(() => rerollWinner(id, winner.n), rerollText)}
          >
            Reroll
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <>
      <h1>Live giveaway</h1>
      {connected ? null : <output className="status">Reconnecting to the live feed…</output>}
      {snapshot.chatClaimUnavailable ? (
        <p role="alert" className="warning">
          Chat claim unavailable. Mark a claim by hand when a winner tells you in chat.
        </p>
      ) : null}
      <LiveSummary snapshot={snapshot} winnerActions={winnerActions} />
      <section aria-labelledby="controls">
        <h2 id="controls">Controls</h2>
        {snapshot.status === "open" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => closeEntries(id), closeText)}
          >
            Close entries
          </button>
        ) : null}
        {snapshot.status === "closed" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(() => drawWinners(id, Number(count)), drawText)
            }}
          >
            <div className="field">
              <label htmlFor="draw-count">Number of winners</label>
              <input
                id="draw-count"
                type="number"
                min={1}
                value={count}
                onChange={(event) => setCount(event.currentTarget.value)}
              />
            </div>
            <button type="submit" disabled={busy}>
              Draw winners
            </button>
          </form>
        ) : null}
        {message === null ? null : <Status>{message}</Status>}
      </section>
      <dl className="stats">
        <div>
          <dt>Role refresh failures</dt>
          <dd>{snapshot.roleRefreshFailures}</dd>
        </div>
        <div>
          <dt>EventSub failures</dt>
          <dd>{snapshot.eventSubFailures}</dd>
        </div>
      </dl>
    </>
  )
}
