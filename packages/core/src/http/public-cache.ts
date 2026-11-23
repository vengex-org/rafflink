import { errorClass } from "../lib/error-class.ts"
import type { AppDeps } from "./deps.ts"

// A cache that fails is a cache that missed: the answer still comes from the account store and the room.
export async function readPublicCache(
  deps: AppDeps,
  key: string,
  ttlSeconds: number,
): Promise<string | null> {
  if (ttlSeconds === 0) return null
  try {
    return await deps.publicCache.read(key)
  } catch (error) {
    console.warn("public cache read failed", { errorClass: errorClass(error) })
    return null
  }
}

// Best effort: a copy the delete missed still expires on its own.
export async function deletePublicCache(deps: AppDeps, key: string): Promise<void> {
  try {
    await deps.publicCache.delete(key)
  } catch (error) {
    console.warn("public cache delete failed", { errorClass: errorClass(error) })
  }
}

export async function writePublicCache(
  deps: AppDeps,
  key: string,
  text: string,
  ttlSeconds: number,
): Promise<void> {
  if (ttlSeconds === 0) return
  try {
    await deps.publicCache.write(key, text, ttlSeconds)
  } catch (error) {
    console.warn("public cache write failed", { errorClass: errorClass(error) })
  }
}
