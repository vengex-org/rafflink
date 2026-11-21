import type { BeaconAnswer, RandomnessBeacon } from "../src/ports.ts"

/** The randomness every round of a {@link FakeBeacon} yields. */
export const fakeRandomness = new Uint8Array(32).fill(7)

/** A beacon that answers as `answer` says, with {@link fakeRandomness} for any round, and records the rounds asked for. */
export class FakeBeacon implements RandomnessBeacon {
  answer: BeaconAnswer["kind"] = "round"
  readonly requested: number[] = []

  async fetchRound(round: number): Promise<BeaconAnswer> {
    this.requested.push(round)
    switch (this.answer) {
      case "round":
        return {
          kind: "round",
          round: { round, randomness: new Uint8Array(fakeRandomness), signature: "00" },
        }
      case "not-yet":
        return { kind: "not-yet" }
      case "unavailable":
        return { kind: "unavailable" }
    }
  }
}
