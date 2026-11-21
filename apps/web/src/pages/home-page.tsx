import { Link, useSearchParams } from "react-router"
import { DonateLink } from "../components/donate-link.tsx"
import { HomeCards } from "../components/home-cards.tsx"
import { HomeHow } from "../components/home-how.tsx"
import { HomeStage } from "../components/home-stage.tsx"
import { AlertIcon, CloudIcon, GithubIcon, LockIcon, TwitchIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl, setupGuideUrl } from "../lib/links.ts"

export function HomePage() {
  const { t, rich } = useI18n()
  const [query] = useSearchParams()
  const problem = signInProblem(query.get("signin"))
  const { streamer, donateUrl } = useStreamerSession()
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
                  {streamer === null ? <TwitchIcon /> : null}
                  {t(streamer === null ? "home.login" : "nav.myGiveaways")}
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
            {donateUrl === null ? null : (
              <li>
                <DonateLink url={donateUrl}>
                  {t(isKoFi(donateUrl) ? "home.trust.supportKoFi" : "home.trust.support")}
                </DonateLink>
              </li>
            )}
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
            <Link to="/verify">{t("nav.verify")}</Link>
            <Link to="/privacy">{t("legal.privacy")}</Link>
            <Link to="/terms">{t("legal.terms")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

/** Ko-fi is named on the link; any other support page gets the generic wording. */
function isKoFi(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  return host === "ko-fi.com" || host.endsWith(".ko-fi.com")
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
