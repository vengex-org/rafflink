import { Route, Routes } from "react-router"
import { Layout } from "./components/layout.tsx"
import { NotFound } from "./components/notice.tsx"
import { AdminPage } from "./pages/admin-page.tsx"
import { DashboardPage } from "./pages/dashboard-page.tsx"
import { GiveawayPage } from "./pages/giveaway-page.tsx"
import { HomePage } from "./pages/home-page.tsx"
import { LivePage } from "./pages/live-page.tsx"
import { OverlayPage } from "./pages/overlay-page.tsx"

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/overlay/:id/:token" element={<OverlayPage />} />
      <Route element={<Layout width="wide" />}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="live/:id" element={<LivePage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route element={<Layout width="narrow" />}>
        <Route index element={<HomePage />} />
        <Route path="g/:code" element={<GiveawayPage />} />
        <Route path=":code" element={<GiveawayPage />} />
        <Route path="*" element={<NotFound title="Page not found" />} />
      </Route>
    </Routes>
  )
}
