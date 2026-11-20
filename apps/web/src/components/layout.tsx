import { Link, Outlet } from "react-router"
import { GiftIcon } from "./icons.tsx"

export function Layout() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <GiftIcon />
          </span>
          Rafflink
        </Link>
        <nav aria-label="Main">
          <Link to="/dashboard" className="nav-link">
            My giveaways
          </Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
