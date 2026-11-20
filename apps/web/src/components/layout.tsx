import { Link, Outlet } from "react-router"

export function Layout() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          Rafflink
        </Link>
        <nav aria-label="Main">
          <Link to="/dashboard">Dashboard</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
