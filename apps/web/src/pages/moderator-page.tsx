import { useEffect, useState } from "react"
import { Navigate, useLocation, useParams, useSearchParams } from "react-router"
import type { EntrantsDelta, LiveSnapshot } from "@rafflink/core/room/giveaway-room"
import { errorClass } from "@rafflink/core/lib/error-class"
import {
  moderatorSnapshotPath,
  openModeratorLink,
  parseLiveSnapshot,
  type OpenLinkResult,
} from "../api/client.ts"
import { AlertIcon, LockIcon, LogInIcon } from "../components/icons.tsx"
import { Failed, Loading, NotFound } from "../components/notice.tsx"
import { StateColumn } from "../components/page.tsx"
import { StateCard } from "../components/state-card.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { LiveApiProvider, moderatorLiveApi } from "../lib/live-api.ts"
import { moderatorLivePath, moderatorSignInOutcomes, moderatorSignInPath } from "../lib/routes.ts"
import { useEntrants } from "../lib/use-entrants.ts"
import { useGiveawayFacts } from "../lib/use-giveaway-facts.ts"
import { useLive } from "../lib/use-live.ts"
import { LiveControls, Plain } from "./live-page.tsx"

const moderatorCleanModeKey = "rafflink-mod-clean"

type OpenPageResult = OpenLinkResult | { readonly kind: "sign-in-again" }

/**
 * Where a moderator link lands: the token in the fragment opens the link once, the server answers with a
 * cookie for that giveaway's moderator page, and the page moves there without the token in the address. A
 * link that requires a moderator sends the opener through the Twitch sign-in, which comes back here with
 * `?moderator=` only when it did not end on the moderator page.
 */
export function ModeratorOpenPage() {
  const { hash } = useLocation()
  const [params] = useSearchParams()
  const [token] = useState(() => (hash.length > 1 ? hash.slice(1) : null))
  const [result, setResult] = useState<OpenPageResult | "loading" | "failed">(() =>
    token === null ? signInOutcome(params.get("moderator")) : "loading",
  )

  useEffect(() => {
    if (token === null) return
    let current = true
    openModeratorLink(token).then(
      (opened) => {
        if (current) setResult(opened)
      },
      (error: unknown) => {
        console.error("moderator link failed", { errorClass: errorClass(error) })
        if (current) setResult("failed")
      },
    )
    return () => {
      current = false
    }
  }, [token])

  if (result === "loading") return <Loading />
  if (result === "failed") return <Failed />
  switch (result.kind) {
    case "opened":
      return <Navigate replace to={moderatorLivePath(result.giveawayId)} />
    case "sign-in-required":
      return <ModeratorSignIn />
    case "sign-in-again":
      return <Refused title="mod.invalid.title" text="mod.signInAgain" />
    case "not-a-moderator":
      return <Refused title="mod.notMod.title" text="mod.notMod.text" />
    case "link-invalid":
      return <Refused title="mod.invalid.title" text="mod.invalid.text" />
    case "rate-limited":
      return <Refused title="mod.invalid.title" text="mod.rateLimited" />
    case "try-again":
      return <Failed />
  }
}

/** The live page of a giveaway as a moderator link opens it: the streamer's controls without the streamer's settings. */
export function ModeratorLivePage() {
  const { id } = useParams()
  return id === undefined ? (
    <Plain>
      <NotFound title="notFound.live" />
    </Plain>
  ) : (
    <LiveApiProvider value={moderatorLiveApi}>
      <Loaded id={id} />
    </LiveApiProvider>
  )
}

function Loaded({ id }: { readonly id: string }) {
  const live = useLive(moderatorSnapshotPath(id), parseLiveSnapshot)
  switch (live.state) {
    case "loading":
      return (
        <Plain>
          <Loading />
        </Plain>
      )
    case "failed":
      return (
        <Plain>
          <Failed />
        </Plain>
      )
    case "unauthorized":
    case "forbidden":
      return (
        <Plain>
          <Refused title="mod.invalid.title" text="mod.invalid.text" />
        </Plain>
      )
    case "not-found":
      return (
        <Plain>
          <NotFound title="notFound.live" />
        </Plain>
      )
    case "ready":
      return (
        <Connected
          key={id}
          id={id}
          snapshot={live.snapshot}
          connected={live.connected}
          entrantsAfter={live.entrantsAfter}
        />
      )
  }
}

function Connected({
  id,
  snapshot,
  connected,
  entrantsAfter,
}: {
  readonly id: string
  readonly snapshot: LiveSnapshot
  readonly connected: boolean
  readonly entrantsAfter: EntrantsDelta | null
}) {
  const { facts } = useGiveawayFacts(snapshot.code)
  const entrants = useEntrants(id, { connected, entrantsAfter })
  return (
    <LiveControls
      id={id}
      snapshot={snapshot}
      connected={connected}
      overlayToken={null}
      donateUrl={null}
      cleanModeKey={moderatorCleanModeKey}
      facts={facts}
      entrants={entrants}
      winnerAnswers={false}
    />
  )
}

// The sign-in itself ended elsewhere: a refusal, an expired state, or a check that failed.
function signInOutcome(raw: string | null): OpenPageResult {
  const outcome = moderatorSignInOutcomes.find((value) => value === raw)
  switch (outcome) {
    case "cancelled":
    case "invalid-state":
      return { kind: "sign-in-again" }
    case "not-a-moderator":
    case "try-again":
    case "link-invalid":
      return { kind: outcome }
    case undefined:
      return { kind: "link-invalid" }
  }
}

/** The link needs a moderator: the sign-in asks Twitch only who the opener is and comes back to the moderator page. */
function ModeratorSignIn() {
  const { t } = useI18n()
  return (
    <StateColumn>
      <StateCard tone="info" align="center" icon={<LockIcon />} title={t("signIn.title")} level={1}>
        <p>{t("signIn.why.moderator")}</p>
        <a className="button block" href={moderatorSignInPath}>
          <LogInIcon />
          {t("signIn.button")}
        </a>
      </StateCard>
    </StateColumn>
  )
}

function Refused({ title, text }: { readonly title: MessageKey; readonly text: MessageKey }) {
  const { t } = useI18n()
  return (
    <StateColumn>
      <StateCard
        tone="danger"
        align="center"
        icon={title === "mod.notMod.title" ? <LockIcon /> : <AlertIcon />}
        title={t(title)}
        level={1}
      >
        <p>{t(text)}</p>
      </StateCard>
    </StateColumn>
  )
}
