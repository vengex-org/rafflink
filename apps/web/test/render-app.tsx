import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { AppRoutes } from "../src/app.tsx"

export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}
