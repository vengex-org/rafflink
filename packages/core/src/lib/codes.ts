import type { Random } from "../ports.ts"

/** 32 characters, so `byte % length` is unbiased; no `0 O 1 l I`. */
export const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export const codeLength = 5

export function generateCode(random: Random): string {
  return Array.from(random.bytes(codeLength), (byte) =>
    codeAlphabet.charAt(byte % codeAlphabet.length),
  ).join("")
}
