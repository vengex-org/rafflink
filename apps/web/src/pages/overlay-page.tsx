import { useEffect } from "react"
import { useParams } from "react-router"
import { overlaySnapshotPath } from "../api/client.ts"
import { EntrantNames, Stat, WinnerList } from "../components/live-parts.tsx"
import { Failed, Loading, NotFound } from "../components/notice.tsx"
import { useLive } from "../lib/use-live.ts"

/** The read-only live view for an OBS browser source: no session, a transparent background. */
export function OverlayPage() {
  const { id, token } = useParams()
  useEffect(() => {
    document.documentElement.dataset.surface = "overlay"
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [])
  return id === undefined || token === undefined ? (
    <NotFound title="Not found" />
  ) : (
    <Loaded id={id} token={token} />
  )
}

function Loaded({ id, token }: { readonly id: string; readonly token: string }) {
  const live = useLive(overlaySnapshotPath(id, token))
  switch (live.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "unauthorized":
    case "not-found":
      return <NotFound title="Not found" />
    case "ready": {
      const { snapshot } = live
      return (
        <main className="overlay">
          <h1>{snapshot.title}</h1>
          <p className="overlay-code">Code {snapshot.code}</p>
          <dl className="stats">
            <Stat value={snapshot.entrantCount.toLocaleString("en-US")} label="people entered" />
            <Stat value={snapshot.entriesPerSecond.toFixed(1)} label="entries per second" />
          </dl>
          <h2>Latest entrants</h2>
          <EntrantNames names={snapshot.lastNames} />
          {snapshot.winners.length === 0 ? null : (
            <>
              <h2>Winners</h2>
              <WinnerList winners={snapshot.winners} actions={null} />
            </>
          )}
        </main>
      )
    }
  }
}
