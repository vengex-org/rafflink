// Writes public/sounds/reveal.wav, the chime the overlay plays at a winner reveal: synthesized here, so the
// file has no third-party source or license. Rerun with `bun run reveal-sound` after changing it and commit the file.
const sampleRate = 22_050
const seconds = 0.9
// A rising major arpeggio (E5, G#5, B5, E6), each note starting a little after the last.
const notes = [659.25, 830.61, 987.77, 1318.51]
const noteGapSeconds = 0.08
const decayPerSecond = 6
const peak = 0.5

const samples = new Int16Array(Math.round(sampleRate * seconds))
for (let index = 0; index < samples.length; index++) {
  const time = index / sampleRate
  let value = 0
  notes.forEach((frequency, note) => {
    const local = time - note * noteGapSeconds
    if (local < 0) return
    // A 5 ms attack keeps the start free of a click; the second partial gives the tone a bell color.
    const envelope = Math.min(1, local / 0.005) * Math.exp(-decayPerSecond * local)
    value +=
      envelope
      * (Math.sin(2 * Math.PI * frequency * local)
        + 0.3 * Math.sin(4 * Math.PI * frequency * local))
  })
  const fadeOut = Math.min(1, (seconds - time) / 0.05)
  samples[index] = Math.round(((value * peak) / notes.length) * fadeOut * 32_767)
}

await Bun.write(new URL("../public/sounds/reveal.wav", import.meta.url), wav(samples))
console.info("reveal sound written", { bytes: 44 + samples.byteLength })

/** A mono 16-bit PCM WAV file. */
function wav(pcm: Int16Array): Uint8Array {
  const header = new DataView(new ArrayBuffer(44))
  const ascii = (at: number, text: string) => {
    for (let offset = 0; offset < text.length; offset++) {
      header.setUint8(at + offset, text.charCodeAt(offset))
    }
  }
  ascii(0, "RIFF")
  header.setUint32(4, 36 + pcm.byteLength, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  ascii(36, "data")
  header.setUint32(40, pcm.byteLength, true)
  const file = new Uint8Array(44 + pcm.byteLength)
  file.set(new Uint8Array(header.buffer), 0)
  file.set(new Uint8Array(pcm.buffer), 44)
  return file
}
