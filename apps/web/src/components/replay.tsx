import { Fragment, useEffect, useState, type ReactNode } from "react"

/** Shorter than the claim time the home page examples start with, so the clock inside never reaches 0. */
const replayEveryMs = 30_000

/** Mounts `children` again every {@link replayEveryMs}, so a claim clock inside starts over. */
export function Replay({ children }: { readonly children: ReactNode }) {
  const [round, setRound] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setRound((current) => current + 1), replayEveryMs)
    return () => clearInterval(timer)
  }, [])
  return <Fragment key={round}>{children}</Fragment>
}
