import { describe, it, expect } from "vitest";
import { computeMergedTimeline } from "../utils/segment-timeline";

const seg = (duration?: number, trimmedDuration?: number) => ({
  duration,
  trimmedDuration,
});

describe("computeMergedTimeline", () => {
  it("uses trimmedDuration and subtracts crossfade overlap when trimming is on", () => {
    const t = computeMergedTimeline(
      [seg(3.3, 2.5), seg(3.7, 2.6), seg(3.4, 2.4)],
      0.05,
      true,
    );
    expect(t.spans.map((s) => [+s.start.toFixed(3), +s.end.toFixed(3)])).toEqual([
      [0, 2.5],
      [2.45, 5.05],
      [5.0, 7.4],
    ]);
    // Verified against native ffmpeg: real merged WAV is 7.399s
    expect(t.totalDuration).toBeCloseTo(7.4, 3);
  });

  it("falls back to raw duration when trimming is off", () => {
    const t = computeMergedTimeline(
      [seg(3.3, 2.5), seg(3.7, 2.6), seg(3.4, 2.4)],
      0.05,
      false,
    );
    expect(t.spans.map((s) => +s.end.toFixed(3))).toEqual([3.3, 6.95, 10.3]);
    expect(t.totalDuration).toBeCloseTo(10.3, 3);
  });

  it("still subtracts crossfade when trimming is off (pre-existing overlap)", () => {
    const t = computeMergedTimeline([seg(1), seg(1)], 0.1, false);
    expect(t.totalDuration).toBeCloseTo(1.9, 5);
  });

  it("falls back to raw duration when trimmedDuration is missing", () => {
    const t = computeMergedTimeline([seg(2), seg(3)], 0, true);
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
    expect(t.spans.map((s) => [+s.start.toFixed(3), +s.end.toFixed(3)])).toEqual([
      [0, 2],
      [2, 2],
      [1.95, 4.95],
    ]);
    expect(t.totalDuration).toBeCloseTo(4.95, 5);
  });

  it("never produces a negative start time", () => {
    const t = computeMergedTimeline([seg(0.01, 0.01), seg(0.01, 0.01)], 0.5, true);
    expect(t.spans.every((s) => s.start >= 0)).toBe(true);
  });

  it("treats a missing crossfade duration as zero overlap", () => {
    const t = computeMergedTimeline([seg(1), seg(1)], undefined, false);
    expect(t.totalDuration).toBeCloseTo(2, 5);
  });
});
