// A deployment's site module, which the seam plugin of `site-seam.ts` puts in place of `src/site/site.tsx`.
import { languages } from "@rafflink/core/lib/languages"
import { segmentPath } from "@rafflink/core/lib/page-paths"
import { Route } from "react-router"
import type { SitePage } from "../../src/site/site-page.ts"

export const siteRoutes = (
  <>
    {languages.map((language) => (
      <Route
        key={language}
        path={segmentPath(language, "compare")}
        element={<h1>Compare in {language}</h1>}
      />
    ))}
  </>
)

export const prerenderPages: readonly SitePage[] = [
  {
    segment: "compare",
    meta: (language) => ({ title: `Compare ${language}`, description: "How tools compare" }),
  },
]

export function HomePage() {
  return <h1>Hosted home</h1>
}

export function SiteNav() {
  return null
}
