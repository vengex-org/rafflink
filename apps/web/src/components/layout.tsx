import { useEffect, useId, useRef, useState, ViewTransition, type ReactNode } from "react"
import { Link, Outlet, useLocation } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import { dashboardPath, homePath, privacyPath, termsPath, verifyLookupPath } from "../lib/routes.ts"
import { SiteNav } from "../site/site.tsx"
import { DonateLink } from "./donate-link.tsx"
import { Status } from "./notice.tsx"
import { OAuthErrorCard } from "./oauth-error-card.tsx"
import { AppFrame } from "./page.tsx"
import { SettingsMenu } from "./header-controls.tsx"
import { LogInIcon } from "./icons.tsx"
import { Avatar } from "./live-parts.tsx"
import {
  StreamerSessionProvider,
  useStreamerSession,
  type SignedInStreamer,
} from "./streamer-session.tsx"

/**
 * The app bar and the page column; every page shares one width, so edges line up and nothing jumps between pages.
 * `account` asks the server who the streamer is, which only the streamer's pages need.
 * A page that picks its frame itself passes its content as `children` instead of being a route here.
 */
export function Layout({
  account,
  children,
}: {
  readonly account: boolean
  readonly children?: ReactNode | undefined
}) {
  const { t } = useI18n()
  // The home page ends with its own footer and renders SiteNav in its bar.
  const { pathname } = useLocation()
  const isHome = pathname === homePath
  const showFooter = !isHome
  const page = (
    <div className="layout">
      <a href="#main" className="skip-link">
        {t("nav.skip")}
      </a>
      <header className="app-bar">
        <div className="container app-bar-inner">
          <Link to={homePath} className="brand">
            <span className="brand-mark" aria-hidden="true">
              R
            </span>
            Rafflink
          </Link>
          {isHome ? <SiteNav /> : null}
          <div className="app-bar-end">
            <Link className="button text app-verify" to={verifyLookupPath}>
              {t("nav.verify")}
            </Link>
            {account ? <Account /> : <LoginLink />}
            <SettingsMenu>
              <Link className="settings-verify" to={verifyLookupPath}>
                {t("nav.verify")}
              </Link>
            </SettingsMenu>
          </div>
        </div>
      </header>
      <main id="main" className="container">
        <AppFrame value>
          <OAuthErrorCard />
          {/* Keyed by path, so a move to another page fades and a change of the query alone does not. */}
          <ViewTransition key={pathname} default="none" enter="page-fade" exit="page-fade">
            {children ?? <Outlet />}
          </ViewTransition>
        </AppFrame>
      </main>
      {showFooter ? (
        <footer className="site-footer">
          <nav aria-label={t("legal.footerLabel")} className="container">
            <Link to={privacyPath}>{t("legal.privacy")}</Link>
            <Link to={termsPath}>{t("legal.terms")}</Link>
          </nav>
        </footer>
      ) : null}
    </div>
  )
  return account ? <StreamerSessionProvider>{page}</StreamerSessionProvider> : page
}

/** The streamer's name and a way out when signed in; the log-in link otherwise, also while the session is unknown. The way out and the dashboard link sit in one account button. */
function Account() {
  const { t } = useI18n()
  const { streamer, donateUrl, busy, message, signOut } = useStreamerSession()
  return (
    <>
      {streamer === null ? (
        <LoginLink />
      ) : (
        <AccountMenu streamer={streamer} donateUrl={donateUrl} busy={busy} onSignOut={signOut} />
      )}
      {message === null ? null : <Status>{t(message)}</Status>}
    </>
  )
}

function StreamerAvatar({ streamer }: { readonly streamer: SignedInStreamer }) {
  return (
    <span className="account-avatar">
      <Avatar name={streamer.displayName} imageUrl={streamer.profileImageUrl} />
    </span>
  )
}

/**
 * The account button (picture and name) that shows a short list: the dashboard, the support page when the deployment
 * names one, and Log out. Escape and a click or
 * focus outside close it, Escape returning focus to the button.
 */
function AccountMenu({
  streamer,
  donateUrl,
  busy,
  onSignOut,
}: {
  readonly streamer: SignedInStreamer
  readonly donateUrl: string | null
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
            <Link to={dashboardPath} onClick={() => setOpen(false)}>
              {t("nav.myGiveaways")}
            </Link>
          </li>
          {donateUrl === null ? null : (
            <li>
              <DonateLink url={donateUrl} onClick={() => setOpen(false)}>
                {t("nav.support")}
              </DonateLink>
            </li>
          )}
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
    <Link className="button" to={dashboardPath}>
      <LogInIcon />
      {t("nav.login")}
    </Link>
  )
}
