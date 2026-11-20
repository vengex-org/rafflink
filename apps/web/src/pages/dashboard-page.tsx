import { useState } from "react"
import { Link } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { listGiveaways, type CreateResult } from "../api/client.ts"
import { GiftIcon, PlusIcon, SparkleIcon, TvIcon } from "../components/icons.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { ObsSteps, ShareLinks } from "../components/share-panel.tsx"
import { StateCard } from "../components/state-card.tsx"
import { statusLabel } from "../lib/messages.ts"
import { useLoad } from "../lib/use-load.ts"
import { CreateForm } from "./create-form.tsx"

type Created = Extract<CreateResult, { kind: "created" }>

type View =
  | { readonly kind: "list" }
  | { readonly kind: "create" }
  | { readonly kind: "created"; readonly created: Created }

export function DashboardPage() {
  const { result, reload } = useLoad(listGiveaways)
  const [view, setView] = useState<View>({ kind: "list" })
  const [signedOut, setSignedOut] = useState(false)

  if (signedOut) return <SignIn why="Your session ended. Sign in with Twitch to go on." />
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      if (result.value === "unauthorized") {
        return <SignIn why="Sign in with Twitch to create and run giveaways." />
      }
      switch (view.kind) {
        case "create":
          return (
            <>
              <h1>New giveaway</h1>
              <CreateForm
                onCreated={(created) => {
                  setView({ kind: "created", created })
                  reload()
                }}
                onUnauthorized={() => setSignedOut(true)}
                onCancel={() => setView({ kind: "list" })}
              />
            </>
          )
        case "created":
          return <CreatedScreen created={view.created} onDone={() => setView({ kind: "list" })} />
        case "list":
          return (
            <GiveawayList giveaways={result.value} onCreate={() => setView({ kind: "create" })} />
          )
      }
  }
}

function CreatedScreen({
  created,
  onDone,
}: {
  readonly created: Created
  readonly onDone: () => void
}) {
  const { giveaway } = created
  return (
    <>
      <StateCard tone="success" icon={<SparkleIcon />} title="Your giveaway is live!" confetti>
        {created.usageLow === null ? null : (
          <p role="alert">
            Heads up: the server has only {created.usageLow.remaining} requests left for today.
            Entries may stop working once they run out.
          </p>
        )}
        {created.roomReady ? null : (
          <p role="alert">
            The giveaway is not fully ready yet. Open the live page to finish setting it up.
          </p>
        )}
        <p>
          Next, tell your chat. Paste the message below into your Twitch chat. The giveaway code is{" "}
          <strong>{giveaway.code}</strong>.
        </p>
        <ShareLinks code={giveaway.code} />
        <Link className="button big" to={`/live/${giveaway.id}`}>
          Open live page
        </Link>
      </StateCard>
      <section className="card" aria-labelledby="obs-title">
        <span className="state-icon">
          <TvIcon />
        </span>
        <h2 id="obs-title">Add to OBS (optional)</h2>
        <p>Show the entries on your stream while people join.</p>
        <ObsSteps giveaway={giveaway} />
      </section>
      <button type="button" className="button secondary" onClick={onDone}>
        Back to my giveaways
      </button>
    </>
  )
}

function GiveawayList({
  giveaways,
  onCreate,
}: {
  readonly giveaways: readonly DashboardGiveaway[]
  readonly onCreate: () => void
}) {
  if (giveaways.length === 0) {
    return (
      <>
        <h1>My giveaways</h1>
        <StateCard tone="info" icon={<GiftIcon />} title="Create your first giveaway">
          <p>It takes about a minute. Here is how it works.</p>
          <ol className="explainer">
            <li>
              <strong>Create it.</strong> Say what you give away and who can enter.
            </li>
            <li>
              <strong>Share the link.</strong> Paste it in your chat. Viewers sign in with Twitch to
              enter.
            </li>
            <li>
              <strong>Draw live.</strong> Close entries and pick the winner on your stream.
            </li>
          </ol>
          <button type="button" className="button big" onClick={onCreate}>
            Create giveaway
          </button>
        </StateCard>
      </>
    )
  }
  return (
    <>
      <div className="page-head">
        <h1>My giveaways</h1>
        <button type="button" className="button" onClick={onCreate}>
          <PlusIcon />
          New giveaway
        </button>
      </div>
      <ul className="giveaways">
        {giveaways.map((giveaway) => (
          <li key={giveaway.id} className="card" data-status={giveaway.status}>
            <div className="giveaway-head">
              <h2>{giveaway.title}</h2>
              <span className="pill" data-status={giveaway.status}>
                {statusLabel[giveaway.status]}
              </span>
            </div>
            <p>Prize: {giveaway.prize}</p>
            <p className="muted">
              Code {giveaway.code}, created {new Date(giveaway.createdAt).toLocaleDateString()}
            </p>
            <Link className="button" to={`/live/${giveaway.id}`}>
              Open live page
            </Link>
            <details className="extra">
              <summary>Link and OBS overlay</summary>
              <ShareLinks code={giveaway.code} />
              <ObsSteps giveaway={giveaway} />
            </details>
          </li>
        ))}
      </ul>
    </>
  )
}
