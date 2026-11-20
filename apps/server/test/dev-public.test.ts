import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { startServer, type RunningServer } from "../src/start-server.ts"
import { testConfig, tempDir } from "./fixtures.ts"

const publicDir = join(import.meta.dir, "../../web/public")

let info: ReturnType<typeof spyOn>
let server: RunningServer
let dataDir: ReturnType<typeof tempDir>

beforeEach(() => {
  info = spyOn(console, "info").mockImplementation(() => {})
  dataDir = tempDir()
})

afterEach(async () => {
  await server.stop()
  dataDir.remove()
  info.mockRestore()
})

describe("dev server public files", () => {
  it("answers a font and a favicon of the web public folder instead of the SPA page", async () => {
    const devSpa = (await import("@rafflink/web/index.html")).default
    server = await startServer({
      config: testConfig({
        DATA_DIR: dataDir.path,
        DEV_FAKE_TWITCH: "true",
        PUBLIC_URL: "http://localhost:0",
      }),
      staticDir: null,
      devSpa,
      devPublicDir: publicDir,
    })

    const font = await fetch(new URL("/fonts/geist-1.9.2.woff2", server.url))
    const favicon = await fetch(new URL("/favicon.svg", server.url))
    const page = await fetch(new URL("/some/page", server.url))

    expect(font.status).toBe(200)
    expect(font.headers.get("content-type")).toBe("font/woff2")
    expect(favicon.status).toBe(200)
    expect(await favicon.text()).toBe(await Bun.file(join(publicDir, "favicon.svg")).text())
    expect(page.headers.get("content-type")).toContain("text/html")
  })

  it("serves the built SPA folder and none of the web public folder in production", async () => {
    writeFileSync(join(dataDir.path, "built.txt"), "built")
    server = await startServer({
      config: testConfig({ DATA_DIR: dataDir.path }),
      staticDir: dataDir.path,
      devSpa: null,
      devPublicDir: null,
    })

    const built = await fetch(new URL("/built.txt", server.url))
    const favicon = await fetch(new URL("/favicon.svg", server.url))

    expect(await built.text()).toBe("built")
    expect(favicon.status).toBe(404)
  })
})
