import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const src = join(import.meta.dir, "../src")
const stylesDir = join(src, "styles")
const fonts = join(import.meta.dir, "../public/fonts")

interface Sheet {
  readonly name: string
  readonly text: string
}

const tokens = sheet(join(stylesDir, "tokens.css"))
const others = cssFiles(stylesDir)
  .map(sheet)
  .filter(({ name }) => name !== tokens.name)
const index = sheet(join(src, "styles.css"))
const everySheet = [index, tokens, ...others]

const requiredTokens = [
  "--bg",
  "--surface",
  "--surface-2",
  "--ink",
  "--ink-2",
  "--muted",
  "--line",
  "--accent",
  "--accent-ink",
  "--success",
  "--warning",
  "--danger",
  "--focus",
  "--r-sm",
  "--r",
  "--r-lg",
  "--shadow",
]

const pages = ["home", "dashboard", "create", "giveaway", "live", "overlay", "admin"]

const namedColors = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/),
)

describe("stylesheet", () => {
  it("imports the token, base, component and page sheets in one layer order", () => {
    expect(index.text).toContain("@layer tokens, base, components, pages;")
    const imported = [...index.text.matchAll(/@import "\.\/styles\/([^"]+)" layer\((\w+)\)/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    )
    expect(imported.toSorted()).toEqual(
      [
        "tokens.css:tokens",
        "base.css:base",
        "components.css:components",
        ...pages.map((page) => `pages/${page}.css:pages`),
      ].toSorted(),
    )
  })

  it("defines the direction B tokens for light and dark", () => {
    const light = declaredIn(rootBlock(tokens.text, ":root"))
    const dark = declaredIn(rootBlock(tokens.text, ':root[data-theme="dark"]'))
    for (const name of requiredTokens) expect(light).toContain(name)
    for (const name of ["--bg", "--surface", "--ink", "--line", "--danger", "--focus"]) {
      expect(dark).toContain(name)
    }
  })

  it("keeps color literals in tokens.css only", () => {
    for (const { name, text } of [index, ...others]) {
      expect([name, colorLiteralsIn(text)]).toEqual([name, []])
    }
    expect(colorLiteralsIn(tokens.text).length).toBeGreaterThan(0)
  })

  it("only uses custom properties that tokens.css defines", () => {
    const defined = new Set(declaredIn(tokens.text))
    for (const { name, text } of everySheet) {
      const used = [...text.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])
      const undefinedNames = used.filter((variable) => !defined.has(variable ?? ""))
      expect([name, undefinedNames]).toEqual([name, []])
    }
    expect(others.flatMap(({ text }) => [...text.matchAll(/var\(--/g)]).length).toBeGreaterThan(0)
  })

  it("switches off animation and transition under reduced motion", () => {
    const blocks = everySheet.flatMap(({ text }) =>
      blocksOf(text, "@media (prefers-reduced-motion: reduce)"),
    )
    expect(blocks.length).toBeGreaterThan(0)
    const reduced = blocks.join("\n")
    expect(reduced).toMatch(/animation:\s*none\s*!important/)
    expect(reduced).toMatch(/transition:\s*none\s*!important/)
  })

  it("moves with the 180ms ease and the 640ms reveal of the design", () => {
    expect(tokens.text).toMatch(/--ease:\s*cubic-bezier\(0?\.16,\s*1,\s*0?\.3,\s*1\)/)
    expect(tokens.text).toMatch(/--dur:\s*180ms/)
    expect(tokens.text).toMatch(/--dur-reveal:\s*640ms/)
  })

  it("loads Geist and Geist Mono from files that exist, swapping in the text first", () => {
    const faces = everySheet.flatMap(({ text }) => blocksOf(text, "@font-face"))
    expect(faces).toHaveLength(2)
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/)
      const urls = [...face.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((match) => match[1] ?? "")
      expect(urls).toHaveLength(1)
      for (const file of urls) expect(existsSync(join(fonts, file))).toBe(true)
    }
    expect(faces.join("\n")).toContain('font-family: "Geist"')
    expect(faces.join("\n")).toContain('font-family: "Geist Mono"')
  })

  it("gives the app bar the width of the live page and lets the winner status wrap in the list", () => {
    const live = others.find(({ name }) => name === "styles/pages/live.css")?.text ?? ""
    const wide = rootBlock(live, "main.container:has(> .live-page)").match(/max-width:\s*([^;]+);/)
    expect(wide?.[1]).toBeDefined()
    const bar = rootBlock(live, ".layout:has(> main.container > .live-page) .app-bar-inner")
    expect(bar).toContain(`max-width: ${wide?.[1]}`)
    const components = others.find(({ name }) => name === "styles/components.css")?.text ?? ""
    expect(rootBlock(components, ".entrants-cell > .entrants-claim")).toMatch(
      /white-space:\s*normal/,
    )
  })
})

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? cssFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

function sheet(file: string): Sheet {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  return { name: relative(src, file).replaceAll("\\", "/"), text }
}

function declaredIn(text: string): string[] {
  return [...text.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? "")
}

/** The body of the first rule whose selector is exactly `selector`. */
function rootBlock(text: string, selector: string): string {
  const start = text.indexOf(`${selector} {`)
  if (start < 0) return ""
  return balanced(text, text.indexOf("{", start))
}

/** The bodies of every block that opens with `prelude`, at any depth. */
function blocksOf(text: string, prelude: string): string[] {
  const found: string[] = []
  let from = 0
  for (;;) {
    const start = text.indexOf(prelude, from)
    if (start < 0) return found
    const open = text.indexOf("{", start)
    found.push(balanced(text, open))
    from = open + 1
  }
}

function balanced(text: string, open: number): string {
  let depth = 0
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1
    if (text[at] === "}") depth -= 1
    if (depth === 0) return text.slice(open + 1, at)
  }
  return text.slice(open + 1)
}

/** Hex codes, color functions and named colors in declaration values; `var()` and `url()` arguments are not values. */
function colorLiteralsIn(text: string): string[] {
  const found: string[] = []
  for (const declaration of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?=;|})/g)) {
    const value = (declaration[2] ?? "")
      .replace(/url\([^)]*\)/g, "")
      .replace(/var\(--[\w-]+/g, "var(")
      .replace(/"[^"]*"/g, "")
    for (const hex of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) found.push(hex[0])
    for (const fn of value.matchAll(
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/g,
    )) {
      found.push(fn[0])
    }
    for (const word of value.matchAll(/(?<![\w-])[a-z]+(?![\w(-])/g)) {
      if (namedColors.has(word[0])) found.push(word[0])
    }
  }
  return found
}
