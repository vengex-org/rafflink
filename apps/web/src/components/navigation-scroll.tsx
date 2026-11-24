import { useEffect, useRef } from "react"
import { useLocation, useNavigationType } from "react-router"

/**
 * Where the window scrolls when the address changes. A link or redirect to another page opens it at the top, and an
 * address with `#id` brings that element into view, gliding where motion is allowed (`scroll-behavior` in base.css).
 * Back and forward leave the browser to restore where the reader was, and a change of the query alone keeps the
 * scroll. The address the app opens at keeps the browser's own scroll, except that a `#id` target rendered by the app
 * is shown at once.
 */
export function NavigationScroll() {
  const { pathname, hash } = useLocation()
  const type = useNavigationType()
  const shown = useRef<{ readonly pathname: string; readonly hash: string } | null>(null)
  useEffect(() => {
    const previous = shown.current
    shown.current = { pathname, hash }
    if (previous !== null && previous.pathname === pathname && previous.hash === hash) return
    if (previous !== null && type === "POP") return
    const target = hash === "" ? null : document.getElementById(fragmentId(hash))
    if (target !== null) {
      target.scrollIntoView(previous === null ? { behavior: "instant" } : undefined)
    } else if (previous !== null && previous.pathname !== pathname) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" })
    }
  }, [pathname, hash, type])
  return null
}

/** The element id a `#fragment` names; a malformed escape is taken as typed, as the browser does. */
function fragmentId(hash: string): string {
  const raw = hash.slice(1)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
