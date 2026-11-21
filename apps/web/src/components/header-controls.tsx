import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useLocation } from "react-router"
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
import { MoonIcon, SlidersIcon, SunIcon, TvIcon } from "./icons.tsx"
import { SegmentRow } from "./segment-row.tsx"

const languageNames: Readonly<Record<Language, string>> = {
  en: "English",
  sk: "Slovenčina",
  cs: "Čeština",
}

/** The theme and language switches behind one icon button, in a popover, as the app bar and the live page's top bar show them. `children` come first in the popover. */
export function SettingsMenu({ children }: { readonly children?: ReactNode | undefined }) {
  const { t } = useI18n()
  const panelId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  // The bar stays mounted across pages, so a link in the open panel would leave it covering the page it opens.
  const shownPath = useRef(pathname)
  useEffect(() => {
    if (shownPath.current === pathname) return
    shownPath.current = pathname
    const element = panel.current
    if (element !== null && element.matches(":popover-open")) element.hidePopover()
  }, [pathname])

  return (
    <>
      <button
        type="button"
        className="icon-button settings-button"
        popoverTarget={panelId}
        aria-label={t("settings.label")}
      >
        <SlidersIcon />
      </button>
      <div id={panelId} ref={panel} popover="auto" className="settings-panel">
        {children}
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
    </>
  )
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
      <legend>{t("theme.legend")}</legend>
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
      <legend>{t("language.legend")}</legend>
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
