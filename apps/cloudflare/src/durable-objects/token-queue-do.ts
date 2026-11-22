import { errorClass } from "@rafflink/core/lib/error-class"
import { DurableObject } from "cloudflare:workers"
import { currentPlanOrFree } from "@rafflink/core/plan/current-plan"
import { limitsHeldAtFree, planLimits, type CloudflarePlan } from "@rafflink/core/plan/plan-limits"
import { queueMigrations } from "@rafflink/core/queue/migrations"
import { entriesPerInvocation, TokenQueue } from "@rafflink/core/queue/token-queue"
import { applyMigrations } from "@rafflink/core/room/migrate"
import { enterQueuedCode } from "@rafflink/core/viewer/enter-giveaway"
import { DurableObjectAlarm } from "../adapters/durable-object-alarm.ts"
import { DurableObjectRoomDirectory } from "../adapters/durable-object-room-directory.ts"
import { DurableObjectSyncSql } from "../adapters/durable-object-sync-sql.ts"
import type { WorkerEnv } from "../env.ts"
import { runtimeOf } from "../runtime.ts"

/** The token queue in a SQLite-backed Durable Object; its storage alarm drains the queue. */
export class TokenQueueDO extends DurableObject<WorkerEnv> {
  private readonly queue: Promise<TokenQueue>

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.queue = ctx.blockConcurrencyWhile(() => this.open())
  }

  async enqueue(...args: Parameters<TokenQueue["enqueue"]>) {
    return (await this.queue).enqueue(...args)
  }
  async poll(...args: Parameters<TokenQueue["poll"]>) {
    return (await this.queue).poll(...args)
  }
  async stats() {
    return (await this.queue).stats()
  }
  /** Pushed by the admin plan switch, so no alarm invocation reads the plan from D1. */
  async usePlan(plan: CloudflarePlan) {
    const { config } = await runtimeOf(this.env)
    const queue = await this.queue
    queue.useEntriesPerInvocation(entriesPerInvocation(planLimits(plan, config)))
  }

  override async alarm(): Promise<void> {
    try {
      await (await this.queue).onAlarm()
    } catch (error) {
      // Rethrown so the runtime retries the alarm: without it the next drain is not armed.
      console.error("token queue alarm failed", {
        errorClass: errorClass(error),
      })
      throw error
    }
  }

  private async open(): Promise<TokenQueue> {
    const { config, clock, random, platforms, accounts, entryUserLimiter } = await runtimeOf(
      this.env,
    )
    const sql = new DurableObjectSyncSql(this.ctx.storage)
    applyMigrations(sql, queueMigrations)
    const entryDeps = {
      config,
      clock,
      random,
      platforms,
      accounts,
      rooms: new DurableObjectRoomDirectory(this.env.ROOMS),
      entryUserLimiter,
    }
    return new TokenQueue({
      sql,
      alarm: new DurableObjectAlarm(this.ctx.storage),
      clock,
      random,
      config,
      process: (item) => enterQueuedCode(entryDeps, item),
      rooms: entryDeps.rooms,
      // An alarm invocation may send only as many external subrequests as the plan allows.
      entriesPerInvocation: entriesPerInvocation(planLimits(await this.startPlan(), config)),
    })
  }

  // Read once per start of the object; a switch while it runs arrives through `usePlan`.
  private async startPlan(): Promise<CloudflarePlan> {
    const { config, accounts } = await runtimeOf(this.env)
    const plan = await currentPlanOrFree(accounts, config, (error) => {
      // The queue must still drain; Free applies until the next start or switch.
      console.warn("cloudflare plan unavailable, Free budget applies", {
        errorClass: errorClass(error),
      })
    })
    const held = limitsHeldAtFree(plan, config)
    if (held.length > 0) {
      console.warn("env overrides hold Paid limits at the Free value", { plan, limits: held })
    }
    return plan
  }
}
