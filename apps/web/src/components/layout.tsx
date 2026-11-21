import { useEffect, useId, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router"
import { getSession, logout, sessionLost } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl } from "../lib/links.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"
import { Status } from "./notice.tsx"
import { OAuthErrorCard } from "./oauth-error-card.tsx"
import { LanguageSwitch, ThemeSwitch } from "./header-controls.tsx"
import { SlidersIcon, TwitchIcon } from "./icons.tsx"

/**
 * The app bar and the page column; every page shares one width, so edges line up and nothing jumps between pages.
 * `account` asks the server who the streamer is, which only the streamer's pages need.
 */
export function Layout({ account }: { readonly account: boolean }) {
  const { t } = useI18n()
  const settingsId = useId()
  // The home page ends with its own footer.
  const showFooter = useLocation().pathname !== "/"
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
            {account ? <Account /> : <LoginLink />}
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
      {showFooter ? (
        <footer className="site-footer">
          <nav aria-label={t("legal.footerLabel")} className="container">
            <Link to="/privacy">{t("legal.privacy")}</Link>
            <Link to="/terms">{t("legal.terms")}</Link>
          </nav>
        </footer>
      ) : null}
    </div>
  )
}

/** The streamer's name and a way out when signed in; the log-in link otherwise, also while the session is unknown. */
function Account() {
  const { t } = useI18n()
  const { result, reload } = useLoad(getSession)
  const { message, busy, run } = useAction()
  const navigate = useNavigate()
  const [loggedOut, setLoggedOut] = useState(false)
  const streamer = result.state === "ready" && !loggedOut ? result.value.streamer : null

  // A signed-out header has nothing to correct, and a call still in flight already asks the server.
  const signedIn = streamer !== null
  useEffect(() => {
    if (!signedIn) return
    window.addEventListener(sessionLost, reload)
    return () => window.removeEventListener(sessionLost, reload)
  }, [signedIn, reload])

  async function signOut() {
    const outcome = await run(logout, () => "nav.loggedOut")
    if (outcome === "failed") return
    setLoggedOut(true)
    navigate("/")
  }

  return (
    <>
      {streamer === null ? (
        <LoginLink />
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

function LoginLink() {
  const { t } = useI18n()
  return (
    <Link className="button" to="/dashboard">
      <TwitchIcon />
      {t("nav.login")}
    </Link>
  )
}
