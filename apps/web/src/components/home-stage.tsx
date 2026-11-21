import { useEffect, useState } from "react"
import { DemoViewer } from "../pages/demo-page.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { demoNames, type DemoLive } from "../lib/demo-live.ts"
import { exampleDraw, restingStageStep, stageSteps, type StageStep } from "../lib/home-example.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { Replay } from "./replay.tsx"
import { EntryPlate, ShufflePlate, WinnerPlates } from "../pages/overlay-page.tsx"

const reducedMotion = "(prefers-reduced-motion: reduce)"

/**
 * The home page's picture of the product: a stream with the real overlay plates over it and the real viewer page
 * of the winner beside it, both fed by the demo giveaway. They play its story in a loop: entries open, drawing,
 * winner, claimed. The pieces send no request and take no input.
 */
export function HomeStage() {
  const { t } = useI18n()
  const [calm] = useState(() => window.matchMedia(reducedMotion).matches)
  return (
    <section className="home-stage" aria-label={t("home.preview.label")}>
      {calm ? (
        <Replay>
          <ExampleStep step={restingStageStep} />
        </Replay>
      ) : (
        <PlayingStage />
      )}
    </section>
  )
}

function PlayingStage() {
  const { t } = useI18n()
  const index = useStageIndex()
  return (
    <>
      <ExampleStep key={index} step={stageSteps[index]?.step ?? restingStageStep} />
      <ol className="stage-steps" aria-hidden="true">
        {stageSteps.map(({ step }, position) => (
          <li key={step} aria-current={position === index ? "step" : undefined}>
            {t(`home.stage.step.${step}`)}
          </li>
        ))}
      </ol>
    </>
  )
}

/** The position in {@link stageSteps}; the loop waits while the tab is hidden. */
function useStageIndex(): number {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(() => document.visibilityState === "visible")
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(
      () => setIndex((current) => (current + 1) % stageSteps.length),
      stageSteps[index]?.ms,
    )
    return () => clearTimeout(timer)
  }, [index, visible])
  return index
}

/** Mounts again per step, so the claim clock and the entrance animations start with it. */
function ExampleStep({ step }: { readonly step: StageStep }) {
  const { t } = useI18n()
  const [{ state, snapshot, facts }] = useState(() => exampleDraw(step, Date.now(), demoNames(t)))
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
        <div className="stage-screen">
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
