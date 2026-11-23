import {
  createFakeYouTube,
  type FakeYouTube,
  type FakeYouTubeChannel,
} from "@rafflink/fake-youtube"

export const youtubeChannels = {
  streamer: channel("UCcontractstreamer00000a", "Contract Streamer", "@contract_streamer"),
  viewer: channel("UCcontractviewer0000000a", "Contract Viewer", "@contract_viewer"),
  viewer2: channel("UCcontractviewer0000000b", "Second Viewer", "@contract_viewer2"),
  viewer3: channel("UCcontractviewer0000000c", "Third Viewer", "@contract_viewer3"),
} as const

function channel(id: string, title: string, handle: string): FakeYouTubeChannel {
  return { id, title, handle }
}

/** The Google client the fake accepts; a target gets it as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. */
export const youtubeClientCredentials = { id: "yt-client-1", secret: "yt-secret-1" } as const

export interface RunningFakeYouTube {
  readonly fake: FakeYouTube
  readonly origin: string
  stop(): Promise<void>
}

/** The fake YouTube on its own port, knowing every channel of {@link youtubeChannels}; it asks for a chat read every second. */
export function startFakeYouTube(): RunningFakeYouTube {
  const fake = createFakeYouTube({
    clientId: youtubeClientCredentials.id,
    clientSecret: youtubeClientCredentials.secret,
    defaultChannel: youtubeChannels.streamer,
  })
  for (const known of Object.values(youtubeChannels)) fake.control.addChannel(known)
  fake.control.setPollingInterval(1000)
  const server = Bun.serve({ port: 0, fetch: fake.app.fetch })
  return {
    fake,
    origin: server.url.origin,
    stop: async () => {
      await server.stop(true)
    },
  }
}
