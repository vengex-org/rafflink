import type { ChatLink } from "../src/room/chat-watcher.ts"

/** A chat link whose sockets never connect and whose subscription always succeeds: for rooms under test whose chat watch never gets a message. */
export const idleChat: ChatLink = {
  connector: { open: () => ({ close: () => {} }) },
  subscribe: async () => {},
}
