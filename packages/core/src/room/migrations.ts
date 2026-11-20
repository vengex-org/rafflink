import init from "../../schema/room/0001_init.sql" with { type: "text" }

/** The room schema files in application order; file `NNNN_*.sql` is entry NNNN - 1. */
export const roomMigrations: readonly string[] = [init]
