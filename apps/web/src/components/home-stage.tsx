import { useState } from "react"
import { DemoClaim } from "../pages/demo-page.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { shareUrl } from "../lib/links.ts"
import { exampleDraw } from "../lib/home-example.ts"
import { demoViewerName } from "../lib/demo-script.ts"
import { standingWinners } from "../lib/standing-winners.ts"
import { GiveawayFacts } from "./giveaway-facts.tsx"
import { GiveawayHead } from "./giveaway-head.tsx"
import { QrCode } from "./qr-code.tsx"
import { Replay } from "./replay.tsx"
import { WinnerPlates } from "../pages/overlay-page.tsx"
import { WinnerPlate } from "./winner-plate.tsx"

/**
 * The home page's picture of the product: a stream with the real overlay plates over it and the real viewer page
 * of the winner beside it, both fed by the demo giveaway. The pieces send no request and take no input.
 */
export function HomeStage() {
  const { t } = useI18n()
  return (
    <section className="home-stage" aria-label={t("home.preview.label")}>
      <Replay>
        <ExampleDraw />
      </Replay>
    </section>
  )
}

function ExampleDraw() {
  const { t } = useI18n()
  const [{ state, snapshot, facts }] = useState(() => exampleDraw(Date.now()))
  return (
    <>
      <div className="stage-stream">
        <StreamScene />
        <div className="stage-tags">
          <span className="stage-live">{t("home.stage.live")}</span>
          <span className="stage-viewers">{facts.streamerName}</span>
        </div>
        <div className="stage-canvas">
          <div className="overlay">
            <WinnerPlates standing={standingWinners(snapshot.winners)} prize={facts.prize ?? ""} />
            <div className="overlay-plate overlay-qr">
              <QrCode value={shareUrl(facts.code)} label={t("overlay.qr")} />
            </div>
          </div>
        </div>
      </div>
      <div className="stage-phone" aria-hidden="true">
        <div className="stage-screen">
          <div className="stage-viewer viewer" inert>
            <GiveawayHead giveaway={facts} as="h2" />
            <WinnerPlate name={demoViewerName} />
            <div className="viewer-outcome">
              <DemoClaim state={state} giveaway={facts} />
            </div>
            <div className="viewer-details">
              <GiveawayFacts kind="pool" giveaway={facts} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
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
