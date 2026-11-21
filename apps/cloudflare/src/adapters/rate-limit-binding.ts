import { errorClass } from "@rafflink/core/lib/error-class"
import type { RateLimiter } from "@rafflink/core/ports"

/**
 * A {@link RateLimiter} on a Workers Rate Limiting binding, whose limit and period are fixed in
 * `wrangler.jsonc`. A binding that fails lets the call through: a limiter outage must not close a giveaway.
 */
export class RateLimitBindingLimiter implements RateLimiter {
  constructor(private readonly binding: RateLimit) {}

  async allow(key: string): Promise<boolean> {
    try {
      return (await this.binding.limit({ key })).success
    } catch (error) {
      console.warn("rate limit binding failed", { errorClass: errorClass(error) })
      return true
    }
  }
}

/** The address Cloudflare saw the request come from; the edge sets it and replaces a value the client sent. */
export function connectingAddress(request: Request): string | null {
  return request.headers.get("cf-connecting-ip")
}
