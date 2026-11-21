import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { DemoViewer } from "../pages/demo-page.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { demoNames, type DemoLive } from "../lib/demo-live.ts"
import { exampleDraw, restingStageStep, stageSteps, type StageStep } from "../lib/home-example.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { useDragScroll } from "../lib/use-drag-scroll.ts"
import { ClockProvider, useClock, type Clock } from "../lib/use-remaining.ts"
import { PauseIcon, PlayIcon } from "./icons.tsx"
import { EntryPlate, ShufflePlate, WinnerPlates } from "../pages/overlay-page.tsx"

const reducedMotion = "(prefers-reduced-motion: reduce)"
/** How long the loop keeps the current step after the visitor last scrolled the phone. */
const holdAfterScrollMs = 4000

/**
 * The home page's picture of the product: a stream with the real overlay plates over it and the real viewer page
 * of the winner beside it, both fed by the demo giveaway. They play its story in a loop: entries open, drawing,
 * winner, claimed. A thin bar above shows how far the loop is, with a play/pause button at its end, and the step
 * labels below jump to their step. The pictured pieces send no request and take no input. Their clocks read the
 * stage's time, which stands still whenever the loop does.
 *
 * Under reduced motion the stage starts paused on the winner and plays only when the visitor presses play; the step
 * labels still switch steps, since a jump is not motion, and the bar shows the step without filling.
 */
export function HomeStage() {
  const { t } = useI18n()
  const [calm] = useState(() => window.matchMedia(reducedMotion).matches)
  const dragging = useRef(false)
  const [held, hold] = usePhoneHold(dragging)
  const { index, round, paused, running, togglePause, goTo } = useStageLoop(calm, held)
  const clock = useStageClock(running)
  return (
    <section className="home-stage" aria-label={t("home.preview.label")}>
      <div className="stage-controls">
        <div
          key={round}
          className="stage-progress"
          data-paused={running ? undefined : ""}
          aria-hidden="true"
        >
          {stageSteps.map(({ step, ms }, position) => (
            <span
              key={step}
              data-state={segmentState(position, index)}
              style={{ flexGrow: ms, animationDuration: `${ms}ms` }}
            />
          ))}
        </div>
        <button
          type="button"
          className="icon-button stage-toggle"
          aria-label={t(paused ? "home.stage.play" : "home.stage.pause")}
          onClick={togglePause}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
      </div>
      <ClockProvider value={clock}>
        <ExampleStep
          key={round}
          step={stageSteps[index]?.step ?? restingStageStep}
          dragging={dragging}
          onPhoneScroll={hold}
        />
      </ClockProvider>
      <ol className="stage-steps">
        {stageSteps.map(({ step }, position) => (
          <li key={step}>
            <button
              type="button"
              aria-current={position === index ? "step" : undefined}
              onClick={() => goTo(position)}
            >
              {t(`home.stage.step.${step}`)}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function segmentState(position: number, index: number): "done" | "current" | undefined {
  if (position < index) return "done"
  return position === index ? "current" : undefined
}

/**
 * True while the visitor drags the phone and until {@link holdAfterScrollMs} after they last scrolled it; `hold`
 * starts or extends it.
 */
function usePhoneHold(dragging: RefObject<boolean>): readonly [boolean, () => void] {
  const heldUntil = useRef(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!held) return
    const release = () => {
      const left = dragging.current ? holdAfterScrollMs : heldUntil.current - Date.now()
      if (left > 0) timer = setTimeout(release, left)
      else setHeld(false)
    }
    let timer = setTimeout(release, heldUntil.current - Date.now())
    return () => clearTimeout(timer)
  }, [held, dragging])
  const hold = () => {
    heldUntil.current = Date.now() + holdAfterScrollMs
    setHeld(true)
  }
  return [held, hold]
}

/**
 * The position in {@link stageSteps} and its `round`, which grows on every step change, also a jump to the step
 * already shown. The step's timer runs only while the loop is `running`: not paused by the visitor, the tab
 * visible and the phone not `held`. Stopping keeps the time the step has left; a new round starts it full.
 */
function useStageLoop(calm: boolean, held: boolean) {
  const first = calm ? stageSteps.findIndex(({ step }) => step === restingStageStep) : 0
  const [position, setPosition] = useState({ index: first, round: 0 })
  const [paused, setPaused] = useState(calm)
  const [visible, setVisible] = useState(() => document.visibilityState === "visible")
  const running = visible && !paused && !held
  const left = useRef({ round: 0, ms: stepMs(first) })
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  useEffect(() => {
    if (!running) return
    const { index, round } = position
    if (left.current.round !== round) left.current = { round, ms: stepMs(index) }
    const startedAt = Date.now()
    const timer = setTimeout(
      () => setPosition({ index: (index + 1) % stageSteps.length, round: round + 1 }),
      left.current.ms,
    )
    return () => {
      clearTimeout(timer)
      left.current = { round, ms: left.current.ms - (Date.now() - startedAt) }
    }
  }, [running, position])
  return {
    ...position,
    paused,
    running,
    togglePause: () => setPaused((current) => !current),
    goTo: (index: number) => setPosition(({ round }) => ({ index, round: round + 1 })),
  }
}

function stepMs(index: number): number {
  return stageSteps[index]?.ms ?? 0
}

/** The page's time less every stretch the loop stood still, so the scene's clocks stop and go on with the loop. */
function useStageClock(running: boolean): Clock {
  const stood = useRef<{ readonly ms: number; readonly since: number | null }>({
    ms: 0,
    since: null,
  })
  useEffect(() => {
    if (running) return
    const since = Date.now()
    stood.current = { ms: stood.current.ms, since }
    return () => {
      stood.current = { ms: stood.current.ms + Date.now() - since, since: null }
    }
  }, [running])
  return useMemo(
    () => ({ running, now: () => (stood.current.since ?? Date.now()) - stood.current.ms }),
    [running],
  )
}

/** Mounts again per step, so the claim clock, the entrance animations and the phone's scroll start with it. */
function ExampleStep({
  step,
  dragging,
  onPhoneScroll,
}: {
  readonly step: StageStep
  readonly dragging: RefObject<boolean>
  readonly onPhoneScroll: () => void
}) {
  const { t } = useI18n()
  const screen = useDragScroll<HTMLDivElement>(onPhoneScroll, dragging)
  const { now } = useClock()
  const [startedAt] = useState(now)
  const { state, snapshot, facts } = useMemo(
    () => exampleDraw(step, startedAt, demoNames(t)),
    [step, startedAt, t],
  )
  return (
    <>
      <div className="stage-stream" inert aria-hidden="true">
        <StreamScene />
        <div className="stage-tags">
          <span className="stage-live">{t("home.stage.live")}</span>
          <span className="stage-viewers">{facts.streamerName}</span>
        </div>
        <div className="stage-canvas">
          <div className="overlay">
            <OverlayPlates step={step} snapshot={snapshot} prize={facts.prize ?? ""} />
          </div>
        </div>
      </div>
      <div className="stage-phone" aria-hidden="true">
        <div className="stage-screen" ref={screen}>
          <div className="stage-viewer viewer" inert>
            <DemoViewer state={state} heading="h2" showRules={false} />
          </div>
        </div>
      </div>
    </>
  )
}

function OverlayPlates({
  step,
  snapshot,
  prize,
}: {
  readonly step: StageStep
  readonly snapshot: DemoLive["snapshot"]
  readonly prize: string
}) {
  switch (step) {
    case "rising":
      return <EntryPlate snapshot={snapshot} qr={null} />
    case "drawing":
      return <ShufflePlate names={snapshot.shuffleNames} waitMs={null} />
    case "won":
    case "claimed":
      return <WinnerPlates standing={standingWinners(snapshot.winners)} prize={prize} />
  }
}

// A sunset over mountains in fixed colors: the picture stays the same in both themes, like a real stream.
function StreamScene() {
  return (
    <svg viewBox="0 0 660 371" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="home-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B3A55" />
          <stop offset=".65" stopColor="#C97B54" />
          <stop offset="1" stopColor="#E8A86B" />
        </linearGradient>
      </defs>
      <rect width="660" height="371" fill="url(#home-sky)" />
      <circle cx="470" cy="180" r="46" fill="#F6CF8E" opacity=".9" />
      <path
        d="M0 230 L80 170 L150 215 L230 140 L320 210 L400 160 L480 220 L560 150 L660 205 V371 H0Z"
        fill="#4A3A4F"
      />
      <path
        d="M0 270 L110 220 L190 262 L290 205 L380 258 L470 225 L560 268 L660 232 V371 H0Z"
        fill="#2F2838"
      />
      <path d="M0 310 L140 285 L260 318 L380 290 L520 322 L660 296 V371 H0Z" fill="#1B1822" />
      <g fill="#14121A">
        <rect x="300" y="240" width="8" height="80" />
        <path d="M304 214 l-22 40h44z" />
        <path d="M304 230 l-26 44h52z" />
      </g>
      <rect x="560" y="300" width="84" height="56" rx="6" fill="#0E0D12" opacity=".75" />
      <circle
        cx="602"
        cy="328"
        r="18"
        fill="none"
        stroke="#A1A1AA"
        strokeWidth="1.5"
        opacity=".7"
      />
      <circle cx="606" cy="324" r="3" fill="#FAFAFA" />
      <rect x="230" y="342" width="200" height="8" rx="4" fill="#0E0D12" opacity=".7" />
      <rect x="230" y="342" width="132" height="8" rx="4" fill="#E15B4F" />
    </svg>
  )
}
