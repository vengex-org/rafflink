import type { ChatOpener } from "../src/platform/chat-source.ts"
import type { Clock } from "../src/ports.ts"
import { eventSubChat, type ChatWatcherConfig } from "../src/twitch/chat-watcher.ts"

/** A chat whose sockets never connect and whose subscription always succeeds: for rooms under test whose chat watch never gets a message. */
export function idleChat(clock: Clock, config: ChatWatcherConfig): ChatOpener {
  const source = eventSubChat({
    connector: { open: () => ({ close: () => {} }) },
    subscribe: async () => {},
    clock,
    config,
  })
  return (_platform, listener) => source(listener)
}
