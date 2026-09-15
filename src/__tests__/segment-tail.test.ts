import { describe, it, expect } from "vitest";
import { cleanSegmentTail } from "../utils/segment-tail";

const SR = 24000;
type Part = { ms: number; db: number | null }; // null = digital silence

/** 16-bit mono WAV of 1 kHz tone parts (1 kHz → every 1 ms window holds a full cycle). */
function wav(parts: Part[], opts: { placeholderSizes?: boolean; channels?: number } = {}): ArrayBuffer {
  const ch = opts.channels ?? 1;
  const frames = parts.reduce((a, p) => a + Math.round((p.ms * SR) / 1000), 0);
  const buf = new ArrayBuffer(44 + frames * 2 * ch);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, opts.placeholderSizes ? 0xffffffff : 36 + frames * 2 * ch, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2 * ch, true); v.setUint16(32, 2 * ch, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, opts.placeholderSizes ? 0xffffffff : frames * 2 * ch, true);
  let f = 0;
  for (const p of parts) {
    const n = Math.round((p.ms * SR) / 1000);
    const amp = p.db === null ? 0 : Math.min(1, Math.pow(10, p.db / 20));
    for (let i = 0; i < n; i++, f++) {
      const s = Math.round(Math.min(32767, amp * 32767) * Math.sin((2 * Math.PI * 1000 * f) / SR));
      for (let c = 0; c < ch; c++) v.setInt16(44 + f * 2 * ch + c * 2, s, true);
    }
  }
  return buf;
}
const frames = (b: ArrayBuffer) => (b.byteLength - 44) / 2;
const lastSample = (b: ArrayBuffer) => new DataView(b).getInt16(b.byteLength - 2, true);
const SPEECH: Part = { ms: 200, db: -20 };

describe("cleanSegmentTail", () => {
  it("rule 1: cuts a short burst that follows a quiet gap", () => {
    const input = wav([SPEECH, { ms: 100, db: null }, { ms: 12, db: 0 }]);
    const r = cleanSegmentTail(input);
    expect(r.rule).toBe(1);
    expect(r.cutMs).toBe(12);
    expect(frames(r.buffer)).toBe(frames(input) - 12 * 24);
    expect(lastSample(r.buffer)).toBe(0);
  });

  it("rule 2: cuts a burst that follows a soft tail instead of silence (with margin)", () => {
    const r = cleanSegmentTail(wav([SPEECH, { ms: 30, db: -35 }, { ms: 10, db: 0 }]));
    expect(r.rule).toBe(2);
    expect(r.cutMs).toBe(12);
  });

  it("rule 3: also removes an isolated click shortly before a confirmed burst", () => {
    const r = cleanSegmentTail(
      wav([SPEECH, { ms: 40, db: null }, { ms: 8, db: -18 }, { ms: 25, db: null }, { ms: 12, db: 0 }]),
    );
    expect(r.rule).toBe(13);
    expect(r.preClickMs).toBeGreaterThan(0);
    expect(r.cutMs).toBe(47); // burst 12 + silence 25 + click 8 + margin 2
  });

  it("never looks for a pre-click when no burst was confirmed (could be a final consonant)", () => {
    const r = cleanSegmentTail(wav([SPEECH, { ms: 40, db: null }, { ms: 8, db: -18 }, { ms: 25, db: null }]));
    expect(r.cutMs).toBe(0);
    expect(r.rule).toBe(0);
  });

  it("keeps speech that is simply cut off at the end (fade only)", () => {
    const input = wav([{ ms: 400, db: -18 }]);
    const r = cleanSegmentTail(input);
    expect(r.cutMs).toBe(0);
    expect(frames(r.buffer)).toBe(frames(input));
    expect(lastSample(r.buffer)).toBe(0);
  });

  it("keeps a loud tail longer than 30 ms", () => {
    expect(cleanSegmentTail(wav([SPEECH, { ms: 50, db: null }, { ms: 40, db: 0 }])).cutMs).toBe(0);
  });

  it("leaves a segment that already ends in silence byte-identical", () => {
    const input = wav([SPEECH, { ms: 200, db: null }]);
    const r = cleanSegmentTail(input);
    expect(r.cutMs).toBe(0);
    expect(new Uint8Array(r.buffer)).toEqual(new Uint8Array(input));
  });

  it("handles streaming WAV headers with placeholder sizes and writes real sizes", () => {
    const r = cleanSegmentTail(wav([SPEECH, { ms: 100, db: null }, { ms: 12, db: 0 }], { placeholderSizes: true }));
    expect(r.cutMs).toBe(12);
    const v = new DataView(r.buffer);
    expect(v.getUint32(4, true)).toBe(r.buffer.byteLength - 8);
    expect(v.getUint32(40, true)).toBe(r.buffer.byteLength - 44);
  });

  it("works on multi-channel audio", () => {
    const r = cleanSegmentTail(wav([SPEECH, { ms: 100, db: null }, { ms: 12, db: 0 }], { channels: 2 }));
    expect(r.cutMs).toBe(12);
  });

  it("returns non-WAV input untouched instead of throwing", () => {
    const junk = new ArrayBuffer(100);
    const r = cleanSegmentTail(junk);
    expect(r.buffer).toBe(junk);
    expect(r.skipped).toBeTruthy();
  });

  it("returns non-16-bit PCM untouched", () => {
    const input = wav([SPEECH]);
    new DataView(input).setUint16(34, 24, true); // pretend 24-bit
    const r = cleanSegmentTail(input);
    expect(r.buffer).toBe(input);
    expect(r.skipped).toMatch(/unsupported/);
  });

  it("copes with audio shorter than the scan window", () => {
    const r = cleanSegmentTail(wav([{ ms: 20, db: -20 }]));
    expect(r.skipped).toBeUndefined();
    expect(lastSample(r.buffer)).toBe(0);
  });
});
