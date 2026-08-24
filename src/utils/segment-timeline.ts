/**
 * Single source of truth for "where does each segment sit inside the merged
 * audio", shared by the WaveformPlayer timeline, the sentence duration badges
 * and the exported metadata.json.
 *
 * Two effects shift segment boundaries away from a naive sum of raw segment
 * durations:
 *
 * 1. Silence removal (when `trimSilence` is on) shortens each segment to its
 *    `trimmedDuration`.
 * 2. `acrossfade` overlaps each joint by `crossfadeDuration`.
 *
 * Segments without audio (error / not generated) get a zero-width span so
 * indices stay aligned with `pipeline.segments`, and they neither consume a
 * crossfade joint nor shift their neighbours — matching concat, which only
 * feeds successful segments to FFmpeg.
 */

/** Minimal shape needed from SegmentState — keeps this util dependency-free. */
export interface TimelineSegment {
  duration?: number;
  /** Duration after silenceremove head/tail trimming, measured at generation. */
  trimmedDuration?: number;
}

export interface SegmentSpan {
  index: number;
  /** Start offset inside the merged audio, seconds. */
  start: number;
  /** End offset inside the merged audio, seconds. */
  end: number;
  /** Effective duration contributed to the merged audio, seconds. */
  duration: number;
}

export interface MergedTimeline {
  spans: SegmentSpan[];
  /** Duration of the merged audio, seconds. */
  totalDuration: number;
}

/**
 * @param segments - Segments in pipeline order.
 * @param crossfadeDuration - acrossfade overlap per joint (seconds).
 * @param trimSilence - Whether silence removal applies to this project.
 */
export function computeMergedTimeline(
  segments: TimelineSegment[],
  crossfadeDuration: number | undefined,
  trimSilence: boolean,
): MergedTimeline {
  const xfade = crossfadeDuration ?? 0;
  const spans: SegmentSpan[] = [];
  let offset = 0;
  let joints = 0;

  segments.forEach((seg, index) => {
    const effective =
      (trimSilence ? seg.trimmedDuration : undefined) ?? seg.duration ?? 0;
    if (effective <= 0) {
      spans.push({ index, start: offset, end: offset, duration: 0 });
      return;
    }
    const start = joints > 0 ? Math.max(0, offset - xfade) : offset;
    offset = start + effective;
    joints++;
    spans.push({ index, start, end: offset, duration: effective });
  });

  return { spans, totalDuration: offset };
}
