import { useEffect, useState } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { languages, type Language } from "../i18n/language.ts"
import {
  applyTheme,
  darkQuery,
  storedTheme,
  storeTheme,
  themes,
  type Theme,
} from "../theme/theme.ts"
import { GlobeIcon, TvIcon, MoonIcon, SunIcon } from "./icons.tsx"
import { SegmentRow } from "./segment-row.tsx"

const languageNames: Readonly<Record<Language, string>> = {
  en: "English",
  sk: "Slovenčina",
  cs: "Čeština",
}

/** System, Light or Dark; the choice is kept in the browser and `System` follows the OS. */
export function ThemeSwitch() {
  const { t } = useI18n()
  const [theme, setTheme] = useState(storedTheme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== "system") return
    const query = window.matchMedia(darkQuery)
    const follow = () => applyTheme(theme)
    query.addEventListener("change", follow)
    return () => query.removeEventListener("change", follow)
  }, [theme])

  const options = themes.map((value) => ({
    value,
    label: t(`theme.${value}`),
    icon: themeIcon(value),
  }))
  return (
    <fieldset className="toggle">
      <legend className="sr-only">{t("theme.legend")}</legend>
      <SegmentRow
        name="theme"
        options={options}
        value={theme}
        labels="hidden"
        onSelect={(next) => {
          storeTheme(next)
          setTheme(next)
        }}
      />
    </fieldset>
  )
}

export function LanguageSwitch() {
  const { t, language, setLanguage } = useI18n()
  const options = languages.map((value) => ({
    value,
    label: languageNames[value],
    icon: <span aria-hidden="true">{value.toUpperCase()}</span>,
  }))
  return (
    <fieldset className="toggle">
      <legend className="sr-only">{t("language.legend")}</legend>
      <GlobeIcon />
      <SegmentRow
        name="language"
        options={options}
        value={language}
        labels="hidden"
        onSelect={setLanguage}
      />
    </fieldset>
  )
}

function themeIcon(theme: Theme) {
  switch (theme) {
    case "system":
      return <TvIcon />
    case "light":
      return <SunIcon />
    case "dark":
      return <MoonIcon />
  }
}
