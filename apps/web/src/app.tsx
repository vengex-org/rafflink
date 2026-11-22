import { useEffect, useEffectEvent, type ReactNode } from "react"
import { Navigate, Route, Routes, useLocation, useParams } from "react-router"
import { Layout } from "./components/layout.tsx"
import { NotFound } from "./components/notice.tsx"
import { I18nProvider, useI18n } from "./i18n/i18n.tsx"
import { parseLanguage } from "./i18n/language.ts"
import { AdminPage } from "./pages/admin-page.tsx"
import { CreatedGiveawayPage, NewGiveawayPage } from "./pages/create-page.tsx"
import { DashboardPage } from "./pages/dashboard-page.tsx"
import { DrawPage } from "./pages/draw-page.tsx"
import { GiveawayPage } from "./pages/giveaway-page.tsx"
import { PrivacyPage, TermsPage } from "./pages/legal-page.tsx"
import { LivePage } from "./pages/live-page.tsx"
import { ModeratorLivePage, ModeratorOpenPage } from "./pages/moderator-page.tsx"
import { OverlayPage } from "./pages/overlay-page.tsx"
import { VerifyLookupPage } from "./pages/verify-lookup-page.tsx"
import { VerifyPage } from "./pages/verify-page.tsx"
import { parseGiveawayCode } from "./lib/giveaway-code.ts"
import { giveawayPath, staticSegments, staticSubSegments, verifyPath } from "./lib/routes.ts"
import { useConsumedParam } from "./lib/use-consumed-param.ts"
import { HomePage, siteRoutes } from "./site/site.tsx"

export function AppRoutes() {
  return (
    <I18nProvider>
      <LinkedLanguage />
      <CanonicalPath>
        <Routes>
          <Route path="overlay/:id/:token" caseSensitive element={<OverlayPage />} />
          <Route path="live/:id" caseSensitive element={<LivePage />} />
          <Route path="mod/:id" caseSensitive element={<ModeratorLivePage />} />
          <Route element={<Layout account />}>
            <Route path="dashboard" caseSensitive element={<DashboardPage />} />
            <Route path="dashboard/new" caseSensitive element={<NewGiveawayPage />} />
            <Route path="dashboard/created/:id" caseSensitive element={<CreatedGiveawayPage />} />
            <Route path="admin" caseSensitive element={<AdminPage />} />
            <Route path="privacy" caseSensitive element={<PrivacyPage />} />
            <Route path="terms" caseSensitive element={<TermsPage />} />
            <Route path="verify" caseSensitive element={<VerifyLookupPage />} />
            <Route index element={<HomePage />} />
            <Route path="*" element={<NotFound title="notFound.page" />} />
          </Route>
          {/* The list draw makes no request but the drand round, and a moderator link's opener needs no streamer header, so both skip the session lookup. */}
          <Route element={<Layout account={false} />}>
            <Route path="draw" caseSensitive element={<DrawPage />} />
            <Route path="mod" caseSensitive element={<ModeratorOpenPage />} />
          </Route>
          {siteRoutes}
          <Route element={<Layout account={false} />}>
            <Route path="g/:code" element={<MovedGiveaway page="giveaway" />} />
            <Route path="g/:code/verify" element={<MovedGiveaway page="verify" />} />
            <Route path=":code" element={<GiveawayPage />} />
            <Route path=":code/verify" element={<VerifyPage />} />
          </Route>
        </Routes>
      </CanonicalPath>
    </I18nProvider>
  )
}

/** A `?lang=` in the address, such as a link in a chat, picks the language once and is stored like a choice made in the menu. */
function LinkedLanguage() {
  const { setLanguage } = useI18n()
  const consumed = useConsumedParam("lang")
  const apply = useEffectEvent((param: typeof consumed) => {
    const linked = parseLanguage(param?.value ?? null)
    if (linked !== null) setLanguage(linked)
  })
  useEffect(() => apply(consumed), [consumed])
  return null
}

/**
 * The router matches `/privacy/` like `/privacy`, and the static routes are case sensitive; the address bar gets
 * the one spelling: no trailing slash, and the fixed words of a path in lowercase while its ids stay as they are.
 * A first segment that is a giveaway code stays, so `/TERMS` is a giveaway; the code redirect of
 * {@link GiveawayCode} handles the other cases.
 */
function CanonicalPath({ children }: { readonly children: ReactNode }) {
  const { pathname, search, hash } = useLocation()
  const segments = pathname.replace(/\/+$/, "").split("/")
  const first = segments[1]
  if (
    first !== undefined
    && staticSegments.includes(first.toLowerCase())
    && parseGiveawayCode(first) !== first
  ) {
    segments[1] = first.toLowerCase()
  }
  // After `/g/<code>` the fixed word is the fourth segment, otherwise the third.
  const wordAt = segments[1] === "g" ? 3 : 2
  const word = segments[wordAt]
  if (word !== undefined && staticSubSegments.includes(word.toLowerCase())) {
    segments[wordAt] = word.toLowerCase()
  }
  const canonical = segments.join("/")
  // Nothing else renders while it redirects, so a route cannot redirect the same address elsewhere.
  return canonical === "" || canonical === pathname ? (
    children
  ) : (
    <Navigate replace to={{ pathname: canonical, search, hash }} />
  )
}

/** Where giveaway links pointed before `/<code>`; kept so links already shared still open. */
function MovedGiveaway({ page }: { readonly page: "giveaway" | "verify" }) {
  const { code = "" } = useParams()
  const { search, hash } = useLocation()
  const pathname =
    page === "verify" ? verifyPath(code.toUpperCase()) : giveawayPath(code.toUpperCase())
  return <Navigate replace to={{ pathname, search, hash }} />
}
