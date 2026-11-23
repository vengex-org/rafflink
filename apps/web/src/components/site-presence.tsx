import { useLocation } from "react-router"
import { presenceKindOf, useSitePresence } from "../lib/use-site-presence.ts"

/** Keeps the tab counted on the admin page under the kind of the page it shows; renders nothing. */
export function SitePresence() {
  useSitePresence(presenceKindOf(useLocation().pathname))
  return null
}
