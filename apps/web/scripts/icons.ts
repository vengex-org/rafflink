import { Resvg } from "@resvg/resvg-js"
import { create } from "fontkit"
import { decompress } from "wawoff2"
import { decompress } from "wawoff2"

// Rerun with `bun run icons` after changing the brand mark or its tokens, and commit the files in public/.
const publicDir = new URL("../public/", import.meta.url)

const tokens = await Bun.file(new URL("../src/styles/tokens.css", import.meta.url)).text()
const background = readToken(tokens, "--accent")
const glyph = readToken(tokens, "--accent-ink")
const letter = await brandLetter()

const png = [
  { file: "favicon-32.png", size: 32, maskable: false },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
] as const

await Bun.write(new URL("favicon.svg", publicDir), iconSvg(false))
for (const { file, size, maskable } of png) {
  const rendered = new Resvg(iconSvg(maskable), { fitTo: { mode: "width", value: size } })
  await Bun.write(new URL(file, publicDir), rendered.render().asPng())
}
console.info("icons written", { count: png.length + 1 })

/** The first declaration of a custom property in tokens.css, which is the light `:root` block. */
function readToken(css: string, name: string): string {
  const value = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`))?.[1]
  if (value === undefined) throw new Error(`${name} is not a hex color in tokens.css`)
  return value
}

/** The "R" of `.brand-mark` (Geist 800) as an outline: favicon SVGs cannot rely on installed fonts. */
async function brandLetter() {
  const file = new URL("../public/fonts/geist-1.9.2.woff2", import.meta.url)
  // fontkit reads variable axes only from a TrueType font, not from the woff2 container.
  const font = create(
    Buffer.from(await decompress(Buffer.from(await Bun.file(file).arrayBuffer()))),
  )
  if (!("getVariation" in font)) throw new Error("geist-1.9.2.woff2 is not a variable font")
  // The cmap lookup of a variation instance throws, so the glyph id comes from the default instance.
  const { path } = font.getVariation({ wght: 800 }).getGlyph(font.glyphForCodePoint(0x52).id)
  const { minX, minY, maxX, maxY } = path.bbox
  return {
    d: path.toSVG(),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    height: maxY - minY,
  }
}

/**
 * The `.brand-mark` of the layout on the 64 unit canvas, so its 32px box, 8px radius and 4.5px notches
 * double. The notches are cut out of the shape and show the page behind. A maskable icon fills the whole
 * square, because the launcher cuts its own shape, and keeps the letter inside the central 80% circle.
 */
function iconSvg(maskable: boolean): string {
  const radius = 16
  const notch = 9
  const shape = maskable
    ? "M0 0H64V64H0Z"
    : `M${radius} 0H${64 - radius}A${radius} ${radius} 0 0 1 64 ${radius}V${32 - notch}A${notch} ${notch} 0 0 0 64 ${32 + notch}V${64 - radius}A${radius} ${radius} 0 0 1 ${64 - radius} 64H${radius}A${radius} ${radius} 0 0 1 0 ${64 - radius}V${32 + notch}A${notch} ${notch} 0 0 0 0 ${32 - notch}V${radius}A${radius} ${radius} 0 0 1 ${radius} 0Z`
  const scale = 22.5 / letter.height
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="${shape}" fill="${background}" />
  <path transform="translate(32 32) scale(${scale} ${-scale}) translate(${-letter.centerX} ${-letter.centerY})" d="${letter.d}" fill="${glyph}" />
</svg>
`
}
