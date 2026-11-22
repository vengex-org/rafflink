import { publicDrandUrls, quicknet, roundPath, roundTime } from "@rafflink/core/lib/drand"
import { errorClass } from "@rafflink/core/lib/error-class"
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { CopyLink } from "../components/copy-field.tsx"
import { DrawShuffle } from "../components/draw-shuffle.tsx"
import { ExternalLink } from "../components/external-link.tsx"
import { Fact } from "../components/fact.tsx"
import { StepperField, TextField } from "../components/form-fields.tsx"
import { AlertIcon, CheckCircleIcon, RefreshIcon, ShuffleIcon } from "../components/icons.tsx"
import { Page } from "../components/page.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { verifyBeaconSignature } from "../lib/beacon-signature.ts"
import {
  commitHash,
  commitList,
  drawNames,
  listFile,
  maxNames,
  maxTitleLength,
  parseListFile,
  parseNames,
  parseShareFragment,
  shareFragment,
  type DrawLink,
  type ListCommit,
} from "../lib/list-draw.ts"
import { drawPath } from "../lib/routes.ts"
import { sleep } from "../lib/use-entry-result.ts"
import { fetchBeaconRound } from "../lib/verify-draw.ts"

/**
 * A draw from a pasted list, without an account: the list is fixed to a future drand round and the winners
 * follow from both. Everything runs in the browser; the share link carries the list in its fragment, which
 * browsers never send to a server, and the only request is the drand round.
 */
export function DrawPage() {
  const { t } = useI18n()
  const { hash, state } = useLocation()
  return (
    <Page width="text" as="article" className="verify draw">
      <header>
        <h1>{t("draw.title")}</h1>
        <p>{t("draw.intro")}</p>
      </header>
      {hash === "" ? (
        <DrawForm />
      ) : (
        <SharedDraw key={hash} fragment={hash} stored={typeof state === "string" ? state : null} />
      )}
      <Proof />
    </Page>
  )
}

function DrawForm() {
  const { t, number } = useI18n()
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [winners, setWinners] = useState("1")
  const [text, setText] = useState("")
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const names = parseNames(text)
  const count = names.kind === "names" ? names.names.length : 0
  const winnerCount = Number(winners)
  const namesError = {
    names: null,
    empty: t("draw.form.empty"),
    "too-many": t("draw.form.tooMany", { max: number(maxNames) }),
  }[names.kind]
  const winnersError =
    Number.isSafeInteger(winnerCount) && winnerCount >= 1 && winnerCount <= Math.max(1, count)
      ? null
      : t("draw.form.winnersInvalid", { max: number(Math.max(1, count)) })
  const titleError =
    title.trim().length > maxTitleLength
      ? t("draw.form.titleTooLong", { max: number(maxTitleLength) })
      : null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setChecked(true)
    if (names.kind !== "names" || winnersError !== null || titleError !== null) return
    setBusy(true)
    setFailed(false)
    try {
      const { commit, hash } = await fixList(names.names, {
        title: title.trim(),
        winners: winnerCount,
      })
      // The list rides in the history entry too, so this tab keeps a list too long for the link through a reload.
      navigate({ hash: shareFragment(commit, hash).fragment }, { state: listFile(commit) })
    } catch (error) {
      console.error("list commit failed", { errorClass: errorClass(error) })
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <TextField
        name="title"
        label={t("draw.form.title")}
        help={null}
        value={title}
        error={checked ? titleError : null}
        onChange={setTitle}
        type="text"
      />
      <NamesField
        value={text}
        onChange={setText}
        error={checked ? namesError : null}
        summary={
          names.kind === "names"
            ? t("draw.form.count", { count: number(count), repeats: number(names.repeats) })
            : null
        }
      />
      <StepperField
        name="winners"
        label={t("draw.form.winners")}
        help={null}
        value={winners}
        min={1}
        error={checked ? winnersError : null}
        onChange={setWinners}
        decreaseLabel={t("winners.fewer")}
        increaseLabel={t("winners.more")}
      />
      <button type="submit" className="button large" disabled={busy}>
        <ShuffleIcon />
        {t("draw.commit")}
      </button>
      {failed ? <p role="alert">{t("action.failed")}</p> : null}
    </form>
  )
}

async function fixList(
  names: readonly string[],
  terms: { readonly title: string; readonly winners: number },
): Promise<{ readonly commit: ListCommit; readonly hash: string }> {
  const commit = commitList(names, terms, Date.now())
  return { commit, hash: await commitHash(commit) }
}

function NamesField({
  value,
  onChange,
  error,
  summary,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly error: string | null
  readonly summary: string | null
}) {
  const { t, number } = useI18n()
  return (
    <div className="field">
      <label htmlFor="draw-names">{t("draw.form.names")}</label>
      <p id="draw-names-help" className="help">
        {t("draw.form.namesHelp", { max: number(maxNames) })}
      </p>
      <textarea
        id="draw-names"
        name="names"
        rows={10}
        spellCheck={false}
        autoComplete="off"
        value={value}
        aria-invalid={error !== null}
        aria-describedby={error === null ? "draw-names-help" : "draw-names-help draw-names-error"}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {summary === null ? null : <p className="help">{summary}</p>}
      {error === null ? null : (
        <p id="draw-names-error" className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** A link opened: its list from the link, from this tab's history entry, or from the file the viewer picks. */
function SharedDraw({
  fragment,
  stored,
}: {
  readonly fragment: string
  readonly stored: string | null
}) {
  const { t } = useI18n()
  const link = useMemo(() => parseShareFragment(fragment), [fragment])
  const [picked, setPicked] = useState<ListCommit | null>(() =>
    stored === null ? null : parseListFile(stored),
  )
  // One object per list: the hash check and the draw start over whenever it changes.
  const commit = useMemo(
    () => (link === null || link.names === null ? picked : { ...link.commit, names: link.names }),
    [link, picked],
  )
  if (link === null) {
    return (
      <>
        <p role="alert">{t("draw.badLink")}</p>
        <NewDrawLink />
      </>
    )
  }
  return commit === null ? (
    <FilePicker onPicked={setPicked} />
  ) : (
    <CheckedDraw link={link} commit={commit} />
  )
}

function FilePicker({ onPicked }: { readonly onPicked: (commit: ListCommit) => void }) {
  const { t } = useI18n()
  const [invalid, setInvalid] = useState(false)
  const read = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return
    let text: string
    try {
      text = await file.text()
    } catch (error) {
      // The browser could not read the file (moved, no permission); to the viewer it is no list file either.
      console.warn("list file unreadable", { errorClass: errorClass(error) })
      setInvalid(true)
      return
    }
    const commit = parseListFile(text)
    setInvalid(commit === null)
    if (commit !== null) onPicked(commit)
  }
  return (
    <div className="field">
      <label htmlFor="draw-file">{t("draw.file.label")}</label>
      <p id="draw-file-help" className="help">
        {t("draw.file.help")}
      </p>
      <input
        id="draw-file"
        type="file"
        accept=".json,application/json"
        aria-describedby={invalid ? "draw-file-help draw-file-error" : "draw-file-help"}
        onChange={(event) => void read(event)}
      />
      {invalid ? (
        <p id="draw-file-error" className="field-error">
          {t("draw.file.invalid")}
        </p>
      ) : null}
    </div>
  )
}

/** The list next to the hash the link names: a list that does not hash to it is never drawn. */
function CheckedDraw({ link, commit }: { readonly link: DrawLink; readonly commit: ListCommit }) {
  const { t } = useI18n()
  const [hashed, setHashed] = useState<{ readonly of: ListCommit; readonly hash: string } | null>(
    null,
  )
  useEffect(() => {
    let current = true
    void commitHash(commit).then((hash) => {
      if (current) setHashed({ of: commit, hash })
    })
    return () => {
      current = false
    }
  }, [commit])
  if (hashed?.of !== commit) return null
  if (hashed.hash !== link.hash) {
    return (
      <>
        <p role="alert">{t("draw.mismatch")}</p>
        <NewDrawLink />
      </>
    )
  }
  return <Committed commit={commit} hash={link.hash} />
}

function Committed({ commit, hash }: { readonly commit: ListCommit; readonly hash: string }) {
  const i18n = useI18n()
  const { t } = i18n
  const roundAt = roundTime(quicknet, commit.round)
  const { fragment, withNames } = shareFragment(commit, hash)
  const shareUrl = `${window.location.origin}${drawPath}#${fragment}`
  // Read once: whoever saw the list before its round saw it fixed in advance, also after the round is out.
  const [seenBefore] = useState(() => Date.now() < roundAt)
  const roundUrl = `${publicDrandUrls[0]}${roundPath(quicknet.chainHash, commit.round)}`
  return (
    <>
      {commit.title === "" ? null : <h2>{commit.title}</h2>}
      <dl className="verify-facts">
        <Fact label={t("draw.facts.names")}>{i18n.number(commit.names.length)}</Fact>
        <Fact label={t("draw.facts.winners")}>{i18n.number(commit.winners)}</Fact>
        <Fact label={t("draw.facts.hash")} mono>
          {hash}
        </Fact>
        <Fact label={t("verify.facts.round")}>
          <ExternalLink kind="reference" href={roundUrl}>
            {commit.round}
          </ExternalLink>
        </Fact>
        <Fact label={t("draw.facts.roundAt")}>{i18n.dateTime(roundAt)}</Fact>
        <Fact label={t("draw.facts.committed")}>{i18n.dateTime(commit.committedAt)}</Fact>
      </dl>
      {commit.committedAt < roundAt ? null : (
        <p role="alert" className="draw-warning">
          <AlertIcon />
          {t("draw.early", { round: commit.round })}
        </p>
      )}
      {seenBefore && commit.committedAt < roundAt ? (
        <p className="draw-seen">
          <CheckCircleIcon />
          {t("draw.seenBefore", { round: commit.round })}
        </p>
      ) : null}
      <Outcome commit={commit} />
      <CopyLink
        label={t("draw.share.label")}
        value={shareUrl}
        buttonLabel={t("draw.share.copy")}
        clipped
      >
        {shareUrl}
      </CopyLink>
      <p>{t(withNames ? "draw.share.withNames" : "draw.share.noNames")}</p>
      <div className="draw-actions">
        <button type="button" className="button secondary" onClick={() => download(commit, hash)}>
          {t("draw.download")}
        </button>
        <NewDrawLink />
      </div>
    </>
  )
}

type Draw =
  | { readonly state: "waiting" }
  | { readonly state: "drawn"; readonly winners: readonly string[] }
  | { readonly state: "unavailable" }
  | { readonly state: "invalid" }
  | { readonly state: "failed" }

function Outcome({ commit }: { readonly commit: ListCommit }) {
  const { t } = useI18n()
  const [attempt, setAttempt] = useState(0)
  const draw = useRoundDraw(commit, attempt)
  switch (draw.state) {
    case "waiting":
      return (
        <section className="verify-run" aria-live="polite">
          <p>{t("draw.waiting", { round: commit.round })}</p>
          <Shuffle commit={commit} />
        </section>
      )
    case "drawn":
      return (
        <section className="verify-run" aria-live="polite">
          <h2>{t("verify.winners.title")}</h2>
          <ol className="draw-winners">
            {draw.winners.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ol>
          <p>{t("draw.drawn", { round: commit.round })}</p>
        </section>
      )
    case "invalid":
      return <p role="alert">{t("draw.invalid", { round: commit.round })}</p>
    case "unavailable":
    case "failed":
      return (
        <section className="verify-run">
          <p role="alert">
            {draw.state === "failed"
              ? t("action.failed")
              : t("draw.unavailable", { round: commit.round })}
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshIcon />
            {t("draw.retry")}
          </button>
        </section>
      )
  }
}

function Shuffle({ commit }: { readonly commit: ListCommit }) {
  const [waitMs] = useState(() => roundTime(quicknet, commit.round) - Date.now())
  return <DrawShuffle names={commit.names} waitMs={waitMs} />
}

// drand publishes on the second, but its HTTP APIs answer the newest round a moment later.
const fetchAttempts = 5
const fetchRetryMs = 2000

/** Waits for the round, reads it, checks its signature and draws; `attempt` starts over after a failure. */
function useRoundDraw(commit: ListCommit, attempt: number): Draw {
  const [draw, setDraw] = useState<{ readonly attempt: number; readonly draw: Draw } | null>(null)
  useEffect(() => {
    let current = true
    const isCurrent = () => current
    resolveDraw(commit, isCurrent).then(
      (next) => {
        if (next !== null && current) setDraw({ attempt, draw: next })
      },
      (error: unknown) => {
        console.error("list draw failed", { errorClass: errorClass(error) })
        if (current) setDraw({ attempt, draw: { state: "failed" } })
      },
    )
    return () => {
      current = false
    }
  }, [commit, attempt])
  return draw?.attempt === attempt ? draw.draw : { state: "waiting" }
}

// Null once the page no longer shows this draw, so a page left early stops before its next request.
async function resolveDraw(commit: ListCommit, isCurrent: () => boolean): Promise<Draw | null> {
  await sleep(roundTime(quicknet, commit.round) - Date.now())
  for (let tried = 1; tried <= fetchAttempts; tried++) {
    if (!isCurrent()) return null
    const beacon = await fetchBeaconRound(quicknet.chainHash, commit.round)
    if (beacon !== null) {
      if (!(await verifyBeaconSignature(quicknet.chainHash, beacon))) return { state: "invalid" }
      return {
        state: "drawn",
        winners: await drawNames(beacon.randomness, commit.names, commit.winners),
      }
    }
    if (tried < fetchAttempts) await sleep(fetchRetryMs)
  }
  return { state: "unavailable" }
}

function download(commit: ListCommit, hash: string): void {
  const url = URL.createObjectURL(new Blob([listFile(commit)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `draw-${hash.slice(0, 8)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function NewDrawLink() {
  const { t } = useI18n()
  return (
    <Link className="button text" to={drawPath}>
      {t("draw.new")}
    </Link>
  )
}

/** What the draw proves and what it cannot, on every view of the page. */
function Proof() {
  const { t } = useI18n()
  return (
    <section className="draw-proof">
      <h2>{t("draw.proof.title")}</h2>
      <ul>
        <li>{t("draw.proof.covers")}</li>
        <li>{t("draw.proof.private")}</li>
        <li>{t("draw.proof.time")}</li>
        <li>{t("draw.proof.list")}</li>
      </ul>
    </section>
  )
}
