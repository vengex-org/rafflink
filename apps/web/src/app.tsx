import { isLanguage, sourceLanguage } from "@rafflink/core/lib/languages"
import { useEffect, useEffectEvent, type ReactNode } from "react"
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router"
import { ErrorBoundary } from "./components/error-boundary.tsx"
import { Layout } from "./components/layout.tsx"
import { Failed, NotFound } from "./components/notice.tsx"
import { I18nProvider } from "./i18n/i18n.tsx"
import { addressLanguage, languages, parseLanguage, storedLanguage } from "./i18n/language.ts"
import { useChooseLanguage } from "./i18n/localized-pages.ts"
import { AdminPage } from "./pages/admin-page.tsx"
import { CreatedGiveawayPage, NewGiveawayPage } from "./pages/create-page.tsx"
import { DashboardPage } from "./pages/dashboard-page.tsx"
import { DrawPage } from "./pages/draw-page.tsx"
import { GiveawayPage } from "./pages/giveaway-page.tsx"
import { HistoryPage } from "./pages/history-page.tsx"
import { PrivacyPage, TermsPage } from "./pages/legal-page.tsx"
import { LivePage } from "./pages/live-page.tsx"
import { ModeratorLivePage, ModeratorOpenPage } from "./pages/moderator-page.tsx"
import { OverlayPage } from "./pages/overlay-page.tsx"
import { VerifyLookupPage } from "./pages/verify-lookup-page.tsx"
import { VerifyPage } from "./pages/verify-page.tsx"
import { parseGiveawayCode } from "./lib/giveaway-code.ts"
import {
  giveawayPath,
  localizedPages,
  localizedPath,
  pageOfPath,
  staticSegments,
  staticSubSegments,
  verifyPath,
  type LocalizedPage,
} from "./lib/routes.ts"
import { useConsumedParam } from "./lib/use-consumed-param.ts"
import { HomePage, siteRoutes } from "./site/site.tsx"

export function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <I18nProvider addressLanguage={addressLanguage(pathname)}>
      <LinkedLanguage />
      <ErrorBoundary fallback={<Failed />}>
        <CanonicalPath>
          <Routes>
            {/* A broken overlay shows nothing on the stream rather than an error card. */}
            <Route
              path="overlay/:id/:token"
              caseSensitive
              element={
                <ErrorBoundary fallback={null}>
                  <OverlayPage />
                </ErrorBoundary>
              }
            />
            <Route path="live/:id" caseSensitive element={<LivePage />} />
            <Route path="mod/:id" caseSensitive element={<ModeratorLivePage />} />
            <Route element={<Layout account />}>
              <Route path="dashboard" caseSensitive element={<DashboardPage />} />
              <Route path="dashboard/new" caseSensitive element={<NewGiveawayPage />} />
              <Route path="dashboard/created/:id" caseSensitive element={<CreatedGiveawayPage />} />
              <Route path="admin" caseSensitive element={<AdminPage />} />
              {localizedRoutes}
              <Route path="verify" caseSensitive element={<VerifyLookupPage />} />
              <Route path="*" element={<NotFound title="notFound.page" />} />
            </Route>
            {/* The list draw makes no request but the drand round, and a moderator link's opener needs no streamer header, so both skip the session lookup. */}
            <Route element={<Layout account={false} />}>
              <Route path="draw" caseSensitive element={<DrawPage />} />
              <Route path="mod" caseSensitive element={<ModeratorOpenPage />} />
            </Route>
            {siteRoutes}
            <Route element={<Layout account={false} />}>
              <Route path="s/:platform/:login" element={<HistoryPage />} />
              <Route path="g/:code" element={<MovedGiveaway page="giveaway" />} />
              <Route path="g/:code/verify" element={<MovedGiveaway page="verify" />} />
              <Route path=":code" element={<GiveawayPage />} />
              <Route path=":code/verify" element={<VerifyPage />} />
            </Route>
          </Routes>
        </CanonicalPath>
      </ErrorBoundary>
      <ChosenLanguageHome />
    </I18nProvider>
  )
}

// The home page and the legal texts at their address in every language.
const localizedRoutes = localizedPages.flatMap((page) =>
  languages.map((language) => {
    const path = localizedPath(language, page)
    return <Route key={path} path={path} caseSensitive element={localizedPage(page)} />
  }),
)

function localizedPage(page: LocalizedPage): ReactNode {
  switch (page) {
    case "home":
      return <HomePage />
    case "privacy":
      return <PrivacyPage />
    case "terms":
      return <TermsPage />
  }
}

/**
 * `/` is the home page in English, as search engines and shared links know it. A person who chose another language
 * before gets the home page in it once the page has loaded; the browser's language alone moves nobody, and a
 * `?lang=` link picks the language itself. It renders after the routes, so its redirect follows the one-time
 * parameters the page removed from the address, and keeps them for the page it opens.
 */
function ChosenLanguageHome() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const redirect = useEffectEvent(() => {
    const opened = pageOfPath(pathname)
    if (opened?.page !== "home" || opened.language !== sourceLanguage) return
    if (new URLSearchParams(search).has("lang")) return
    const chosen = storedLanguage()
    if (chosen === null || chosen === sourceLanguage) return
    navigate({ pathname: localizedPath(chosen, "home"), search, hash }, { replace: true })
  })
  // Once, for the address the page opened at.
  useEffect(() => redirect(), [])
  return null
}

/** A `?lang=` in the address, such as a link in a chat, picks the language once and is stored like a choice made in the menu. */
function LinkedLanguage() {
  const choose = useChooseLanguage()
  const consumed = useConsumedParam("lang")
  const apply = useEffectEvent((param: typeof consumed) => {
    const linked = parseLanguage(param?.value ?? null)
    if (linked !== null) choose(linked)
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
  const canonical = canonicalPathOf(pathname)
  // Nothing else renders while it redirects, so a route cannot redirect the same address elsewhere.
  return canonical === pathname ? (
    children
  ) : (
    <Navigate replace to={{ pathname: canonical, search, hash }} />
  )
}

/** A localized page has the spelling of {@link localizedPath}: the home page of a language ends in a slash, as its prerendered folder is served. */
function canonicalPathOf(pathname: string): string {
  const segments = pathname.replace(/\/+$/, "").split("/")
  const first = segments[1]
  if (
    first !== undefined
    && staticSegments.includes(first.toLowerCase())
    && parseGiveawayCode(first) !== first
  ) {
    segments[1] = first.toLowerCase()
  }
  // After `/g/<code>` the fixed word is the fourth segment, otherwise the third; after a language, a page name.
  const wordAt = segments[1] === "g" ? 3 : 2
  const word = segments[wordAt]
  const words: readonly string[] = isLanguage(segments[1] ?? "")
    ? localizedPages
    : staticSubSegments
  if (word !== undefined && words.includes(word.toLowerCase())) {
    segments[wordAt] = word.toLowerCase()
  }
  const canonical = segments.join("/")
  const localized = pageOfPath(canonical)
  return localized === null ? canonical : localizedPath(localized.language, localized.page)
}

/** Where giveaway links pointed before `/<code>`; kept so links already shared still open. */
function MovedGiveaway({ page }: { readonly page: "giveaway" | "verify" }) {
  const { code = "" } = useParams()
  const { search, hash } = useLocation()
  const pathname =
    page === "verify" ? verifyPath(code.toUpperCase()) : giveawayPath(code.toUpperCase())
  return <Navigate replace to={{ pathname, search, hash }} />
}
