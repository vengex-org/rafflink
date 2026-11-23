import { useState, type FormEvent } from "react"
import { errorClass } from "@rafflink/core/lib/error-class"
import { reportError } from "../lib/error-reporting.ts"
import { isLoginEntered } from "../api/client.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { TextField } from "./form-fields.tsx"
import { SearchIcon } from "./icons.tsx"

type LookupAnswer =
  | { readonly kind: "answered"; readonly login: string; readonly entered: boolean }
  | { readonly kind: "failed" }

/** The chat way in: the keyword to type while entries are open, and "Am I in?" by login for a viewer who entered in chat without signing in. */
export function ChatEntry({
  code,
  keyword,
  streamerName,
  open,
}: {
  readonly code: string
  readonly keyword: string
  readonly streamerName: string
  /** Entries are open, so typing the keyword still enters. */
  readonly open: boolean
}) {
  const { t, rich } = useI18n()
  const [login, setLogin] = useState("")
  const [answer, setAnswer] = useState<LookupAnswer | null>(null)
  const [busy, setBusy] = useState(false)

  const check = async (event: FormEvent) => {
    event.preventDefault()
    const typed = login.trim()
    if (typed === "") return
    setBusy(true)
    try {
      setAnswer({ kind: "answered", login: typed, entered: await isLoginEntered(code, typed) })
    } catch (error) {
      console.error("entrant lookup failed", { errorClass: errorClass(error) })
      reportError(error)
      setAnswer({ kind: "failed" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="chat-entry" aria-label={t("giveaway.lookup.legend")}>
      {open ? (
        <p className="viewer-note">
          {rich("giveaway.chatEntry", { keyword: <code>{keyword}</code>, name: streamerName })}
        </p>
      ) : null}
      <form className="chat-lookup" onSubmit={check}>
        <TextField
          name="login"
          label={t("giveaway.lookup.label")}
          help={null}
          type="text"
          value={login}
          error={null}
          onChange={setLogin}
        />
        <button className="button outlined" type="submit" disabled={busy}>
          <SearchIcon />
          {t("giveaway.lookup.button")}
        </button>
      </form>
      <output className="viewer-note">{answer === null ? null : answerText(t, answer)}</output>
    </section>
  )
}

function answerText(t: I18n["t"], answer: LookupAnswer): string {
  switch (answer.kind) {
    case "failed":
      return t("giveaway.lookup.failed")
    case "answered":
      return t(answer.entered ? "giveaway.lookup.yes" : "giveaway.lookup.no", {
        login: answer.login,
      })
  }
}
