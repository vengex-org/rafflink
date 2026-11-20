declare module "cloudflare:workers" {
  /** The base class of a Durable Object that exposes methods over RPC; the runtime provides it. */
  export const DurableObject: typeof import("@cloudflare/workers-types").CloudflareWorkersModule.DurableObject
}
