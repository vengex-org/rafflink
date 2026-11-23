import { useCallback, useId, useState } from "react"
import type { WinnerAnswers, WinnerFieldKind } from "@rafflink/core/domain/winner-form"
import type { WinnerAnswersJson } from "@rafflink/core/http/json"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import { getPickAnswers, getWinnerAnswers, markDelivered } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"
import { ConfirmAction } from "./confirm-action.tsx"
import { EyeIcon, EyeOffIcon } from "./icons.tsx"
import { Status } from "./notice.tsx"

type AnsweredPick = WinnerAnswersJson["picks"][number]

/**
 * The winner form answers on the streamer's own live page; a moderator link's page never has it. Streamers share this
 * page on stream, so it says only that answers came; one pick's answers load after the streamer confirms, and a reload
 * or a new claim hides them again.
 */
export function WinnerAnswersPanel({
  id,
  winners,
}: {
  readonly id: string
  readonly winners: readonly LiveWinner[]
}) {
  // A new claim mounts the panel again, which loads the answers again.
  const claims = winners.filter((winner) => winner.claim.state === "claimed").length
  return <Answers key={claims} id={id} winners={winners} />
}

function Answers({
  id,
  winners,
}: {
  readonly id: string
  readonly winners: readonly LiveWinner[]
}) {
  const { t } = useI18n()
  const headId = useId()
  const load = useCallback(() => getWinnerAnswers(id), [id])
  const { result, reload } = useLoad(load)
  if (result.state === "ready" && result.value.form.length === 0) return null
  return (
    <section className="live-card winner-answers" aria-labelledby={headId}>
      <h2 id={headId}>{t("answers.title")}</h2>
      {result.state === "loading" ? <p>{t("common.loading")}</p> : null}
      {result.state === "failed" ? <p>{t("answers.failed")}</p> : null}
      {result.state === "ready" ? (
        result.value.picks.length === 0 ? (
          <p className="help">{t("answers.none")}</p>
        ) : (
          result.value.picks.map((pick) => (
            <PickAnswers
              key={pick.n}
              id={id}
              form={result.value.form}
              pick={pick}
              name={winners.find((winner) => winner.n === pick.n)?.displayName ?? null}
              onDelivered={reload}
            />
          ))
        )
      ) : null}
      <p className="help">{t("answers.privacy")}</p>
    </section>
  )
}

function PickAnswers({
  id,
  form,
  pick,
  name,
  onDelivered,
}: {
  readonly id: string
  readonly form: readonly WinnerFieldKind[]
  readonly pick: AnsweredPick
  readonly name: string | null
  readonly onDelivered: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { message, busy, run } = useAction()
  const [shown, setShown] = useState<WinnerAnswers | null>(null)
  // Delivery deletes the answers, so what was shown goes with them, from memory too.
  if (!pick.held && shown !== null) setShown(null)
  const values = pick.held ? shown : null
  const reveal = () =>
    void run(
      async () => {
        const answers = await getPickAnswers(id, pick.n)
        setShown(answers.values)
        return answers.values === null ? "gone" : "shown"
      },
      (outcome) => (outcome === "gone" ? "answers.deleted" : null),
    )
  return (
    <article className="winner-answer">
      <h3>{t("answers.pick", { n: pick.n + 1, name: name ?? t("answers.unnamed") })}</h3>
      {!pick.held ? (
        <p className="help">{t(stateText(pick))}</p>
      ) : values === null ? (
        <>
          <p>{t("answers.received")}</p>
          <ConfirmAction
            icon={<EyeIcon />}
            label={t("answers.show")}
            question={t("answers.confirm.title")}
            detail={t("answers.confirm.text")}
            confirmLabel={t("answers.confirm.show")}
            busy={busy}
            disabled={false}
            className="live-btn secondary"
            shortcut={null}
            onConfirm={reveal}
          />
        </>
      ) : (
        <>
          <dl className="winner-answer-list">
            {form.map((kind) => (
              <div key={kind}>
                <dt>{t(`winnerField.${kind}`)}</dt>
                <dd className="winner-answer-value">{values[kind] ?? ""}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="live-btn ghost" onClick={() => setShown(null)}>
            <EyeOffIcon />
            {t("answers.hide")}
          </button>
        </>
      )}
      {pick.deliveredAt === null ? (
        <button
          type="button"
          className="live-btn secondary"
          disabled={busy}
          onClick={async () => {
            const outcome = await run(
              () => markDelivered(id, pick.n),
              (kind) => (kind === "delivered" ? null : "answers.deliverFailed"),
            )
            if (outcome === "delivered" || outcome === "already-delivered") onDelivered()
          }}
        >
          {t("answers.markDelivered")}
        </button>
      ) : (
        <p className="help">{t("answers.delivered", { at: i18n.dateTime(pick.deliveredAt) })}</p>
      )}
      {message === null ? null : <Status>{t(message)}</Status>}
    </article>
  )
}

function stateText(pick: AnsweredPick): MessageKey {
  switch (pick.answers) {
    case "open":
      return "answers.waiting"
    case "sent":
      return "answers.deleted"
    case "closed":
      return "answers.closed"
  }
}
