import { Resvg } from "@resvg/resvg-js"
import { giftPath } from "../src/components/icons.tsx"

// Rerun with `bun run icons` after changing the glyph or the colors, and commit the files in public/.
const publicDir = new URL("../public/", import.meta.url)

// The light theme's `--primary` and `--on-primary` of src/styles.css: white on it has a 7:1 contrast.
const background = "#6750a4"
const glyph = "#ffffff"

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

/**
 * The gift glyph centered on the accent color. A maskable icon fills the whole square, because the
 * launcher cuts its own shape, and keeps the glyph inside the central 80% circle every mask leaves.
 */
function iconSvg(maskable: boolean): string {
  const corner = maskable ? 0 : 14
  const scale = maskable ? 1.4 : 1.7
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${corner}" fill="${background}" />
  <g transform="translate(32 32) scale(${scale}) translate(-12 -12)" fill="none" stroke="${glyph}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="${giftPath}" />
  </g>
</svg>
`
}
