import { serveFakeTwitch } from "./serve.ts"

const port = Number(process.env.PORT ?? 3001)
const { server } = serveFakeTwitch(port)
console.info("fake twitch listening", { url: server.url.href })
