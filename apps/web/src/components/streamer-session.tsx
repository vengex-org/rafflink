import type { SessionJson } from "@rafflink/core/http/json"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { getSession, logout, sessionLost } from "../api/client.ts"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"

export type SignedInStreamer = NonNullable<SessionJson["streamer"]>

/** Who is signed in, as every page under the streamer layout and its header see it. */
export interface StreamerSession {
  /** Null while the session is unknown, when nobody is signed in and after logging out. */
  readonly streamer: SignedInStreamer | null
  readonly busy: boolean
  readonly message: MessageKey | null
  readonly signOut: () => void
}

const unknownSession: StreamerSession = {
  streamer: null,
  busy: false,
  message: null,
  signOut: () => {},
}

const sessionContext = createContext<StreamerSession>(unknownSession)

export const useStreamerSession = () => useContext(sessionContext)

/** Asks the server who the streamer is once for the whole page, so the header and the page body share one answer. */
export function StreamerSessionProvider({ children }: { readonly children: ReactNode }) {
  const { result, reload } = useLoad(getSession)
  const { message, busy, run } = useAction()
  const navigate = useNavigate()
  const [loggedOut, setLoggedOut] = useState(false)
  const streamer = result.state === "ready" && !loggedOut ? result.value.streamer : null

  // A signed-out header has nothing to correct, and a call still in flight already asks the server.
  const signedIn = streamer !== null
  useEffect(() => {
    if (!signedIn) return
    window.addEventListener(sessionLost, reload)
    return () => window.removeEventListener(sessionLost, reload)
  }, [signedIn, reload])

  async function signOut() {
    const outcome = await run(logout, () => "nav.loggedOut")
    if (outcome === "failed") return
    setLoggedOut(true)
    navigate("/")
  }

  return (
    <sessionContext.Provider value={{ streamer, busy, message, signOut: () => void signOut() }}>
      {children}
    </sessionContext.Provider>
  )
}
