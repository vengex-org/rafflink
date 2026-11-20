import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { AppRoutes } from "./app.tsx"
import { entryPoll } from "./lib/poll-timing.ts"

const root = document.getElementById("root")
if (root === null) throw new Error("index.html has no #root")
createRoot(root).render(
  <BrowserRouter>
    <AppRoutes poll={entryPoll} />
  </BrowserRouter>,
)
