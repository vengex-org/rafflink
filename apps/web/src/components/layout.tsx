import { useId } from "react"
import { Link, Outlet } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import { OAuthErrorCard } from "./oauth-error-card.tsx"
import { LanguageSwitch, ThemeSwitch } from "./header-controls.tsx"
import { GiftIcon, ListIcon, SlidersIcon } from "./icons.tsx"

/** The app bar and the page column; every page shares one width, so edges line up and nothing jumps between pages. */
export function Layout() {
  const { t } = useI18n()
  const settingsId = useId()
  return (
    <div className="layout">
      <header className="app-bar">
        <div className="container app-bar-inner">
          <Link to="/" className="brand">
            <GiftIcon />
            Rafflink
          </Link>
          <nav aria-label={t("nav.main")}>
            <Link to="/dashboard" className="button text">
              <ListIcon />
              {t("nav.myGiveaways")}
            </Link>
          </nav>
          <button
            type="button"
            className="icon-button settings-button"
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
      </header>
      <main className="container">
        <OAuthErrorCard />
        <Outlet />
      </main>
    </div>
  )
}
