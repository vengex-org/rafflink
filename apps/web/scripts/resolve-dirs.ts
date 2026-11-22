import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** The output and public directories of a web build: the arguments after the script name, else this app's own. */
export function resolveDirs(argv: readonly string[]): {
  readonly dist: string
  readonly publicDir: string
} {
  const [distArg, publicArg] = argv
  return {
    dist: resolve(distArg ?? fileURLToPath(new URL("../dist/", import.meta.url))),
    publicDir: resolve(publicArg ?? fileURLToPath(new URL("../public/", import.meta.url))),
  }
}
