import { fileURLToPath } from "node:url"

const workerEntry = fileURLToPath(new URL("../worker.ts", import.meta.url))
const bundlePath = fileURLToPath(new URL("../../dist/worker.js", import.meta.url))

/**
 * The Worker and its Durable Objects as one ES module. The `.sql` imports of core are inlined as text,
 * which is why Bun bundles the Worker and `wrangler.jsonc` points `main` at the result instead of the source.
 */
export async function bundleWorker(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [workerEntry],
    target: "browser",
    format: "esm",
    conditions: ["workerd", "worker", "browser"],
    // The runtime provides these modules.
    external: ["cloudflare:*", "node:*"],
  })
  const [output] = result.outputs
  if (!result.success || output === undefined) {
    throw new AggregateError(result.logs, "the Worker bundle failed")
  }
  return output.text()
}

if (import.meta.main) {
  await Bun.write(bundlePath, await bundleWorker())
  console.info("worker bundle written", { path: bundlePath })
}
