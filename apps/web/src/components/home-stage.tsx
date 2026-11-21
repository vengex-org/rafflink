import type { ReactNode } from "react"
import { useI18n } from "../i18n/i18n.tsx"

const streamer = "kovac_plays"
/** The example draw the whole home page tells: who won and how long the claim clock shows. */
export const exampleWinner = "mira_vex"
const prize = "Steam Deck OLED 512GB"
const code = "K7HQ2"
export const exampleClock = "0:42"
const poolTickets = 622
const winnerTickets = 3

/** The home page's picture of the product: the stream with its overlay plate and the winner's phone. Pure markup, no images. */
export function HomeStage() {
  const { t, plural } = useI18n()
  return (
    <section className="home-stage" aria-label={t("home.preview.label")}>
      <div className="stage-stream">
        <StreamScene />
        <div className="stage-tags">
          <span className="stage-live">{t("home.stage.live")}</span>
          <span className="stage-viewers">{streamer}</span>
        </div>
        <div className="stage-enter">
          {t("home.stage.enterAt")}
          <b>
            rafflink.app/g/<em>{code}</em>
          </b>
        </div>
        <div className="stage-plate">
          <div>
            <div className="stage-plate-label">{t("home.preview.winner")}</div>
            <div className="stage-plate-name">{exampleWinner}</div>
            <div className="stage-plate-prize">{prize}</div>
          </div>
          <div className="stage-plate-clock">
            <strong>{exampleClock}</strong>
            <span>{t("home.stage.toClaim")}</span>
          </div>
        </div>
      </div>
      <div className="stage-phone" aria-hidden="true">
        <div className="stage-screen">
          <div className="phone-bar">
            <span className="phone-brand">
              <span className="brand-mark">R</span>
              Rafflink
            </span>
            <span className="phone-code">/g/{code}</span>
          </div>
          <div className="phone-body">
            <div>
              <p className="phone-context">{t("home.phone.context", { streamer })}</p>
              <p className="phone-prize">{prize}</p>
            </div>
            <div className="phone-win">
              <div className="phone-win-top">
                <span className="phone-won">{t("home.phone.won")}</span>
                <span className="phone-ring">
                  <svg viewBox="0 0 120 120">
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity="0.15"
                      strokeWidth="12"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray="314"
                      strokeDashoffset="94"
                    />
                  </svg>
                  <b>{exampleClock}</b>
                </span>
              </div>
              <p>{t("home.phone.claimHint")}</p>
              <div className="phone-claim">{t("home.phone.claim")}</div>
            </div>
            <PhoneRow label={t("home.phone.tickets")}>
              {t("home.phone.ticketsValue", { count: winnerTickets })}
            </PhoneRow>
            <PhoneRow label={t("home.phone.pool")}>{plural("ticket", poolTickets)}</PhoneRow>
            <PhoneRow label={t("home.phone.code")}>
              <span className="phone-mono">{code}</span>
            </PhoneRow>
          </div>
        </div>
      </div>
    </section>
  )
}

function PhoneRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="phone-row">
      <span>{label}</span>
      <b>{children}</b>
    </div>
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
