import { Link, Outlet } from "react-router"
import { GiftIcon } from "./icons.tsx"

/** The app bar and the page column; viewer pages use the narrow column, streamer pages the wide one. */
export function Layout({ width }: { readonly width: "narrow" | "wide" }) {
  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <Link to="/" className="brand">
            <GiftIcon />
            Rafflink
          </Link>
          <nav aria-label="Main">
            <Link to="/dashboard" className="button text">
              My giveaways
            </Link>
          </nav>
        </div>
      </header>
      <main data-width={width}>
        <Outlet />
      </main>
    </>
  )
}
