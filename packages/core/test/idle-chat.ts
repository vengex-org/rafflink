import type { ChatLink } from "../src/room/chat-watcher.ts"

/** A chat link whose sockets never connect and whose subscription always succeeds: for rooms under test that watch no chat. */
export const idleChat: ChatLink = {
  connector: { open: () => ({ close: () => {} }) },
  subscribe: async () => {},
}
