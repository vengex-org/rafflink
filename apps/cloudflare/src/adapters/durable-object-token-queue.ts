import type { TokenQueue, TokenQueueStub } from "@rafflink/core/queue/token-queue"
import type { TokenQueueDO } from "../durable-objects/token-queue-do.ts"

const queueObjectName = "queue"

/** The one token queue of the deployment: a single Durable Object, so one drain rate for every giveaway. */
export function durableObjectTokenQueue(
  namespace: DurableObjectNamespace<TokenQueueDO>,
): TokenQueueStub {
  // A stub is made per call: it belongs to the request that made it.
  const stub = () => namespace.get(namespace.idFromName(queueObjectName))
  return {
    enqueue: (...args: Parameters<TokenQueue["enqueue"]>) => stub().enqueue(...args),
    poll: (...args: Parameters<TokenQueue["poll"]>) => stub().poll(...args),
    stats: () => stub().stats(),
  }
}
