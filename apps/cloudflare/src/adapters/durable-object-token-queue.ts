import type { PlanQueue } from "@rafflink/core/plan/current-plan"
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

/** The same queue object, told about a plan switch so its next alarm invocation takes the plan's budget. */
export function durableObjectPlanQueue(namespace: DurableObjectNamespace<TokenQueueDO>): PlanQueue {
  return { usePlan: (plan) => namespace.get(namespace.idFromName(queueObjectName)).usePlan(plan) }
}
