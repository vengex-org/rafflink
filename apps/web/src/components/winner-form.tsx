import { useId, useState } from "react"
import type { WinnerAnswers, WinnerFieldKind } from "@rafflink/core/domain/winner-form"
import { sendWinnerAnswers } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { useAction } from "../lib/use-action.ts"
import { Status } from "./notice.tsx"

/** The winner form on the giveaway page, shown once the prize is claimed and until it is sent. */
export function WinnerForm({
  code,
  form,
  streamerName,
}: {
  readonly code: string
  readonly form: readonly WinnerFieldKind[]
  readonly streamerName: string
}) {
  const { t } = useI18n()
  const headId = useId()
  const { message, busy, run } = useAction()
  const [values, setValues] = useState<Partial<Record<WinnerFieldKind, string>>>({})
  const [sent, setSent] = useState(false)

  if (sent) return <Status>{t("winnerForm.saved")}</Status>
  const answers: WinnerAnswers = Object.fromEntries(form.map((kind) => [kind, values[kind] ?? ""]))
  return (
    <form
      className="card winner-form"
      aria-labelledby={headId}
      onSubmit={async (event) => {
        event.preventDefault()
        const outcome = await run(
          () => sendWinnerAnswers(code, answers),
          (kind) => `winnerForm.${kind}`,
        )
        if (outcome === "saved" || outcome === "already-answered") setSent(true)
      }}
    >
      <h3 id={headId}>{t("winnerForm.title")}</h3>
      <p className="help">{t("winnerForm.notice", { name: streamerName })}</p>
      {form.map((kind) => (
        <AnswerField
          key={kind}
          kind={kind}
          value={values[kind] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [kind]: value }))}
        />
      ))}
      <button type="submit" className="button block" disabled={busy}>
        {t("winnerForm.send")}
      </button>
      {message === null ? null : <Status>{t(message)}</Status>}
    </form>
  )
}

const autoComplete: Readonly<Record<WinnerFieldKind, string>> = {
  name: "name",
  email: "email",
  address: "street-address",
  "platform-id": "off",
  text: "off",
}

function AnswerField({
  kind,
  value,
  onChange,
}: {
  readonly kind: WinnerFieldKind
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const shared = { id, name: kind, required: true, autoComplete: autoComplete[kind], value }
  return (
    <div className="field">
      <label htmlFor={id}>{t(`winnerField.${kind}`)}</label>
      {kind === "address" || kind === "text" ? (
        <textarea {...shared} rows={3} onChange={(event) => onChange(event.currentTarget.value)} />
      ) : (
        <input
          {...shared}
          type={kind === "email" ? "email" : "text"}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </div>
  )
}
