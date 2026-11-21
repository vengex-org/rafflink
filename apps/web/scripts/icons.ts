import { Resvg } from "@resvg/resvg-js"
import { create, type Font } from "fontkit"
import { decompress } from "wawoff2"

// Rerun with `bun run icons` after changing the brand mark or its tokens, and commit the files in public/.
const publicDir = new URL("../public/", import.meta.url)

const tokens = await Bun.file(new URL("../src/styles/tokens.css", import.meta.url)).text()
const background = readToken(tokens, "--accent")
const glyph = readToken(tokens, "--accent-ink")
const page = { background: readToken(tokens, "--bg"), ink: readToken(tokens, "--ink") }
const tagline = { text: "Giveaways for Twitch streamers", color: readToken(tokens, "--ink-2") }
const font = await geist()
const letter = outline("R", 800, 0)

const png = [
  { file: "favicon-32.png", size: 32, maskable: false },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
] as const
// Google asks for a favicon in a multiple of 48px; the browser tab uses 16 and 32.
const icoSizes = [16, 32, 48] as const

await Bun.write(new URL("favicon.svg", publicDir), iconSvg(false))
for (const { file, size, maskable } of png) {
  await Bun.write(new URL(file, publicDir), render(iconSvg(maskable), size))
}
await Bun.write(
  new URL("favicon.ico", publicDir),
  ico(icoSizes.map((size) => ({ size, image: render(iconSvg(false), size) }))),
)
await Bun.write(new URL("og.png", publicDir), render(ogSvg(), 1200))
console.info("icons written", { count: png.length + 3 })

/** A custom property of the first `:root` block of tokens.css, the light theme; it must be a hex color. */
function readToken(css: string, name: string): string {
  const root = css.match(/:root\s*\{([^}]*)\}/)?.[1]
  if (root === undefined) throw new Error("tokens.css has no :root block")
  const value = root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim()
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${name} in the light :root of tokens.css is not a hex color`)
  }
  return value
}

/** Geist, the font of `.brand`; the icons draw its glyphs as outlines because SVG favicons cannot rely on installed fonts. */
async function geist(): Promise<Font> {
  const file = new URL("../public/fonts/geist-1.9.2.woff2", import.meta.url)
  // fontkit reads variable axes only from a TrueType font, not from the woff2 container.
  const loaded = create(
    Buffer.from(await decompress(Buffer.from(await Bun.file(file).arrayBuffer()))),
  )
  if (!("getVariation" in loaded)) throw new Error("geist-1.9.2.woff2 is not a variable font")
  return loaded
}

/**
 * `text` set in Geist at `weight` as one SVG path in font units, y up from the baseline, with its ink
 * bounds and its advance. `tracking` is the CSS `letter-spacing` in em.
 */
function outline(text: string, weight: number, tracking: number) {
  const { glyphs, positions } = font.getVariation({ wght: weight }).layout(text)
  let advance = 0
  const paths = glyphs.map((shape, index) => {
    const path = shape.path.translate(advance, 0)
    advance += (positions[index]?.xAdvance ?? 0) + tracking * font.unitsPerEm
    return path
  })
  const boxes = paths.map((path) => path.bbox)
  const minX = Math.min(...boxes.map((box) => box.minX))
  const maxX = Math.max(...boxes.map((box) => box.maxX))
  const minY = Math.min(...boxes.map((box) => box.minY))
  const maxY = Math.max(...boxes.map((box) => box.maxY))
  return {
    d: paths.map((path) => path.toSVG()).join(""),
    advance,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    height: maxY - minY,
  }
}

function render(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng()
}

/**
 * The `.brand-mark` of the layout on the 64 unit canvas, so its 32px box, 8px radius and 4.5px notches
 * double. The notches are cut out of the shape and show the page behind. A maskable icon fills the whole
 * square, because the launcher cuts its own shape, and keeps the letter inside the central 80% circle.
 */
function markPaths(maskable: boolean): string {
  const radius = 16
  const notch = 9
  const shape = maskable
    ? "M0 0H64V64H0Z"
    : `M${radius} 0H${64 - radius}A${radius} ${radius} 0 0 1 64 ${radius}V${32 - notch}A${notch} ${notch} 0 0 0 64 ${32 + notch}V${64 - radius}A${radius} ${radius} 0 0 1 ${64 - radius} 64H${radius}A${radius} ${radius} 0 0 1 0 ${64 - radius}V${32 + notch}A${notch} ${notch} 0 0 0 0 ${32 - notch}V${radius}A${radius} ${radius} 0 0 1 ${radius} 0Z`
  const scale = 22.5 / letter.height
  return `<path d="${shape}" fill="${background}" />
  <path transform="translate(32 32) scale(${scale} ${-scale}) translate(${-letter.centerX} ${-letter.centerY})" d="${letter.d}" fill="${glyph}" />`
}

function iconSvg(maskable: boolean): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${markPaths(maskable)}
</svg>
`
}

/**
 * The 1200x630 link preview: the `.brand` of the layout (mark, 0.625rem gap, "Rafflink" at 1.1875rem
 * next to a 2rem mark) at five times its size, centered, with the tagline below.
 */
function ogSvg(): string {
  const width = 1200
  const height = 630
  const mark = 160
  const gap = 50
  const name = { ...outline("Rafflink", 700, -0.02), size: 95 }
  const line = { ...outline(tagline.text, 500, 0), size: 44 }
  const nameScale = name.size / font.unitsPerEm
  const lineScale = line.size / font.unitsPerEm
  const rowLeft = (width - (mark + gap + name.advance * nameScale)) / 2
  const rowCenter = 260
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${page.background}" />
  <g transform="translate(${rowLeft} ${rowCenter - mark / 2}) scale(${mark / 64})">
  ${markPaths(false)}
  </g>
  <path transform="translate(${rowLeft + mark + gap} ${rowCenter}) scale(${nameScale} ${-nameScale}) translate(0 ${-name.centerY})" d="${name.d}" fill="${page.ink}" />
  <path transform="translate(${width / 2} ${rowCenter + mark / 2 + 110}) scale(${lineScale} ${-lineScale}) translate(${-line.centerX} 0)" d="${line.d}" fill="${tagline.color}" />
</svg>
`
}

/** An ICO file holding each PNG as one image; every current browser and crawler reads PNG entries. */
function ico(images: readonly { size: number; image: Buffer }[]): Uint8Array {
  const headerBytes = 6
  const entryBytes = 16
  let offset = headerBytes + entryBytes * images.length
  const file = new Uint8Array(offset + images.reduce((sum, { image }) => sum + image.length, 0))
  const view = new DataView(file.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  for (const [index, { size, image }] of images.entries()) {
    const entry = headerBytes + entryBytes * index
    view.setUint8(entry, size)
    view.setUint8(entry + 1, size)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, image.length, true)
    view.setUint32(entry + 12, offset, true)
    file.set(image, offset)
    offset += image.length
  }
  return file
}
