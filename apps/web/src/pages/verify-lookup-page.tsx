import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router"
import { TextField } from "../components/form-fields.tsx"
import { Page } from "../components/page.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { parseGiveawayCode } from "../lib/giveaway-code.ts"

/** Where anyone can open the verification of a draw by its code or link, without being on the giveaway page. */
export function VerifyLookupPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [input, setInput] = useState("")
  const [invalid, setInvalid] = useState(false)

  const open = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = parseGiveawayCode(input)
    setInvalid(code === null)
    if (code !== null) {
      navigate(`/g/${code}/verify`)
      return
    }
    // The error is the input's description, so focus there makes a screen reader read it.
    const field = event.currentTarget.elements.namedItem("code")
    if (field instanceof HTMLElement) field.focus()
  }

  return (
    <Page width="text" as="article" className="verify">
      <h1>{t("verifyLookup.title")}</h1>
      <p>{t("verify.intro")}</p>
      <form onSubmit={open} noValidate>
        <TextField
          name="code"
          label={t("verifyLookup.label")}
          help={t("verifyLookup.help")}
          value={input}
          error={invalid ? t("verifyLookup.invalid") : null}
          onChange={(value) => {
            setInput(value)
            setInvalid(false)
          }}
          type="text"
          min={null}
        />
        <button type="submit" className="button">
          {t("verifyLookup.submit")}
        </button>
      </form>
    </Page>
  )
}
