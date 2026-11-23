import { defineContract } from "@rafflink/core/test/contract"
import { startWorker } from "./start-worker.ts"

defineContract("cloudflare", "static", "switchable", startWorker, 2)
