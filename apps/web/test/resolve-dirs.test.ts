import { describe, expect, it } from "bun:test"
import { join, resolve } from "node:path"
import { resolveDirs } from "../scripts/resolve-dirs.ts"

const app = join(import.meta.dir, "..")

describe("resolveDirs", () => {
  it("defaults to the dist and public directories of this app", () => {
    expect(resolveDirs([])).toEqual({ dist: join(app, "dist"), publicDir: join(app, "public") })
  })

  it("takes both directories from the arguments, relative to the working directory", () => {
    expect(resolveDirs(["out/web", "/assets"])).toEqual({
      dist: resolve("out/web"),
      publicDir: resolve("/assets"),
    })
  })

  it("keeps the default public directory when only the output directory is given", () => {
    expect(resolveDirs(["out/web"])).toEqual({
      dist: resolve("out/web"),
      publicDir: join(app, "public"),
    })
  })
})
