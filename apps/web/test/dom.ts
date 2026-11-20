import { GlobalRegistrator } from "@happy-dom/global-registrator"

// Registered through bunfig.toml for `bun test` inside apps/web only: the other packages' tests keep Bun's own fetch and WebSocket.
GlobalRegistrator.register({ url: "http://rafflink.test/" })
