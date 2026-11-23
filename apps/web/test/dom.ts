import { beforeEach } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { loadDictionary } from "../src/i18n/dictionaries.ts"
import { languages } from "../src/i18n/language.ts"

// Registered through bunfig.toml for `bun test` inside apps/web only: the other packages' tests keep Bun's own fetch and WebSocket.
GlobalRegistrator.register({ url: "http://rafflink.test/" })

// The giveaway page keeps its last answer in sessionStorage and the header whether a streamer signed in in
// localStorage; a test must not start from the one before it.
beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

// `main.tsx` loads the first language's dictionary before the first render; tests render any language at once.
await Promise.all(languages.map(loadDictionary))
