import { useSyncExternalStore } from "react"

/**
 * False while React renders on the server and while it hydrates that HTML, true after; true at once when the page
 * renders in the browser alone. UI that depends on what only the browser knows (the query, storage) waits for it,
 * so the first browser render matches the prerendered HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(neverChanges, inBrowser, onServer)
}

const neverChanges = () => () => {}
const inBrowser = () => true
const onServer = () => false
