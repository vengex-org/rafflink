import { act, render } from "@testing-library/react"
import { useEffect } from "react"
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router"
import { AppRoutes } from "../src/app.tsx"

/** Renders the app at `path`; `address()` is the router's current path and query, `back()` the browser's back button. */
export function renderApp(path: string) {
  let address = path
  let navigate: NavigateFunction | null = null
  function Probe() {
    const location = useLocation()
    const navigation = useNavigate()
    useEffect(() => {
      address = `${location.pathname}${location.search}`
      navigate = navigation
    })
    return null
  }
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <AppRoutes />
    </MemoryRouter>,
  )
  return Object.assign(view, {
    address: () => address,
    back: () =>
      act(() => {
        navigate?.(-1)
      }),
  })
}
