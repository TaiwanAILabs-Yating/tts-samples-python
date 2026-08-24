import { describe, it, expect } from "vitest";
import { estimateTrimmedWavDuration, getWavDuration } from "../utils/audio";

const SAMPLE_RATE = 44100;

/** Build a mono 16-bit PCM WAV from [durationSec, amplitude] sections (sine 440Hz). */
function makeWav(sections: [number, number][]): ArrayBuffer {
  const totalFrames = sections.reduce(
    (acc, [d]) => acc + Math.round(d * SAMPLE_RATE),
    0,
  );
  const dataSize = totalFrames * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let frame = 0;
  for (const [dur, amp] of sections) {
    const frames = Math.round(dur * SAMPLE_RATE);
    for (let i = 0; i < frames; i++, frame++) {
      const sample = amp * Math.sin((2 * Math.PI * 440 * frame) / SAMPLE_RATE);
      view.setInt16(44 + frame * 2, Math.round(sample * 32767), true);
    }
  }
  return buf;
}

describe("estimateTrimmedWavDuration", () => {
  // sine amp 0.1 → RMS ≈ -23dB, way above -50dB threshold
  const TONE = 0.1;

  it("keeps keepSec of silence on each side and preserves internal pauses", () => {
    // 0.4s silence + 1s tone + 0.3s internal pause + 1s tone + 0.6s silence
    const wav = makeWav([[0.4, 0], [1, TONE], [0.3, 0], [1, TONE], [0.6, 0]]);
    const est = estimateTrimmedWavDuration(wav, -50, 0.1);
    // expected ≈ 0.1 + 1 + 0.3 + 1 + 0.1 = 2.5
    expect(est).toBeGreaterThan(2.4);
    expect(est).toBeLessThan(2.6);
  });

  it("returns full duration when there is no leading/trailing silence", () => {
    const wav = makeWav([[1.5, TONE]]);
    const full = getWavDuration(wav);
    expect(estimateTrimmedWavDuration(wav, -50, 0.1)).toBeCloseTo(full, 1);
  });

  it("keeps existing short silence when shorter than keepSec", () => {
    // only 0.03s lead/tail silence — nothing to trim
    const wav = makeWav([[0.03, 0], [1, TONE], [0.03, 0]]);
    const est = estimateTrimmedWavDuration(wav, -50, 0.1);
    expect(est).toBeGreaterThan(1.0);
    expect(est).toBeLessThan(1.12);
  });

  it("returns 0 for fully silent audio", () => {
    const wav = makeWav([[1, 0]]);
    expect(estimateTrimmedWavDuration(wav, -50, 0.1)).toBe(0);
  });

  it("treats quiet audio below threshold as silence", () => {
    // amp 0.001 → RMS ≈ -63dB < -50dB → all silence
    const wav = makeWav([[1, 0.001]]);
    expect(estimateTrimmedWavDuration(wav, -50, 0.1)).toBe(0);
  });

  it("respects threshold direction (-40dB trims more than -50dB)", () => {
    // amp 0.005 sine → RMS ≈ -49dB: audible at -50dB, silence at -40dB
    const wav = makeWav([[0.5, 0], [1, 0.005], [0.5, 0]]);
    const at50 = estimateTrimmedWavDuration(wav, -50, 0.1);
    const at40 = estimateTrimmedWavDuration(wav, -40, 0.1);
    expect(at50).toBeGreaterThan(1.0);
    expect(at40).toBe(0);
  });
});
