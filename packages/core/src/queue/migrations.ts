import init from "../../schema/queue/0001_init.sql" with { type: "text" }
import adaptiveRate from "../../schema/queue/0002_adaptive_rate.sql" with { type: "text" }
import rateLimited from "../../schema/queue/0003_rate_limited.sql" with { type: "text" }

/** The token queue schema files in application order; file `NNNN_*.sql` is entry NNNN - 1. */
export const queueMigrations: readonly string[] = [init, adaptiveRate, rateLimited]
