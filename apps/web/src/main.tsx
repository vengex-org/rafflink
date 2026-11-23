import { createRoot, hydrateRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { AppRoutes } from "./app.tsx"
import { SitePresence } from "./components/site-presence.tsx"
import { loadDictionary } from "./i18n/dictionaries.ts"
import { addressLanguage, openingLanguage } from "./i18n/language.ts"
import { startErrorReporting } from "./lib/error-reporting.ts"

startErrorReporting()
const root = document.getElementById("root")
if (root === null) throw new Error("index.html has no #root")
// The first render shows the wanted language instead of English for a moment; a failed load renders in English.
await loadDictionary(openingLanguage(addressLanguage(location.pathname))).catch(
  (error: unknown) => {
    console.error("dictionary failed to load", { error })
  },
)
const app = (
  <BrowserRouter>
    <SitePresence />
    <AppRoutes />
  </BrowserRouter>
)
// A prerendered page arrives with its markup in #root, which React takes over; the app's shell arrives empty.
if (root.firstElementChild === null) createRoot(root).render(app)
else hydrateRoot(root, app)
