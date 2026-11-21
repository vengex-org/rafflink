import init from "../../schema/room/0001_init.sql" with { type: "text" }
import closedAt from "../../schema/room/0002_closed_at.sql" with { type: "text" }

/** The room schema files in application order; file `NNNN_*.sql` is entry NNNN - 1. */
export const roomMigrations: readonly string[] = [init, closedAt]
