import { useId } from "react"
import { Link, Outlet, useNavigate } from "react-router"
import { getSession, logout } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl } from "../lib/links.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"
import { Status } from "./notice.tsx"
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
            <Account />
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

/** The streamer's name and a way out when signed in; the log-in link otherwise, also while the session is unknown. */
function Account() {
  const { t } = useI18n()
  const { result, reload } = useLoad(getSession)
  const { message, busy, run } = useAction()
  const navigate = useNavigate()
  const streamer = result.state === "ready" ? result.value.streamer : null

  async function signOut() {
    const outcome = await run(logout, () => "nav.loggedOut")
    if (outcome === "failed") return
    reload()
    navigate("/")
  }

  return (
    <>
      {streamer === null ? (
        <Link className="button" to="/dashboard">
          <TwitchIcon />
          {t("nav.login")}
        </Link>
      ) : (
        <>
          <Link className="button text" to="/dashboard">
            {streamer.displayName}
          </Link>
          <button
            type="button"
            className="button text"
            disabled={busy}
            onClick={() => void signOut()}
          >
            {t("nav.logout")}
          </button>
        </>
      )}
      {message === null ? null : <Status>{t(message)}</Status>}
    </>
  )
}
