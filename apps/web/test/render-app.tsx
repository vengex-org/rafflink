import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { AppRoutes } from "../src/app.tsx"
import type { PollTiming } from "../src/lib/poll-timing.ts"

export const fastPoll: PollTiming = { intervalMs: 10, maxMs: 80 }

export function renderApp(path: string, poll: PollTiming = fastPoll) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes poll={poll} />
    </MemoryRouter>,
  )
}
