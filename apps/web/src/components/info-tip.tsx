import { useId, useState } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { InfoIcon } from "./icons.tsx"

/**
 * An (i) button that shows a longer explanation under the line it sits in, so the line itself stays short.
 * The text is a live region: screen readers read it when it opens. The parent lays the text out on its own row.
 */
export function InfoTip({ topic, text }: { readonly topic: string; readonly text: string }) {
  const { t } = useI18n()
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="info-tip"
        aria-label={t("info.about", { topic })}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((shown) => !shown)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false)
        }}
      >
        <InfoIcon />
      </button>
      <output id={id} className="info-tip-text">
        {open ? text : null}
      </output>
    </>
  )
}
