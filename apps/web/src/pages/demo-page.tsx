import { useEffect, useReducer, useState, type MouseEvent } from "react"
import type { GiveawayView } from "../api/client.ts"
import { ClaimPanel } from "../components/giveaway-claim.tsx"
import { EntryPanel } from "../components/giveaway-entry.tsx"
import { GiveawayFacts, GiveawayRules } from "../components/giveaway-facts.tsx"
import { GiveawayHead, GiveawayPhase } from "../components/giveaway-head.tsx"
import { Page } from "../components/page.tsx"
import { StatusChip } from "../components/status-chip.tsx"
import { WinnerPlate } from "../components/winner-plate.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import {
  demoClaimMs,
  demoClosesInMs,
  demoEntry,
  demoJoinEveryMs,
  demoReducer,
  demoRules,
  demoStepMs,
  demoViewerName,
  initialDemoState,
  type DemoState,
} from "../lib/demo-script.ts"
import type { WonView } from "../lib/viewer-outcome.ts"

/** A giveaway that plays itself in the browser with made-up names; nothing leaves the page. */
export function DemoPage() {
  const [run, setRun] = useState(0)
  return <DemoRun key={run} onReplay={() => setRun(run + 1)} />
}

function DemoRun({ onReplay }: { readonly onReplay: () => void }) {
  const { t } = useI18n()
  const [state, dispatch] = useReducer(demoReducer, initialDemoState)
  const { step } = state

  useEffect(() => {
    const delay = demoStepMs[step]
    if (delay === null) return
    const timer = setTimeout(() => dispatch({ type: "advance", now: Date.now() }), delay)
    return () => clearTimeout(timer)
  }, [step])

  useEffect(() => {
    if (step !== "rising") return
    const timer = setInterval(() => dispatch({ type: "join" }), demoJoinEveryMs)
    return () => clearInterval(timer)
  }, [step])

  // The buttons and links of the real panels would sign in or call the API; here they move the script on.
  const driveScript = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("a, button") === null) return
    event.preventDefault()
    event.stopPropagation()
    if (step === "open" || step === "won") dispatch({ type: "advance", now: Date.now() })
  }

  const giveaway = demoGiveaway(state)
  const drawn = giveaway.status === "drawn"
  const win: WonView = {
    kind: "won",
    userId: "demo",
    n: 0,
    entry: demoEntry,
    claimRemainingMs: demoClaimMs,
    claim:
      state.claimedAt === null
        ? { state: "waiting" }
        : { state: "claimed", at: state.claimedAt, via: "rafflink" },
    chatClaimAvailable: false,
  }

  return (
    <Page width="compact" as="article" className="viewer demo">
      <div className="demo-bar">
        <StatusChip tone="info">{t("demo.label")}</StatusChip>
        <p>{t("demo.note")}</p>
        <button type="button" className="button outlined" onClick={onReplay}>
          {t("demo.replay")}
        </button>
      </div>
      <GiveawayHead giveaway={giveaway} />
      {drawn ? null : <GiveawayPhase giveaway={giveaway} />}
      {step === "drawing" ? <output className="demo-drawing">{t("demo.drawing")}</output> : null}
      {drawn ? <WinnerPlate name={demoViewerName} /> : null}
      <div aria-live="polite" className="viewer-outcome" onClickCapture={driveScript}>
        {drawn ? (
          <ClaimPanel code={giveaway.code} win={win} giveaway={giveaway} />
        ) : (
          <EntryPanel
            entry={step === "open" ? null : { kind: "entered", entry: demoEntry }}
            tickets={step === "open" ? null : demoEntry}
            notDrawn={false}
            signedOut={false}
            showSteps={false}
            giveaway={giveaway}
            signInHref="/demo"
          />
        )}
      </div>
      <div className="viewer-details">
        {step === "entered" || step === "rising" ? (
          <ClosingFacts giveaway={giveaway} />
        ) : (
          <GiveawayFacts kind={drawn ? "pool" : "entry"} giveaway={giveaway} />
        )}
        <GiveawayRules giveaway={giveaway} />
      </div>
    </Page>
  )
}

/** Mounts when the visitor has entered, so its countdown to the close starts there. */
function ClosingFacts({ giveaway }: { readonly giveaway: GiveawayView }) {
  const [closesAt] = useState(() => Date.now() + demoClosesInMs)
  return <GiveawayFacts kind="entry" giveaway={{ ...giveaway, closesAt }} />
}

function demoGiveaway({ step, entrants }: DemoState): GiveawayView {
  const status =
    step === "closed" || step === "drawing"
      ? "closed"
      : step === "won" || step === "claimed"
        ? "drawn"
        : "open"
  return {
    code: "DEMO1",
    title: "Summer giveaway",
    prize: "A gaming chair",
    streamerName: "Streamy",
    rules: demoRules,
    status,
    closesAt: null,
    claimSeconds: demoClaimMs / 1000,
    entrantCount: entrants,
    finished: status === "drawn",
    poll: { intervalMs: 1000, maxMs: 1000 },
  }
}
