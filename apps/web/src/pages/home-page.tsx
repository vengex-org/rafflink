import { Link, useSearchParams } from "react-router"
import { HomeCards } from "../components/home-cards.tsx"
import { HomeHow } from "../components/home-how.tsx"
import { HomeStage } from "../components/home-stage.tsx"
import { AlertIcon, CloudIcon, GithubIcon, LockIcon, TwitchIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl, setupGuideUrl } from "../lib/links.ts"

export function HomePage() {
  const { t, rich } = useI18n()
  const [query] = useSearchParams()
  const problem = signInProblem(query.get("signin"))
  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-wrap">
          {problem === null ? null : (
            <StateCard
              tone="danger"
              align="center"
              icon={<AlertIcon />}
              title={t("home.problemTitle")}
            >
              <p role="alert">{t(problem)}</p>
            </StateCard>
          )}
          <div className="home-hero-top">
            <h1>{rich("home.title", { highlight: <mark>{t("home.title.highlight")}</mark> })}</h1>
            <div>
              <p className="home-sub">{t("home.text")}</p>
              <div className="home-actions">
                <Link className="button home-cta" to="/dashboard">
                  <TwitchIcon />
                  {t("home.login")}
                </Link>
                <Link className="button outlined home-cta" to="/demo">
                  {t("home.demo")}
                </Link>
              </div>
              <p className="home-reads">{t("home.reads")}</p>
            </div>
          </div>
          <HomeStage />
          <ul className="home-trust">
            <li>
              <GithubIcon />
              {t("home.trust.openSource")}
            </li>
            <li>
              <CloudIcon />
              {t("home.trust.cloudflare")}
            </li>
            <li>
              <LockIcon />
              {t("home.trust.noTracking")}
            </li>
          </ul>
        </div>
      </section>
      <HomeHow />
      <HomeCards />
      <footer className="home-footer">
        <div className="home-wrap home-footer-row">
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">
              R
            </span>
            Rafflink
          </span>
          <nav aria-label={t("home.footer.label")}>
            <a href={repositoryUrl}>{t("nav.github")}</a>
            <a href={setupGuideUrl}>{t("home.footer.guide")}</a>
            <Link to="/privacy">{t("legal.privacy")}</Link>
            <Link to="/terms">{t("legal.terms")}</Link>
          </nav>
        </div>
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
