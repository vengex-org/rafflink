import { createContext, useContext } from "react"
import {
  closeEntries,
  createModeratorLink,
  drawWinners,
  getBadges,
  getEntrants,
  getModeratorBadges,
  getModeratorEntrants,
  listModeratorLinks,
  markClaimed,
  moderatorActions,
  revokeModeratorLink,
  rerollWinner,
  setWinnerCount,
} from "../api/client.ts"

/** The requests the live page sends: its buttons, its lists, and the settings only the streamer has. */
export interface LiveApi {
  readonly closeEntries: typeof closeEntries
  readonly drawWinners: typeof drawWinners
  readonly markClaimed: typeof markClaimed
  readonly rerollWinner: typeof rerollWinner
  readonly getEntrants: typeof getEntrants
  readonly getBadges: typeof getBadges
  /** Null where the page may not change the planned winner count. */
  readonly setWinnerCount: typeof setWinnerCount | null
  /** Null where the page may not hand out moderator links. */
  readonly moderatorLinks: ModeratorLinksApi | null
}

export interface ModeratorLinksApi {
  readonly list: typeof listModeratorLinks
  readonly create: typeof createModeratorLink
  readonly revoke: typeof revokeModeratorLink
}

/** The streamer's own live page. */
export const clientLiveApi: LiveApi = {
  closeEntries,
  drawWinners,
  markClaimed,
  rerollWinner,
  getEntrants,
  getBadges,
  setWinnerCount,
  moderatorLinks: {
    list: listModeratorLinks,
    create: createModeratorLink,
    revoke: revokeModeratorLink,
  },
}

/** A moderator link's page: the same buttons and lists under the link's routes, and none of the streamer's settings. */
export const moderatorLiveApi: LiveApi = {
  ...moderatorActions,
  getEntrants: getModeratorEntrants,
  getBadges: getModeratorBadges,
  setWinnerCount: null,
  moderatorLinks: null,
}

const liveApi = createContext<LiveApi>(clientLiveApi)

/** A hosted demo (site seam) supplies its own, so the live buttons act on a simulated giveaway; a moderator link's page supplies {@link moderatorLiveApi}. */
export const LiveApiProvider = liveApi.Provider

export const useLiveApi = () => useContext(liveApi)
