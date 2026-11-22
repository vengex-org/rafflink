-- Entries and claims before this instant (epoch milliseconds) are already added to the per-minute counters of the account store.
ALTER TABLE room_state ADD COLUMN metrics_reported_until INTEGER NOT NULL DEFAULT 0;
