import { useEffect } from "react"
import { useParams } from "react-router"
import { overlaySnapshotPath } from "../api/client.ts"
import { LiveSummary } from "../components/live-summary.tsx"
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
    case "ready":
      return (
        <main className="overlay">
          <LiveSummary snapshot={live.snapshot} winnerActions={null} />
        </main>
      )
  }
}
