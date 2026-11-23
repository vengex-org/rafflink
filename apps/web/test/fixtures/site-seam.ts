// A deployment's seam plugin as `bun --preload` registers it for `finish-build.ts`: the app imports the fixture
// site module wherever it imports `site/site.tsx`.
import { fileURLToPath } from "node:url"

const fixtureSite = fileURLToPath(new URL("./site.tsx", import.meta.url))

Bun.plugin({
  name: "fixture-site-seam",
  setup(build) {
    build.onResolve({ filter: /[/\\]site[/\\]site\.tsx$/ }, () => ({ path: fixtureSite }))
  },
})
