import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { AppRoutes } from "./app.tsx"
import { loadDictionary } from "./i18n/dictionaries.ts"
import { initialLanguage } from "./i18n/language.ts"
import { startErrorReporting } from "./lib/error-reporting.ts"

startErrorReporting()
const root = document.getElementById("root")
if (root === null) throw new Error("index.html has no #root")
// The first render shows the wanted language instead of English for a moment; a failed load renders in English.
await loadDictionary(initialLanguage()).catch((error: unknown) => {
  console.error("dictionary failed to load", { error })
})
createRoot(root).render(
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>,
)
