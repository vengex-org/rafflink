import type { BunPlugin } from "bun"

// The dev server bundles index.html at runtime and would resolve "/fonts/..." against the drive root;
// the fonts are plain files of public/ that the page loads from the server, as in the production build.
const externalFonts: BunPlugin = {
  name: "external-fonts",
  setup(build) {
    build.onResolve({ filter: /^\/fonts\// }, ({ path }) => ({ path, external: true }))
  },
}

export default externalFonts
