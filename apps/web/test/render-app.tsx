import { act, render } from "@testing-library/react"
import { useLayoutEffect } from "react"
import {
  MemoryRouter,
  parsePath,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router"
import { AppRoutes } from "../src/app.tsx"

/** Renders the app at `path`, whose history entry holds `state` (what a reload gives back); `address()` is the router's current path and query, `state()` its history state, `go()` a link followed, `back()` the browser's back button. */
export function renderApp(path: string, state: unknown = null) {
  let address = path
  let historyState: unknown = state
  let navigate: NavigateFunction | null = null
  function Probe() {
    const location = useLocation()
    const navigation = useNavigate()
    // In the commit itself: a passive effect can still be pending when a findBy query sees the new page.
    useLayoutEffect(() => {
      address = `${location.pathname}${location.search}`
      historyState = location.state
      navigate = navigation
    })
    return null
  }
  const view = render(
    <MemoryRouter initialEntries={[{ ...parsePath(path), state }]}>
      <Probe />
      <AppRoutes />
    </MemoryRouter>,
  )
  return Object.assign(view, {
    address: () => address,
    state: () => historyState,
    go: (to: string) =>
      act(() => {
        navigate?.(to)
      }),
    back: () =>
      act(() => {
        navigate?.(-1)
      }),
  })
}
