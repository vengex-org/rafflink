import { useCallback, useId, useState } from "react"
import {
  defaultOverlayTheme,
  overlayCorners,
  overlayFonts,
  overlayPositions,
  overlaySizes,
  type OverlayTheme,
} from "@rafflink/core/domain/overlay-theme"
import {
  getGiveawayOverlayThemes,
  getStreamerOverlayTheme,
  saveGiveawayOverlayTheme,
  saveStreamerOverlayTheme,
  type Rejected,
} from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { hasLowContrast, overlayFontFamilies } from "../lib/overlay-theme.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"

import { Disclosure } from "./disclosure.tsx"
import { Segmented, type SegmentOption } from "./form-fields.tsx"
import { SlidersIcon } from "./icons.tsx"
import { OverlayPreview } from "./overlay-plates.tsx"
import { Failed, Loading } from "./notice.tsx"

/** The dashboard's overlay style: the theme of every giveaway that has none of its own. Loads once opened. */
export function StreamerOverlayStyle() {
  const { t } = useI18n()
  const [opened, setOpened] = useState(false)
  return (
    <Disclosure
      icon={<SlidersIcon />}
      summary={t("overlayStyle.dash.summary")}
      open={false}
      onToggle={(open) => setOpened((was) => was || open)}
    >
      <p className="help">{t("overlayStyle.dash.help")}</p>
      {opened ? <StreamerThemeLoader /> : null}
    </Disclosure>
  )
}

function StreamerThemeLoader() {
  const { result, reload } = useLoad(getStreamerOverlayTheme)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return <ThemeForm initial={result.value} editable save={saveStreamerOverlayTheme} />
  }
}

/** One giveaway's overlay style on its live page: the streamer's theme or one of its own. Loads once opened. */
export function GiveawayOverlayStyle({ id }: { readonly id: string }) {
  const { t } = useI18n()
  const [opened, setOpened] = useState(false)
  return (
    <Disclosure
      icon={<SlidersIcon />}
      summary={t("overlayStyle.giveaway.summary")}
      open={false}
      onToggle={(open) => setOpened((was) => was || open)}
    >
      {opened ? <GiveawayThemeLoader id={id} /> : null}
    </Disclosure>
  )
}

function GiveawayThemeLoader({ id }: { readonly id: string }) {
  const load = useCallback(() => getGiveawayOverlayThemes(id), [id])
  const { result, reload } = useLoad(load)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return <GiveawayThemeForm id={id} own={result.value.own} streamer={result.value.streamer} />
  }
}

type ThemeSource = "streamer" | "own"

function GiveawayThemeForm({
  id,
  own,
  streamer,
}: {
  readonly id: string
  readonly own: OverlayTheme | null
  readonly streamer: OverlayTheme
}) {
  const { t } = useI18n()
  const [source, setSource] = useState<ThemeSource>(own === null ? "streamer" : "own")
  const sourceOptions: readonly SegmentOption<ThemeSource>[] = (["streamer", "own"] as const).map(
    (value) => ({
      value,
      label: t(`overlayStyle.giveaway.${value}`),
      icon: null,
      description: t(`overlayStyle.giveaway.${value}.help`),
    }),
  )
  return (
    <>
      <Segmented
        name="overlay-theme-source"
        legend={t("overlayStyle.giveaway.source")}
        help={null}
        options={sourceOptions}
        value={source}
        onSelect={setSource}
      />
      {/* The key starts the form over from the theme the chosen source shows. */}
      <ThemeForm
        key={source}
        initial={source === "own" ? (own ?? streamer) : streamer}
        editable={source === "own"}
        save={(theme) => saveGiveawayOverlayTheme(id, source === "own" ? theme : null)}
      />
    </>
  )
}

/** The theme fields, a live preview and the save button; a form that is not `editable` shows the preview only. */
function ThemeForm({
  initial,
  editable,
  save,
}: {
  readonly initial: OverlayTheme
  readonly editable: boolean
  readonly save: (theme: OverlayTheme) => Promise<"saved" | Rejected>
}) {
  const { t } = useI18n()
  const [theme, setTheme] = useState(initial)
  const { message, busy, run } = useAction()
  const set = <F extends keyof OverlayTheme>(field: F, value: OverlayTheme[F]) =>
    setTheme((current) => ({ ...current, [field]: value }))
  return (
    <div className="overlay-style">
      {editable ? <ThemeFields theme={theme} set={set} /> : null}
      <OverlayPreview theme={theme} />
      {hasLowContrast(theme) ? (
        <p className="field-error">{t("overlayStyle.lowContrast")}</p>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() =>
            void run(
              () => save(theme),
              (outcome) => (outcome === "saved" ? "overlayStyle.saved" : "overlayStyle.rejected"),
            )
          }
        >
          {t("overlayStyle.save")}
        </button>
        {editable ? (
          <button
            type="button"
            className="button outlined"
            disabled={busy}
            onClick={() => setTheme(defaultOverlayTheme)}
          >
            {t("overlayStyle.reset")}
          </button>
        ) : null}
      </div>
      <p className="help" aria-live="polite">
        {message === null ? null : t(message)}
      </p>
    </div>
  )
}

function ThemeFields({
  theme,
  set,
}: {
  readonly theme: OverlayTheme
  readonly set: <F extends keyof OverlayTheme>(field: F, value: OverlayTheme[F]) => void
}) {
  const { t } = useI18n()
  const switchOptions: readonly SegmentOption<"off" | "on">[] = [
    { value: "off", label: t("overlayStyle.off"), icon: null, description: "" },
    { value: "on", label: t("overlayStyle.on"), icon: null, description: "" },
  ]
  return (
    <>
      <div className="overlay-style-colors">
        {(["accent", "background", "text"] as const).map((field) => (
          <ColorField
            key={field}
            label={t(`overlayStyle.${field}`)}
            value={theme[field]}
            onChange={(value) => set(field, value)}
          />
        ))}
      </div>
      <Segmented
        name="overlay-font"
        legend={t("overlayStyle.font")}
        help={null}
        options={overlayFonts.map((value) => ({
          value,
          label: overlayFontFamilies[value],
          icon: null,
          description: "",
        }))}
        value={theme.font}
        onSelect={(value) => set("font", value)}
      />
      <Segmented
        name="overlay-size"
        legend={t("overlayStyle.size")}
        help={null}
        options={overlaySizes.map((value) => ({
          value,
          label: t(`overlayStyle.size.${value}`),
          icon: null,
          description: "",
        }))}
        value={theme.size}
        onSelect={(value) => set("size", value)}
      />
      <Segmented
        name="overlay-position"
        legend={t("overlayStyle.position")}
        help={null}
        options={overlayPositions.map((value) => ({
          value,
          label: t(`overlayStyle.position.${value}`),
          icon: null,
          description: "",
        }))}
        value={theme.position}
        onSelect={(value) => set("position", value)}
      />
      <Segmented
        name="overlay-corners"
        legend={t("overlayStyle.corners")}
        help={null}
        options={overlayCorners.map((value) => ({
          value,
          label: t(`overlayStyle.corners.${value}`),
          icon: null,
          description: "",
        }))}
        value={theme.corners}
        onSelect={(value) => set("corners", value)}
      />
      <Segmented
        name="overlay-sound"
        legend={t("overlayStyle.sound")}
        help={t("overlayStyle.sound.help")}
        options={switchOptions}
        value={theme.sound ? "on" : "off"}
        onSelect={(choice) => set("sound", choice === "on")}
      />
      <Segmented
        name="overlay-confetti"
        legend={t("overlayStyle.confetti")}
        help={t("overlayStyle.confetti.help")}
        options={switchOptions}
        value={theme.confetti ? "on" : "off"}
        onSelect={(choice) => set("confetti", choice === "on")}
      />
    </>
  )
}

/** A color input: the browser's picker hands back `#rrggbb` in lowercase, the form the server accepts. */
function ColorField({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
