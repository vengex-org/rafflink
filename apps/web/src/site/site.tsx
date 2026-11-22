/**
 * The seam between this repository and a hosted deployment: a build may replace this whole module, and its exports
 * are the contract.
 */
import type { ReactElement } from "react"
import { Link, useSearchParams } from "react-router"
import { DonateLink } from "../components/donate-link.tsx"
import { AlertIcon, TwitchIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl, setupGuideUrl } from "../lib/links.ts"

/** Extra top-level routes of the deployment, rendered before the catch-all routes. */
export const siteRoutes: ReactElement | null = null

export function HomePage() {
  const { t } = useI18n()
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
          <h1>{t("home.title")}</h1>
          <p className="home-sub">{t("home.text")}</p>
          <div className="home-actions">
            <Link className="button home-cta" to="/dashboard">
              {streamer === null ? <TwitchIcon /> : null}
              {t(streamer === null ? "home.login" : "nav.myGiveaways")}
            </Link>
          </div>
          <p className="home-reads">{t("home.reads")}</p>
        </div>
      </section>
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
            {donateUrl === null ? null : (
              <DonateLink url={donateUrl}>
                {t(isKoFi(donateUrl) ? "home.trust.supportKoFi" : "home.trust.support")}
              </DonateLink>
            )}
          </nav>
        </div>
      </footer>
    </div>
  )
}

export function SiteNav() {
  const { t } = useI18n()
  return (
    <nav aria-label={t("nav.main")} className="app-nav">
      <a href={setupGuideUrl}>{t("nav.selfHost")}</a>
      <a href={repositoryUrl}>{t("nav.github")}</a>
    </nav>
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
