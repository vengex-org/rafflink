import { Route, Routes } from "react-router"
import { Layout } from "./components/layout.tsx"
import { NotFound } from "./components/notice.tsx"
import { I18nProvider } from "./i18n/i18n.tsx"
import { AdminPage } from "./pages/admin-page.tsx"
import { DashboardPage } from "./pages/dashboard-page.tsx"
import { DemoPage } from "./pages/demo-page.tsx"
import { GiveawayPage } from "./pages/giveaway-page.tsx"
import { HomePage } from "./pages/home-page.tsx"
import { PrivacyPage, TermsPage } from "./pages/legal-page.tsx"
import { LivePage } from "./pages/live-page.tsx"
import { OverlayPage } from "./pages/overlay-page.tsx"

export function AppRoutes() {
  return (
    <I18nProvider>
      <Routes>
        <Route path="/overlay/:id/:token" element={<OverlayPage />} />
        <Route path="live/:id" element={<LivePage />} />
        <Route element={<Layout account />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route index element={<HomePage />} />
          <Route path="*" element={<NotFound title="notFound.page" />} />
        </Route>
        <Route element={<Layout account={false} />}>
          <Route path="demo" element={<DemoPage />} />
          <Route path="privacy" caseSensitive element={<PrivacyPage />} />
          <Route path="terms" caseSensitive element={<TermsPage />} />
          <Route path="g/:code" element={<GiveawayPage />} />
          <Route path=":code" element={<GiveawayPage />} />
        </Route>
      </Routes>
    </I18nProvider>
  )
}
