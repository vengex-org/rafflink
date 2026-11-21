import type { SessionJson } from "@rafflink/core/http/json"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router"
import { getSession, logout, sessionLost } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl } from "../lib/links.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"
import { Status } from "./notice.tsx"
import { OAuthErrorCard } from "./oauth-error-card.tsx"
import { AppFrame } from "./page.tsx"
import { SettingsMenu } from "./header-controls.tsx"
import { TwitchIcon } from "./icons.tsx"
import { Avatar } from "./live-parts.tsx"

/**
 * The app bar and the page column; every page shares one width, so edges line up and nothing jumps between pages.
 * `account` asks the server who the streamer is, which only the streamer's pages need.
 * A page that picks its frame itself, as the demo does, passes its content as `children` instead of being a route here.
 */
export function Layout({
  account,
  children,
}: {
  readonly account: boolean
  readonly children?: ReactNode | undefined
}) {
  const { t } = useI18n()
  // The home page ends with its own footer and keeps the marketing links in its bar.
  const isHome = useLocation().pathname === "/"
  const showFooter = !isHome
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
          {isHome ? (
            <nav aria-label={t("nav.main")} className="app-nav">
              <a href="/#how">{t("nav.howItWorks")}</a>
              <a href="/#self-host">{t("nav.selfHost")}</a>
              <a href={repositoryUrl}>{t("nav.github")}</a>
            </nav>
          ) : null}
          <div className="app-bar-end">
            {account ? <Account menu={!isHome} /> : <LoginLink />}
            <SettingsMenu />
          </div>
        </div>
      </header>
      <main id="main" className="container">
        <AppFrame value>
          <OAuthErrorCard />
          {children ?? <Outlet />}
        </AppFrame>
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

/** The streamer's name and a way out when signed in; the log-in link otherwise, also while the session is unknown. `menu` folds the way out and the dashboard link into one account button. */
function Account({ menu }: { readonly menu: boolean }) {
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
      ) : menu ? (
        <AccountMenu streamer={streamer} busy={busy} onSignOut={() => void signOut()} />
      ) : (
        <>
          <Link className="button text" to="/dashboard">
            <StreamerAvatar streamer={streamer} />
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

type SignedInStreamer = NonNullable<SessionJson["streamer"]>

function StreamerAvatar({ streamer }: { readonly streamer: SignedInStreamer }) {
  return (
    <span className="account-avatar">
      <Avatar name={streamer.displayName} imageUrl={streamer.profileImageUrl} />
    </span>
  )
}

/**
 * The account button (picture and name) that shows a short list: the dashboard and Log out. Escape and a click or
 * focus outside close it, Escape returning focus to the button.
 */
function AccountMenu({
  streamer,
  busy,
  onSignOut,
}: {
  readonly streamer: SignedInStreamer
  readonly busy: boolean
  readonly onSignOut: () => void
}) {
  const { t } = useI18n()
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("focusin", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  return (
    <div ref={root} className="account-menu">
      <button
        ref={button}
        type="button"
        className="button text"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <StreamerAvatar streamer={streamer} />
        {streamer.displayName}
      </button>
      {open ? (
        <ul id={menuId} className="account-menu-panel">
          <li>
            <Link to="/dashboard" onClick={() => setOpen(false)}>
              {t("nav.myGiveaways")}
            </Link>
          </li>
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                // The panel unmounts with the click; focus on the button keeps keyboard users in place when the logout fails.
                button.current?.focus()
                setOpen(false)
                onSignOut()
              }}
            >
              {t("nav.logout")}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
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
