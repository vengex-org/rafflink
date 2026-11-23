import type { PublicCache } from "@rafflink/core/ports"

/**
 * A {@link PublicCache} on the Cloudflare Cache API of the data centre that served the request. The
 * Cache API stores nothing on a `workers.dev` address, so there every read is a miss.
 */
export class CacheApiPublicCache implements PublicCache {
  constructor(private readonly cache: Cache) {}

  async read(key: string): Promise<string | null> {
    const hit = await this.cache.match(new Request(key))
    return hit === undefined ? null : hit.text()
  }

  // The Cache API of one data centre: the others keep their copies until they expire.
  async delete(key: string): Promise<void> {
    await this.cache.delete(new Request(key))
  }

  async write(key: string, text: string, ttlSeconds: number): Promise<void> {
    // `Cache-Control` sits on the stored copy only, which is what the Cache API reads its lifetime from.
    await this.cache.put(
      new Request(key),
      new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${ttlSeconds}`,
        },
      }),
    )
  }
}
