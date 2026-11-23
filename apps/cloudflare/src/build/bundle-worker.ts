import { fileURLToPath } from "node:url"

const workerEntry = fileURLToPath(new URL("../worker.ts", import.meta.url))
const bundlePath = fileURLToPath(new URL("../../dist/worker.js", import.meta.url))

export interface WorkerBundle {
  readonly code: string
  /** CI uploads it to Sentry; the deploy never sends it to Cloudflare. */
  readonly sourceMap: string
}

/**
 * The Worker and its Durable Objects as one ES module. The `.sql` imports of core are inlined as text,
 * which is why Bun bundles the Worker and `wrangler.jsonc` points `main` at the result instead of the source.
 */
export async function bundleWorker(): Promise<WorkerBundle> {
  const result = await Bun.build({
    entrypoints: [workerEntry],
    target: "browser",
    format: "esm",
    conditions: ["workerd", "worker", "browser"],
    // The runtime provides these modules.
    external: ["cloudflare:*", "node:*"],
    sourcemap: "external",
  })
  const code = result.outputs.find((output) => output.kind === "entry-point")
  const sourceMap = code?.sourcemap
  if (!result.success || code === undefined || sourceMap === null || sourceMap === undefined) {
    throw new AggregateError(result.logs, "the Worker bundle failed")
  }
  return { code: await code.text(), sourceMap: await sourceMap.text() }
}

if (import.meta.main) {
  const { code, sourceMap } = await bundleWorker()
  await Bun.write(bundlePath, code)
  await Bun.write(`${bundlePath}.map`, sourceMap)
  console.info("worker bundle written", { path: bundlePath })
}
