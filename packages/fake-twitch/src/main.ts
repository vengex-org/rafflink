import { devFakeTwitchOptions, seededUsersFirstId, serveFakeTwitch } from "./serve.ts"

const port = Number(process.env.PORT ?? 3001)
const options = {
  ...devFakeTwitchOptions,
  ...(process.env.TOKEN_LIMIT_PER_SECOND === undefined
    ? {}
    : { tokenLimitPerSecond: positiveInteger("TOKEN_LIMIT_PER_SECOND") }),
}
const { server, control } = serveFakeTwitch(port, options)
if (process.env.SEED_USERS !== undefined) {
  control.seedUsers(positiveInteger("SEED_USERS"), seededUsersFirstId)
}
console.info("fake twitch listening", { url: server.url.href })

function positiveInteger(name: string): number {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}
