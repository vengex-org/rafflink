import { useId } from "react"
import { Link, Outlet } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl } from "../lib/links.ts"
import { OAuthErrorCard } from "./oauth-error-card.tsx"
import { LanguageSwitch, ThemeSwitch } from "./header-controls.tsx"
import { SlidersIcon, TwitchIcon } from "./icons.tsx"

/** The app bar and the page column; every page shares one width, so edges line up and nothing jumps between pages. */
export function Layout() {
  const { t } = useI18n()
  const settingsId = useId()
  return (
    <div className="layout">
      <a href="#main" className="skip-link">
        {t("nav.skip")}
      </a>
      <header className="app-bar">
        <div className="container app-bar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              R
            </span>
            Rafflink
          </Link>
          <nav aria-label={t("nav.main")} className="app-nav">
            <a href="/#how">{t("nav.howItWorks")}</a>
            <a href="/#self-host">{t("nav.selfHost")}</a>
            <a href={repositoryUrl}>{t("nav.github")}</a>
          </nav>
          <div className="app-bar-end">
            <Link className="button text app-demo" to="/demo">
              {t("nav.demo")}
            </Link>
            <Link className="button" to="/dashboard">
              <TwitchIcon />
              {t("nav.login")}
            </Link>
            <button
              type="button"
              className="icon-button"
              popoverTarget={settingsId}
              aria-label={t("settings.label")}
            >
              <SlidersIcon />
            </button>
            <div id={settingsId} popover="auto" className="settings-panel">
              <ThemeSwitch />
              <LanguageSwitch />
            </div>
          </div>
        </div>
      </header>
      <main id="main" className="container">
        <OAuthErrorCard />
        <Outlet />
      </main>
    </div>
  )
}
