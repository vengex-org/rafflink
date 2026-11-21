import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
} from "react"
import { useSearchParams } from "react-router"
import type { GiveawayView } from "../api/client.ts"
import { ClaimPanel } from "../components/giveaway-claim.tsx"
import { EntryPanel } from "../components/giveaway-entry.tsx"
import { GiveawayFacts, GiveawayRules } from "../components/giveaway-facts.tsx"
import { GiveawayHead, GiveawayPhase } from "../components/giveaway-head.tsx"
import { Layout } from "../components/layout.tsx"
import { Page } from "../components/page.tsx"
import { SegmentRow, type SegmentRowOption } from "../components/segment-row.tsx"
import { StatusChip } from "../components/status-chip.tsx"
import { WinnerPlate } from "../components/winner-plate.tsx"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { demoFacts, demoLive, demoLiveApi, demoNames } from "../lib/demo-live.ts"
import {
  demoChatDelaysMs,
  demoChatScript,
  demoClaimKeyword,
  demoClaimMs,
  demoEntry,
  demoJoinEveryMs,
  demoReducer,
  demoStepMs,
  demoViewerName,
  initialDemoState,
  waitingPick,
  type DemoAction,
  type DemoChatKey,
  type DemoState,
} from "../lib/demo-script.ts"
import { LiveApiProvider } from "../lib/live-api.ts"
import type { WonView } from "../lib/viewer-outcome.ts"
import { LiveControls } from "./live-page.tsx"

type DemoView = "streamer" | "viewer"

const demoViews = ["streamer", "viewer"] as const satisfies readonly DemoView[]

const noRetry = () => {}

/** A giveaway that plays itself in the browser with made-up names; nothing leaves the page. */
export function DemoPage() {
  const [run, setRun] = useState(0)
  return <DemoRun key={run} onReplay={() => setRun(run + 1)} />
}

function DemoRun({ onReplay }: { readonly onReplay: () => void }) {
  const [params, setParams] = useSearchParams()
  const view: DemoView = params.get("view") === "streamer" ? "streamer" : "viewer"
  const [state, dispatch] = useReducer(demoReducer, initialDemoState)
  const { step } = state

  useEffect(() => {
    const delay = demoStepMs[step]
    if (delay === null) return
    const timer = setTimeout(() => dispatch({ type: "advance", now: Date.now() }), delay)
    return () => clearTimeout(timer)
  }, [step])

  const deadline = state.laterPicks
    .filter(waitingPick)
    .reduce<number | null>(
      (soonest, pick) => (soonest === null ? pick.claimUntil : Math.min(soonest, pick.claimUntil)),
      null,
    )
  useEffect(() => {
    if (deadline === null) return
    const timer = setTimeout(
      () => dispatch({ type: "expire", now: Math.max(Date.now(), deadline) }),
      Math.max(0, deadline - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [deadline])

  const nextChat = demoChatScript[state.chat.length]
  useEffect(() => {
    if (step !== "won" || nextChat === undefined || state.firstRerolled) return
    const timer = setTimeout(
      () => dispatch({ type: "chat", now: Date.now() }),
      demoChatDelaysMs[nextChat],
    )
    return () => clearTimeout(timer)
  }, [step, nextChat, state.firstRerolled])

  useEffect(() => {
    if (step !== "rising") return
    const timer = setInterval(() => dispatch({ type: "join" }), demoJoinEveryMs)
    return () => clearInterval(timer)
  }, [step])

  const bar = (
    <DemoBar
      view={view}
      onView={(next) => setParams({ view: next }, { replace: true })}
      onReplay={onReplay}
    />
  )
  return view === "streamer" ? (
    <StreamerDemo state={state} dispatch={dispatch} bar={bar} />
  ) : (
    <Layout account={false}>
      <ViewerDemo state={state} dispatch={dispatch} bar={bar} />
    </Layout>
  )
}

/** The label, the note, the switch between the two views of the same giveaway, and the replay button. */
function DemoBar({
  view,
  onView,
  onReplay,
}: {
  readonly view: DemoView
  readonly onView: (view: DemoView) => void
  readonly onReplay: () => void
}) {
  const { t } = useI18n()
  const options: readonly SegmentRowOption<DemoView>[] = demoViews.map((value) => ({
    value,
    label: t(`demo.view.${value}`),
    icon: null,
  }))
  return (
    <div className="demo-bar">
      <StatusChip tone="info">{t("demo.label")}</StatusChip>
      <p>{t("demo.note")}</p>
      <fieldset className="demo-switch" aria-label={t("demo.view.label")}>
        <SegmentRow
          name="demo-view"
          options={options}
          value={view}
          onSelect={onView}
          labels="shown"
        />
      </fieldset>
      <button type="button" className="button outlined" onClick={onReplay}>
        {t("demo.replay")}
      </button>
    </div>
  )
}

/** The streamer's live page over the simulated giveaway; its buttons change that state and send nothing. */
function StreamerDemo({
  state,
  dispatch,
  bar,
}: {
  readonly state: DemoState
  readonly dispatch: Dispatch<DemoAction>
  readonly bar: ReactNode
}) {
  const api = useMemo(() => demoLiveApi(dispatch), [dispatch])
  const [now] = useState(() => Date.now())
  const { t } = useI18n()
  const { snapshot, entrants, facts } = demoLive(
    state,
    now,
    (key) => demoChatText(key, t),
    demoNames(t),
  )
  return (
    <>
      <div className="demo-strip">{bar}</div>
      <LiveApiProvider value={api}>
        <LiveControls
          id="demo"
          snapshot={snapshot}
          connected
          overlayToken={null}
          cleanModeKey="rafflink-demo-clean"
          facts={facts}
          entrants={{ rows: entrants, phase: "ready", retry: noRetry }}
        />
      </LiveApiProvider>
    </>
  )
}

function ViewerDemo({
  state,
  dispatch,
  bar,
}: {
  readonly state: DemoState
  readonly dispatch: Dispatch<DemoAction>
  readonly bar: ReactNode
}) {
  const { step } = state

  // The buttons and links of the real panels would sign in or call the API; here they move the script on.
  const driveScript = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("a, button") === null) return
    event.preventDefault()
    event.stopPropagation()
    if (step === "open" || step === "won") dispatch({ type: "advance", now: Date.now() })
  }

  return (
    <Page width="compact" as="article" className="viewer demo">
      {bar}
      <DemoViewer state={state} heading="h1" showRules onOutcomeClick={driveScript} />
    </Page>
  )
}

/** The viewer page of the simulated giveaway at one step: the same panels a real viewer sees. */
export function DemoViewer({
  state,
  heading,
  showRules,
  onOutcomeClick,
}: {
  readonly state: DemoState
  readonly heading: "h1" | "h2"
  readonly showRules: boolean
  readonly onOutcomeClick?: (event: MouseEvent<HTMLElement>) => void
}) {
  const { t } = useI18n()
  const { step } = state
  const giveaway = demoFacts(state, demoNames(t))
  const drawn = giveaway.status === "drawn"
  return (
    <>
      <GiveawayHead giveaway={giveaway} as={heading} />
      {drawn ? null : <GiveawayPhase giveaway={giveaway} />}
      {step === "drawing" ? <output className="demo-drawing">{t("demo.drawing")}</output> : null}
      {drawn && !state.firstRerolled ? <WinnerPlate name={demoViewerName} /> : null}
      <div aria-live="polite" className="viewer-outcome" onClickCapture={onOutcomeClick}>
        {drawn ? (
          <DemoClaim state={state} giveaway={giveaway} />
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
        <GiveawayFacts kind={drawn ? "pool" : "entry"} giveaway={giveaway} />
        {showRules ? <GiveawayRules giveaway={giveaway} /> : null}
      </div>
    </>
  )
}

/** Mounts when the visitor is drawn, so the claim clock it shows starts at what is left of the window then. */
export function DemoClaim({
  state,
  giveaway,
}: {
  readonly state: DemoState
  readonly giveaway: GiveawayView
}) {
  const [now] = useState(() => Date.now())
  const win: WonView = {
    kind: "won",
    userId: "demo",
    n: 0,
    entry: demoEntry,
    claimRemainingMs: Math.max(0, (state.drawnAt ?? now) + demoClaimMs - now),
    claim: state.firstRerolled
      ? { state: "rerolled" }
      : state.claimedAt === null
        ? { state: "waiting" }
        : { state: "claimed", at: state.claimedAt, via: "rafflink" },
    chatClaimAvailable: true,
  }
  return <ClaimPanel code={giveaway.code} win={win} giveaway={giveaway} />
}

function demoChatText(key: DemoChatKey, t: I18n["t"]): string {
  switch (key) {
    case "thanks":
      return t("demo.chat.thanks")
    case "discord":
      return t("demo.chat.discord")
    case "claim":
      return demoClaimKeyword
  }
}
