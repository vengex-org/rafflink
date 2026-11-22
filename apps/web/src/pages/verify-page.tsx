import type { LeavesJson, MyLeafJson } from "@rafflink/core/http/json"
import { publicDrandUrls, roundPath } from "@rafflink/core/lib/drand"
import { errorClass } from "@rafflink/core/lib/error-class"
import { useCallback, useEffect, useEffectEvent, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { getVerifyLoad, type VerifyLoad } from "../api/client.ts"
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  ShuffleIcon,
} from "../components/icons.tsx"
import { ExternalLink } from "../components/external-link.tsx"
import { Fact } from "../components/fact.tsx"
import { GiveawayCode } from "../components/giveaway-code.tsx"
import { Failed, Loading, NotFound } from "../components/notice.tsx"
import { Page } from "../components/page.tsx"
import { RunYourOwn } from "../components/run-your-own.tsx"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { giveawayPath } from "../lib/routes.ts"
import { useLoad } from "../lib/use-load.ts"
import { verifyDraw, type Commitment, type OwnEntry, type Verdict } from "../lib/verify-draw.ts"

export function VerifyPage() {
  return <GiveawayCode page="verify">{(code) => <Loaded code={code} />}</GiveawayCode>
}

function Loaded({ code }: { readonly code: string }) {
  const load = useCallback(() => getVerifyLoad(code), [code])
  const { result, reload } = useLoad(load)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return result.value === null ? (
        <NotFound title="notFound.giveaway" />
      ) : (
        <Verify code={code} load={result.value} />
      )
  }
}

function Verify({ code, load }: { readonly code: string; readonly load: VerifyLoad }) {
  const { t } = useI18n()
  const { verify, leaves, mine } = load
  const { commitment } = verify
  return (
    <Page width="text" as="article" className="verify">
      <header>
        <Link className="button text small" to={giveawayPath(code)}>
          <ArrowLeftIcon />
          {t("verify.back")}
        </Link>
        <h1>{t("verify.title")}</h1>
        <p>{t("verify.intro")}</p>
      </header>
      {commitment === null || leaves === null ? (
        <Waiting status={verify.status} committed={commitment !== null} />
      ) : (
        <>
          <Facts code={code} load={load} commitment={commitment} />
          <Checker load={load} commitment={commitment} leaves={leaves} mine={mine} code={code} />
        </>
      )}
      <RunYourOwn />
    </Page>
  )
}

/** Why there is nothing to check yet, or ever. */
function Waiting({
  status,
  committed,
}: {
  readonly status: VerifyLoad["verify"]["status"]
  readonly committed: boolean
}) {
  const { t } = useI18n()
  if (status === "drawn" && !committed) return <output>{t("verify.unverifiable")}</output>
  return <output>{t(status === "open" ? "verify.open" : "verify.closed.pending")}</output>
}

function Facts({
  code,
  load,
  commitment,
}: {
  readonly code: string
  readonly load: VerifyLoad
  readonly commitment: Commitment
}) {
  const i18n = useI18n()
  const { t } = i18n
  const roundUrl = `${publicDrandUrls[0]}${roundPath(commitment.chainHash, commitment.round)}`
  return (
    <dl className="verify-facts">
      <Fact label={t("verify.facts.entrants")}>{i18n.number(load.verify.entrantCount)}</Fact>
      <Fact label={t("verify.facts.tickets")}>{i18n.number(load.verify.ticketTotal)}</Fact>
      <Fact label={t("verify.facts.winners")}>{i18n.number(load.verify.winnerCount)}</Fact>
      <Fact label={t("verify.facts.committed")}>{i18n.dateTime(commitment.committedAt)}</Fact>
      <Fact label={t("verify.facts.root")} mono>
        {commitment.merkleRoot}
      </Fact>
      <Fact label={t("verify.facts.chain")} mono>
        {commitment.chainHash}
      </Fact>
      <Fact label={t("verify.facts.round")}>
        <ExternalLink kind="reference" href={roundUrl}>
          {commitment.round}
        </ExternalLink>
      </Fact>
      <Fact label={t("verify.facts.leaves")}>
        <a href={`/api/g/${encodeURIComponent(code)}/leaves`}>{t("verify.facts.leavesLink")}</a>
      </Fact>
    </dl>
  )
}

type Run =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "done"; readonly verdict: Verdict }
  | { readonly state: "failed" }

function Checker({
  load,
  commitment,
  leaves,
  mine,
  code,
}: {
  readonly load: VerifyLoad
  readonly commitment: Commitment
  readonly leaves: LeavesJson
  readonly mine: MyLeafJson | null
  readonly code: string
}) {
  const { t } = useI18n()
  const [query, setQuery] = useSearchParams()
  // A link with `?run=1` opens the page with the check already running.
  const [opened] = useState(() => query.get("run") === "1")
  const [run, setRun] = useState<Run>({ state: opened ? "running" : "idle" })
  const check = () =>
    verifyDraw({ verify: load.verify, commitment, leaves, mine }).then(
      (verdict) => setRun({ state: "done", verdict }),
      (error: unknown) => {
        console.error("verification failed", { errorClass: errorClass(error) })
        setRun({ state: "failed" })
      },
    )
  const checkWhenOpened = useEffectEvent(() => {
    if (opened) void check()
  })
  useEffect(() => checkWhenOpened(), [])
  const start = () => {
    setRun({ state: "running" })
    // The check is part of the address, so a shared link runs it.
    setQuery(
      (current) => {
        const next = new URLSearchParams(current)
        next.set("run", "1")
        return next
      },
      { replace: true },
    )
    void check()
  }
  return (
    <>
      <section className="verify-run">
        <button
          type="button"
          className="button large"
          disabled={run.state === "running"}
          onClick={start}
        >
          <ShuffleIcon />
          {t(run.state === "running" ? "verify.running" : "verify.run")}
        </button>
        {run.state === "failed" ? <p role="alert">{t("action.failed")}</p> : null}
        {run.state === "done" ? <Results verdict={run.verdict} commitment={commitment} /> : null}
      </section>
      {load.verify.picks.length === 0 ? null : <Picks picks={load.verify.picks} />}
      <Mine mine={mine} verdict={run.state === "done" ? run.verdict.mine : null} code={code} />
    </>
  )
}

function Picks({ picks }: { readonly picks: VerifyLoad["verify"]["picks"] }) {
  const i18n = useI18n()
  const { t } = i18n
  const rerolled = picks.filter((pick) => pick.rerolled).length
  return (
    <section>
      <h2>{t("verify.winners.title")}</h2>
      <p>{t("verify.rerolls.note")}</p>
      <p>{t("verify.rerolls.count", { count: i18n.number(rerolled) })}</p>
      <ol className="verify-picks">
        {picks.map((pick) => {
          const before = picks.filter((other) => other.rerolled && other.n < pick.n).length
          return (
            <li key={pick.n}>
              {t("verify.winner.entry", { n: pick.n + 1, leaf: (pick.leafIndex ?? -1) + 1 })}
              {pick.rerolled ? ` ${t("verify.winner.rerolled")}` : ""}
              {!pick.rerolled && before > 0
                ? ` ${t("verify.winner.before", { count: i18n.number(before) })}`
                : ""}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Results({
  verdict,
  commitment,
}: {
  readonly verdict: Verdict
  readonly commitment: Commitment
}) {
  const { t } = useI18n()
  const rows: readonly { readonly outcome: string; readonly text: string }[] = [
    { outcome: verdict.counts, text: t(`verify.check.counts.${verdict.counts}`) },
    { outcome: verdict.root, text: t(`verify.check.root.${verdict.root}`) },
    { outcome: verdict.timing, text: t(`verify.check.timing.${verdict.timing}`) },
    {
      outcome: signatureOutcome[verdict.signature],
      text: t(`verify.check.signature.${verdict.signature}`, { round: commitment.round }),
    },
    {
      outcome: verdict.winners,
      text: t(`verify.check.winners.${verdict.winners}`, { round: commitment.round }),
    },
  ]
  return (
    <ul className="verify-checks" aria-live="polite">
      {rows.map((row) => (
        <li key={row.text} data-outcome={row.outcome}>
          <CheckMark outcome={row.outcome} />
          {row.text}
        </li>
      ))}
    </ul>
  )
}

const signatureOutcome = {
  valid: "match",
  invalid: "mismatch",
  unavailable: "unavailable",
  none: "none",
} as const satisfies Record<Verdict["signature"], string>

function CheckMark({ outcome }: { readonly outcome: string }) {
  switch (outcome) {
    case "match":
      return <CheckCircleIcon />
    case "mismatch":
      return <AlertIcon />
    default:
      return <ClockIcon />
  }
}

function Mine({
  mine,
  verdict,
  code,
}: {
  readonly mine: MyLeafJson | null
  readonly verdict: OwnEntry | null
  readonly code: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <section className="verify-mine">
      <h2>{t("verify.mine.title")}</h2>
      {mine === null ? (
        <p>
          {t("verify.mine.signedOut")} <Link to={giveawayPath(code)}>{t("verify.back")}</Link>
        </p>
      ) : (
        <>
          <p>{t("verify.mine.hint")}</p>
          <dl className="verify-facts">
            <Fact label={t("verify.mine.platform")}>{mine.platform}</Fact>
            <Fact label={t("verify.mine.user")} mono>
              {mine.platformUserId}
            </Fact>
            <Fact label={t("verify.facts.tickets")}>{i18n.number(mine.tickets)}</Fact>
            <Fact label={t("verify.mine.salt")} mono>
              {mine.salt ?? t("verify.mine.noSalt")}
            </Fact>
          </dl>
          {verdict === null ? null : <OwnVerdict verdict={verdict} i18n={i18n} />}
        </>
      )}
    </section>
  )
}

function OwnVerdict({ verdict, i18n }: { readonly verdict: OwnEntry; readonly i18n: I18n }) {
  const { t } = i18n
  if (verdict.kind === "missing") return <output>{t("verify.mine.missing")}</output>
  return (
    <output>
      {t("verify.mine.found", { leaf: verdict.leaf + 1, tickets: i18n.number(verdict.tickets) })}
      {verdict.pick === null ? "" : ` ${t("verify.mine.won", { n: verdict.pick + 1 })}`}
    </output>
  )
}
