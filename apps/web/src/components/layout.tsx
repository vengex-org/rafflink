import { Link, Outlet } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import { LanguageSwitch, ThemeSwitch } from "./header-controls.tsx"
import { GiftIcon, ListIcon } from "./icons.tsx"

/** The app bar and the page column; both share one width, so their edges line up. Viewer pages use the narrow column, streamer pages the wide one. */
export function Layout({ width }: { readonly width: "narrow" | "wide" }) {
  const { t } = useI18n()
  return (
    <div className="layout" data-width={width}>
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
          <div className="app-bar-controls">
            <ThemeSwitch />
            <LanguageSwitch />
          </div>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  )
}
