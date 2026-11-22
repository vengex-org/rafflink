import { useCallback, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import type { ViewerState } from "@rafflink/core/http/json"
import { entryFromQuery, type GiveawayView } from "../api/client.ts"
import { ClaimPanel } from "../components/giveaway-claim.tsx"
import { EntryPanel } from "../components/giveaway-entry.tsx"
import { GiveawayFacts, GiveawayRules } from "../components/giveaway-facts.tsx"
import { GiveawayHead, GiveawayPhase } from "../components/giveaway-head.tsx"
import { ExternalLink } from "../components/external-link.tsx"
import { TwitchIcon } from "../components/icons.tsx"
import { Failed, Loading, NotFound } from "../components/notice.tsx"
import { Page } from "../components/page.tsx"
import { RunYourOwn } from "../components/run-your-own.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { useEntryResult } from "../lib/use-entry-result.ts"
import { loadGiveaway } from "../lib/stored-giveaway.ts"
import { twitchChannelUrl } from "../lib/twitch-channel.ts"
import { useLoad } from "../lib/use-load.ts"
import { useViewerPush } from "../lib/use-viewer-push.ts"
import { applyViewerPush } from "../lib/viewer-outcome.ts"

export function GiveawayPage() {
  const { code } = useParams()
  return code === undefined ? <NotFound title="notFound.giveaway" /> : <Loaded code={code} />
}

function Loaded({ code }: { readonly code: string }) {
  const [query] = useSearchParams()
  // A page that comes back from the sign-in has just changed what the server knows about the viewer.
  const [allowStored] = useState(() => !query.has("entry"))
  const load = useCallback(() => loadGiveaway(code, allowStored), [code, allowStored])
  const { result, reload } = useLoad(load)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      return result.value === null ? (
        <NotFound title="notFound.giveaway" />
      ) : (
        <GiveawayDetails
          code={code}
          giveaway={result.value.giveaway}
          me={result.value.me}
          onEntered={reload}
        />
      )
  }
}

function GiveawayDetails({
  code,
  giveaway: loadedGiveaway,
  me: loadedMe,
  onEntered,
}: {
  readonly code: string
  readonly giveaway: GiveawayView
  readonly me: ViewerState
  /** Loads the giveaway again; a viewer who entered through the queue is signed-out in the answer the page holds. */
  readonly onEntered: () => void
}) {
  const { t } = useI18n()
  const push = useViewerPush(code, !loadedGiveaway.finished)
  const { giveaway, me } = applyViewerPush({ giveaway: loadedGiveaway, me: loadedMe }, push)
  const [query] = useSearchParams()
  const initial = useMemo(() => entryFromQuery(query), [query])
  const fromSignIn = useEntryResult(code, initial, giveaway.poll, onEntered)
  // A returning viewer has no sign-in outcome in the URL; the viewer state says they are in. It also
  // wins over a `dropped` left in the URL, which only says the queued ticket is gone.
  const fromServer = me.kind === "entered" ? { kind: "entered" as const, entry: me.entry } : null
  const entry =
    fromSignIn?.kind === "dropped" && fromServer !== null ? fromServer : (fromSignIn ?? fromServer)
  // The viewer state was read before a queued sign-in finished, so the poll answer is the fresher entry.
  const entered = entry?.kind === "entered" || entry?.kind === "already-in" ? entry.entry : null
  const tickets = entered ?? (me.kind === "entered" ? me.entry : null)
  const signInHref = `/auth/twitch/viewer/start?giveaway=${encodeURIComponent(code)}`
  const channelUrl = twitchChannelUrl(giveaway.streamerName)
  const isWinner = me.kind === "won"
  const isIn = entered !== null && !isWinner && giveaway.status !== "drawn"

  return (
    <Page width="compact" as="article" className="viewer">
      <GiveawayHead giveaway={giveaway} as="h1" />
      {isWinner ? null : <GiveawayPhase giveaway={giveaway} />}
      <div aria-live="polite" className="viewer-outcome">
        {me.kind === "won" ? (
          <ClaimPanel code={code} win={me} giveaway={giveaway} />
        ) : (
          <EntryPanel
            entry={entry}
            tickets={tickets}
            notDrawn={me.kind === "not-won"}
            signedOut={me.kind === "signed-out"}
            showSteps={entry !== null && entry !== fromServer}
            giveaway={giveaway}
            signInHref={signInHref}
          />
        )}
      </div>
      <div className="viewer-details">
        {isIn ? null : <GiveawayFacts kind={isWinner ? "pool" : "entry"} giveaway={giveaway} />}
        <GiveawayRules giveaway={giveaway} />
      </div>
      {giveaway.status === "drawn" ? (
        <Link className="button text" to={`/g/${code}/verify`}>
          {t("giveaway.verify.link")}
        </Link>
      ) : null}
      <RunYourOwn />
      {isIn && channelUrl !== null ? (
        <div className="viewer-dock">
          <ExternalLink kind="reference" className="button outlined block" href={channelUrl}>
            <TwitchIcon />
            {t("giveaway.watch", { name: giveaway.streamerName })}
          </ExternalLink>
        </div>
      ) : null}
    </Page>
  )
}
