import { createContext, useContext } from "react"
import {
  closeEntries,
  drawWinners,
  markClaimed,
  rerollWinner,
  setWinnerCount,
} from "../api/client.ts"

/** The requests the streamer's live buttons send. */
export const clientLiveApi = {
  closeEntries,
  drawWinners,
  markClaimed,
  rerollWinner,
  setWinnerCount,
}

export type LiveApi = typeof clientLiveApi

const liveApi = createContext<LiveApi>(clientLiveApi)

/** The demo supplies its own, so the live buttons act on a simulated giveaway. */
export const LiveApiProvider = liveApi.Provider

export const useLiveApi = () => useContext(liveApi)
