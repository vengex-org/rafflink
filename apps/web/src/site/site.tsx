/**
 * The seam between this repository and a hosted deployment: a build may replace this whole module, and its exports
 * are the contract.
 */
import type { ReactElement } from "react"
import { Link } from "react-router"
import { DonateLink } from "../components/donate-link.tsx"
import { ExternalLink } from "../components/external-link.tsx"
import { AlertIcon, LogInIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl, setupGuideUrl } from "../lib/links.ts"
import { useLocalizedPath } from "../i18n/localized-pages.ts"
import { dashboardPath, drawPath, verifyLookupPath } from "../lib/routes.ts"
import { useConsumedParam } from "../lib/use-consumed-param.ts"
import { useHydrated } from "../lib/use-hydrated.ts"

/** Extra top-level routes of the deployment, rendered before the catch-all routes. */
export const siteRoutes: ReactElement | null = null

export function HomePage() {
  const { t } = useI18n()
  const signin = useConsumedParam("signin")
  const problem = useHydrated() ? signInProblem(signin?.value ?? null) : null
  const { streamer, donateUrl } = useStreamerSession()
  const privacyPath = useLocalizedPath("privacy")
  const termsPath = useLocalizedPath("terms")
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
            <Link className="button home-cta" to={dashboardPath}>
              {streamer === null ? <LogInIcon /> : null}
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
            <ExternalLink kind="own" href={repositoryUrl}>
              {t("nav.github")}
            </ExternalLink>
            <ExternalLink kind="own" href={setupGuideUrl}>
              {t("home.footer.guide")}
            </ExternalLink>
            <Link to={verifyLookupPath}>{t("nav.verify")}</Link>
            <Link to={drawPath}>{t("nav.draw")}</Link>
            <Link to={privacyPath}>{t("legal.privacy")}</Link>
            <Link to={termsPath}>{t("legal.terms")}</Link>
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
      <ExternalLink kind="own" href={setupGuideUrl}>
        {t("nav.selfHost")}
      </ExternalLink>
      <ExternalLink kind="own" href={repositoryUrl}>
        {t("nav.github")}
      </ExternalLink>
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
    case "no-channel":
      return "home.problem.noChannel"
    case "try-again":
      return "home.problem.tryAgain"
    default:
      return null
  }
}
