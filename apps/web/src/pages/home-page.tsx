import { Link, useSearchParams } from "react-router"
import { Countdown } from "../components/countdown.tsx"
import { AlertIcon, LinkIcon, PlusIcon, ShuffleIcon, TwitchIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"
import { StatusChip } from "../components/status-chip.tsx"
import { WinnerPlate } from "../components/winner-plate.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { setupGuideUrl } from "../lib/links.ts"

const sampleClaimMs = 42_000

export function HomePage() {
  const { t } = useI18n()
  const [query] = useSearchParams()
  const problem = signInProblem(query.get("signin"))
  return (
    <div className="home">
      {problem === null ? null : (
        <StateCard tone="danger" align="center" icon={<AlertIcon />} title={t("home.problemTitle")}>
          <p role="alert">{t(problem)}</p>
        </StateCard>
      )}
      <div className="home-top">
        <section className="home-hero">
          <h1>{t("home.title")}</h1>
          <p className="home-promise">{t("home.text")}</p>
          <div className="home-actions">
            <Link className="button home-cta" to="/dashboard">
              <TwitchIcon />
              {t("home.login")}
            </Link>
            <a className="button outlined home-cta" href="#how">
              {t("home.seeHow")}
            </a>
          </div>
        </section>
        <section className="card home-preview" aria-label={t("home.preview.label")}>
          <div className="home-preview-head">
            <StatusChip tone="success">{t("status.open")}</StatusChip>
            <StatusChip tone="win">{t("home.preview.winner")}</StatusChip>
          </div>
          <WinnerPlate name="mira_vex" />
          <Countdown initialMs={sampleClaimMs} />
        </section>
      </div>
      <section className="home-how" id="how">
        <h2>{t("home.how.title")}</h2>
        <ol className="home-steps" aria-label={t("home.how.list")}>
          <li>
            <PlusIcon />
            <h3>{t("home.how.create.title")}</h3>
            <p>{t("home.how.create.text")}</p>
          </li>
          <li>
            <LinkIcon />
            <h3>{t("home.how.share.title")}</h3>
            <p>{t("home.how.share.text")}</p>
          </li>
          <li>
            <ShuffleIcon />
            <h3>{t("home.how.draw.title")}</h3>
            <p>{t("home.how.draw.text")}</p>
          </li>
        </ol>
      </section>
      <footer className="home-footer">
        <p>{t("home.openSource")}</p>
        <a href={setupGuideUrl}>{t("home.setupGuide")}</a>
      </footer>
    </div>
  )
}

// The streamer sign-in callback redirects here with `?signin=` when it fails.
function signInProblem(reason: string | null): MessageKey | null {
  switch (reason) {
    case "invalid-state":
      return "home.problem.invalidState"
    case "try-again":
      return "home.problem.tryAgain"
    default:
      return null
  }
}
