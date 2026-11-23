import type { ReactNode } from "react"
import type { Language } from "../i18n/language.ts"

const width = 30
const height = 20

/** Equal bands, top to bottom (`rows`) or left to right (`columns`). */
function bands(direction: "rows" | "columns", colors: readonly string[]) {
  return colors.map((color, index) =>
    direction === "rows" ? (
      <rect
        key={color}
        y={(index * height) / colors.length}
        width={width}
        height={height / colors.length}
        fill={color}
      />
    ) : (
      <rect
        key={color}
        x={(index * width) / colors.length}
        width={width / colors.length}
        height={height}
        fill={color}
      />
    ),
  )
}

// Simplified so each still reads at 20px: no coats of arms except Slovakia's (without it the flag is Russia's).
const shapes = {
  // Union Jack; English has no single country, and the UK flag is the one most read as "English".
  en: (
    <>
      <rect width={width} height={height} fill="#012169" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.4" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" />
    </>
  ),
  sk: (
    <>
      {bands("rows", ["#fff", "#0b4ea2", "#ee1c25"])}
      <path
        d="M6.5 4h8v6.5c0 3-2 4.6-4 5.5c-2-.9-4-2.5-4-5.5z"
        fill="#ee1c25"
        stroke="#fff"
        strokeWidth=".7"
      />
      <path d="M10.5 6v7.5M8.7 7.6h3.6M8.1 9.9h4.8" stroke="#fff" strokeWidth=".9" />
      <path
        d="M7.3 13c1-.9 2.2-.9 3.2 0c1-.9 2.2-.9 3.2 0c-.6 1.3-1.8 2.2-3.2 2.8c-1.4-.6-2.6-1.5-3.2-2.8z"
        fill="#0b4ea2"
      />
    </>
  ),
  cs: (
    <>
      {bands("rows", ["#fff", "#d7141a"])}
      <path d="M0 0l15 10L0 20z" fill="#11457e" />
    </>
  ),
  de: bands("rows", ["#000", "#dd0000", "#ffce00"]),
  es: (
    <>
      <rect width={width} height={height} fill="#aa151b" />
      <rect y="5" width={width} height="10" fill="#f1bf00" />
    </>
  ),
  fr: bands("columns", ["#002654", "#fff", "#ce1126"]),
  it: bands("columns", ["#009246", "#fff", "#ce2b37"]),
  pl: bands("rows", ["#fff", "#dc143c"]),
  // Brazil's: the Portuguese dictionary is Brazilian ("você", "usuário", "arquivo").
  pt: (
    <>
      <rect width={width} height={height} fill="#009c3b" />
      <path d="M3 10l12-7.5L27 10l-12 7.5z" fill="#ffdf00" />
      <circle cx="15" cy="10" r="4.6" fill="#002776" />
    </>
  ),
} as const satisfies Readonly<Record<Language, ReactNode>>

/** A small flag for a language, drawn inline: Windows shows flag emoji as two letters. Decorative; the language's name sits next to it. */
export function Flag({ language }: { readonly language: Language }) {
  return (
    <svg className="flag" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {shapes[language]}
    </svg>
  )
}
