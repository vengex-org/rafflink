export interface FakeYouTubeChannel {
  /** A channel id, `UC` and 22 more characters at YouTube. */
  id: string
  title: string
  /** The handle with its `@`, as `snippet.customUrl` gives it; null for a channel without one. */
  handle: string | null
}

export interface FakeYouTubeOptions {
  clientId: string
  clientSecret: string
  /** Signed in by `/o/oauth2/v2/auth` until `control.signInAs` picks another channel. */
  defaultChannel: FakeYouTubeChannel
}

export type FailableEndpoint =
  | "token"
  | "tokeninfo"
  | "channels"
  | "live-broadcasts"
  | "live-chat-messages"
export type FailureStatus = 400 | 401 | 403 | 404 | 429 | 500 | 503

/** A scripted failure: the status and the error reason the body names. */
export interface ScriptedFailure {
  status: FailureStatus
  reason: string
}

export interface Call {
  method: string
  path: string
  query: Record<string, string>
}

export interface AuthorizationCode {
  /** Null for a Google account that owns no channel. */
  channelId: string | null
  scopes: string[]
  redirectUri: string
  codeChallenge: string
  /** `access_type=offline` with `prompt=consent`: the token answer carries a refresh token. */
  offline: boolean
}

export interface AccessToken {
  channelId: string | null
  scopes: string[]
  revoked: boolean
}

export interface RefreshToken {
  channelId: string | null
  scopes: string[]
}

/** A message of a live chat as the fake keeps it. */
export interface ChatItem {
  /** Its position in the chat; a page token is the position the next page starts at. */
  position: number
  authorChannelId: string
  text: string
  publishedAt: string
  isChatSponsor: boolean
  isChatModerator: boolean
  isChatOwner: boolean
}

export interface LiveChat {
  id: string
  ownerChannelId: string
  items: ChatItem[]
  ended: boolean
}

export interface FakeState {
  readonly options: FakeYouTubeOptions
  readonly channels: Map<string, FakeYouTubeChannel>
  readonly codes: Map<string, AuthorizationCode>
  readonly accessTokens: Map<string, AccessToken>
  readonly refreshTokens: Map<string, RefreshToken>
  /** Live chats by id; a channel is live while one of its chats has not ended. */
  readonly chats: Map<string, LiveChat>
  readonly failures: Map<FailableEndpoint, ScriptedFailure[]>
  readonly calls: Call[]
  /** The channel the next sign-in picks; null signs in an account without a channel. */
  signInChannelId: string | null
  pollingIntervalMillis: number
}

export function createState(options: FakeYouTubeOptions): FakeState {
  return {
    options,
    channels: new Map([[options.defaultChannel.id, options.defaultChannel]]),
    codes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    chats: new Map(),
    failures: new Map(),
    calls: [],
    signInChannelId: options.defaultChannel.id,
    pollingIntervalMillis: 5000,
  }
}

export function requireChannel(state: FakeState, id: string): FakeYouTubeChannel {
  const channel = state.channels.get(id)
  if (channel === undefined) {
    throw new Error(`fake YouTube has no channel ${id}; call control.addChannel first`)
  }
  return channel
}

export function takeFailure(
  state: FakeState,
  endpoint: FailableEndpoint,
): ScriptedFailure | undefined {
  return state.failures.get(endpoint)?.shift()
}

/** The chat of the channel's broadcast that has not ended, if it is live. */
export function activeChat(state: FakeState, channelId: string): LiveChat | undefined {
  return [...state.chats.values()].find((chat) => chat.ownerChannelId === channelId && !chat.ended)
}
