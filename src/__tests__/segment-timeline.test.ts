import { describe, it, expect } from "vitest";
import { computeMergedTimeline } from "../utils/segment-timeline";

const seg = (duration?: number, trimmedDuration?: number) => ({
  duration,
  trimmedDuration,
});

const pairs = (t: { spans: { start: number; end: number }[] }) =>
  t.spans.map((s) => [+s.start.toFixed(4), +s.end.toFixed(4)]);

describe("computeMergedTimeline", () => {
  it("splits each crossfade joint at its midpoint so spans never overlap", () => {
    // trimmed 2.5 / 2.6 / 2.4 with 0.05 crossfade → real merged WAV is 7.399s
    // (verified with native ffmpeg). Joints sit at 2.5-0.025 and 5.05-0.025.
    const t = computeMergedTimeline(
      [seg(3.3, 2.5), seg(3.7, 2.6), seg(3.4, 2.4)],
      0.05,
      true,
    );
    expect(pairs(t)).toEqual([
      [0, 2.475],
      [2.475, 5.025],
      [5.025, 7.4],
    ]);
    expect(t.totalDuration).toBeCloseTo(7.4, 3);
  });

  it("keeps spans contiguous and non-overlapping", () => {
    const t = computeMergedTimeline(
      [seg(1.2, 1.0), seg(2.4, 2.0), seg(0.9, 0.7), seg(3.1, 2.9)],
      0.08,
      true,
    );
    for (let i = 1; i < t.spans.length; i++) {
      // no overlap and no gap
      expect(t.spans[i].start).toBeCloseTo(t.spans[i - 1].end, 10);
    }
    expect(t.spans[0].start).toBe(0);
    expect(t.spans.at(-1)!.end).toBeCloseTo(t.totalDuration, 10);
    expect(t.spans.every((s) => s.end >= s.start)).toBe(true);
  });

  it("still reports the true merged duration (crossfade shortens the total)", () => {
    const t = computeMergedTimeline([seg(1), seg(1)], 0.1, false);
    expect(t.totalDuration).toBeCloseTo(1.9, 5);
    expect(pairs(t)).toEqual([
      [0, 0.95],
      [0.95, 1.9],
    ]);
  });

  it("falls back to raw duration when trimming is off", () => {
    const t = computeMergedTimeline(
      [seg(3.3, 2.5), seg(3.7, 2.6), seg(3.4, 2.4)],
      0.05,
      false,
    );
    expect(pairs(t)).toEqual([
      [0, 3.275],
      [3.275, 6.925],
      [6.925, 10.3],
    ]);
    expect(t.totalDuration).toBeCloseTo(10.3, 3);
  });

  it("falls back to raw duration when trimmedDuration is missing", () => {
    const t = computeMergedTimeline([seg(2), seg(3)], 0, true);
    expect(pairs(t)).toEqual([
      [0, 2],
      [2, 5],
    ]);
    expect(t.totalDuration).toBeCloseTo(5, 5);
  });

  it("applies no crossfade for a single segment", () => {
    const t = computeMergedTimeline([seg(3.3, 2.5)], 0.05, true);
    expect(t.spans).toEqual([{ index: 0, start: 0, end: 2.5, duration: 2.5 }]);
    expect(t.totalDuration).toBe(2.5);
  });

  it("returns an empty timeline for no segments", () => {
    expect(computeMergedTimeline([], 0.05, true)).toEqual({
      spans: [],
      totalDuration: 0,
    });
  });

  it("gives zero-width spans to segments without audio and does not shift others", () => {
    const t = computeMergedTimeline(
      [seg(2, 2), seg(undefined, undefined), seg(3, 3)],
      0.05,
      true,
    );
    // Joint between the two audible segments: 2 - 0.025 = 1.975
    expect(pairs(t)).toEqual([
      [0, 1.975],
      [1.975, 1.975],
      [1.975, 4.95],
    ]);
    expect(t.totalDuration).toBeCloseTo(4.95, 5);
  });

  it("stays monotonic when segments are shorter than the crossfade", () => {
    const t = computeMergedTimeline(
      [seg(0.01, 0.01), seg(0.01, 0.01), seg(0.01, 0.01)],
      0.5,
      true,
    );
    expect(t.spans.every((s) => s.start >= 0 && s.end >= s.start)).toBe(true);
    for (let i = 1; i < t.spans.length; i++) {
      expect(t.spans[i].start).toBeGreaterThanOrEqual(t.spans[i - 1].end - 1e-12);
    }
    expect(t.spans.at(-1)!.end).toBeCloseTo(t.totalDuration, 10);
  });

  it("treats a missing crossfade duration as zero overlap", () => {
    const t = computeMergedTimeline([seg(1), seg(1)], undefined, false);
    expect(t.totalDuration).toBeCloseTo(2, 5);
    expect(pairs(t)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("has exactly one span covering any instant (first-match is unambiguous)", () => {
    // This is the property that fixes the waveform artifact: the player picks a
    // segment colour / active index by scanning for the first span containing a
    // time, so overlapping spans made the previous segment win at the start of
    // the next one.
    const t = computeMergedTimeline(
      [seg(3.3, 2.5), seg(3.7, 2.6), seg(3.4, 2.4)],
      0.05,
      true,
    );
    const audible = t.spans.filter((s) => s.duration > 0);
    for (let step = 0; step < 400; step++) {
      const time = (step / 400) * t.totalDuration;
      const hits = audible.filter((s) => time >= s.start && time < s.end);
      expect(hits).toHaveLength(1);
    }
  });

  it("reports each span's own width as its duration", () => {
    const t = computeMergedTimeline([seg(2, 2), seg(3, 3)], 0.1, true);
    for (const s of t.spans) {
      expect(s.duration).toBeCloseTo(s.end - s.start, 10);
    }
  });
});
