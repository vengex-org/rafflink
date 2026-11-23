import type { FakeYouTube } from "./fake-youtube.ts"
import type { FakeYouTubeOptions } from "./state.ts"

/** The fake a local Rafflink signs in with; the server's `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` become its client. */
export const devFakeYouTubeOptions: Omit<FakeYouTubeOptions, "clientId" | "clientSecret"> = {
  defaultChannel: {
    id: "UCfakeyoutubestreamer00a",
    title: "Fake YouTube Streamer",
    handle: "@fake_youtube_streamer",
  },
}

/** The dev channel goes live at once, so a YouTube giveaway made in dev finds a chat to read. */
export function startDevFakeYouTube(fake: FakeYouTube): void {
  fake.control.goLive(devFakeYouTubeOptions.defaultChannel.id)
}
