import { useState } from "react"
import { Link } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { listGiveaways, type CreateResult } from "../api/client.ts"
import { CopyField } from "../components/copy-field.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { statusLabel } from "../lib/messages.ts"
import { useLoad } from "../lib/use-load.ts"
import { CreateForm } from "./create-form.tsx"

type Created = Extract<CreateResult, { kind: "created" }>

export function DashboardPage() {
  const { result, reload } = useLoad(listGiveaways)
  const [created, setCreated] = useState<Created | null>(null)
  const [signedOut, setSignedOut] = useState(false)

  if (signedOut) return <SignIn why="Your session ended." />
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      if (result.value === "unauthorized") {
        return <SignIn why="Sign in with Twitch to create and run giveaways." />
      }
      return (
        <>
          <h1>Your giveaways</h1>
          <CreateForm
            onCreated={(next) => {
              setCreated(next)
              reload()
            }}
            onUnauthorized={() => setSignedOut(true)}
          />
          {created === null ? null : <CreatedCard created={created} />}
          <GiveawayList giveaways={result.value} />
        </>
      )
  }
}

function CreatedCard({ created }: { readonly created: Created }) {
  const { giveaway } = created
  return (
    <section aria-labelledby="created" className="card">
      <h2 id="created">Giveaway created</h2>
      {created.usageLow === null ? null : (
        <p role="alert">
          Warning: only {created.usageLow.remaining} Worker requests are left today. Entries may
          fail once the free limit is used up.
        </p>
      )}
      {created.roomReady ? null : (
        <p role="alert">
          The giveaway room is not ready yet. Open the live page to finish setting it up.
        </p>
      )}
      <p>
        Code: <strong>{giveaway.code}</strong>
      </p>
      <CopyField label="Share link" value={shareUrl(giveaway)} />
      <CopyField label="Overlay URL for OBS" value={overlayUrl(giveaway)} />
      <Link className="button" to={`/live/${giveaway.id}`}>
        Open live page
      </Link>
    </section>
  )
}

function GiveawayList({ giveaways }: { readonly giveaways: readonly DashboardGiveaway[] }) {
  if (giveaways.length === 0) return <p>No giveaways yet.</p>
  return (
    <ul className="giveaways">
      {giveaways.map((giveaway) => (
        <li key={giveaway.id}>
          <strong>{giveaway.title}</strong>
          <span>
            {giveaway.code} · {statusLabel[giveaway.status]}
          </span>
          <Link to={`/live/${giveaway.id}`}>Live page</Link>
        </li>
      ))}
    </ul>
  )
}

function shareUrl(giveaway: DashboardGiveaway): string {
  return new URL(`/${giveaway.code}`, window.location.origin).href
}

function overlayUrl(giveaway: DashboardGiveaway): string {
  return new URL(
    `/overlay/${encodeURIComponent(giveaway.id)}/${encodeURIComponent(giveaway.overlayToken)}`,
    window.location.origin,
  ).href
}
