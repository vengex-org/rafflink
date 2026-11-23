import { useEffect, useId, useRef, useState, ViewTransition, type ReactNode } from "react"
import { Link, Outlet, useLocation } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import { useLocalizedPath } from "../i18n/localized-pages.ts"
import {
  adminPath,
  dashboardPath,
  pageOfPath,
  settingsPath,
  verifyLookupPath,
} from "../lib/routes.ts"
import { SiteNav } from "../site/site.tsx"
import { DonateLink } from "./donate-link.tsx"
import { Status } from "./notice.tsx"
import { OAuthErrorCard } from "./oauth-error-card.tsx"
import { AppFrame } from "./page.tsx"
import { SettingsMenu } from "./header-controls.tsx"
import { LogInIcon } from "./icons.tsx"
import { Avatar } from "./live-parts.tsx"
import {
  rememberedSignIn,
  StreamerSessionProvider,
  useStreamerSession,
  type SignedInStreamer,
} from "./streamer-session.tsx"

/**
 * The app bar and the page column; every page shares one width, so edges line up and nothing jumps between pages.
 * `account` says when the bar asks the server who the streamer is: `always` on the streamer's pages, `remembered` only in
 * a browser where a streamer signed in before, `never` on pages with no use for it.
 * A page that picks its frame itself passes its content as `children` instead of being a route here.
 */
export function Layout({
  account,
  children,
}: {
  readonly account: "always" | "remembered" | "never"
  readonly children?: ReactNode | undefined
}) {
  const { t } = useI18n()
  // Read once, so a sign-in elsewhere does not swap the bar's state under the open page.
  // Viewers crowd these pages: the sign-in is the streamer's quiet way in and the support page is never offered.
  const viewerPage = account === "remembered"
  const [asks] = useState(
    () => account === "always" || (account === "remembered" && rememberedSignIn()),
  )
  // The home page ends with its own footer and renders SiteNav in its bar.
  const { pathname } = useLocation()
  const isHome = pageOfPath(pathname)?.page === "home"
  const showFooter = !isHome
  const homePath = useLocalizedPath("home")
  const privacyPath = useLocalizedPath("privacy")
  const termsPath = useLocalizedPath("terms")
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
            {asks ? <Account viewerPage={viewerPage} /> : <LoginLink viewerPage={viewerPage} />}
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
  return asks ? <StreamerSessionProvider>{page}</StreamerSessionProvider> : page
}

/** The streamer's name and a way out when signed in; the log-in link otherwise, also while the session is unknown. The way out and the streamer's pages sit in one account button. */
function Account({ viewerPage }: { readonly viewerPage: boolean }) {
  const { t } = useI18n()
  const { streamer, donateUrl, busy, message, signOut } = useStreamerSession()
  return (
    <>
      {streamer === null ? (
        <LoginLink viewerPage={viewerPage} />
      ) : (
        <AccountMenu
          streamer={streamer}
          donateUrl={viewerPage ? null : donateUrl}
          busy={busy}
          onSignOut={signOut}
        />
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
 * The account button (picture and name) that shows a short list: the dashboard, the settings, the admin page for an
 * admin, the support page when the deployment names one, and Log out. Escape and a click or
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
          <li>
            <Link to={settingsPath} onClick={() => setOpen(false)}>
              {t("nav.settings")}
            </Link>
          </li>
          {streamer.admin ? (
            <li>
              <Link to={adminPath} onClick={() => setOpen(false)}>
                {t("nav.admin")}
              </Link>
            </li>
          ) : null}
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

/** The primary sign-in button; on a viewer page a quiet text link, so it does not read as a step of entering. */
function LoginLink({ viewerPage }: { readonly viewerPage: boolean }) {
  const { t } = useI18n()
  if (viewerPage) {
    return (
      <Link className="button text app-streamer-login" to={dashboardPath}>
        {t("nav.streamerLogin")}
      </Link>
    )
  }
  return (
    <Link className="button" to={dashboardPath}>
      <LogInIcon />
      {t("nav.login")}
    </Link>
  )
}
