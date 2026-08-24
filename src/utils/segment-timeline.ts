/**
 * Single source of truth for "where does each segment sit inside the merged
 * audio", shared by the WaveformPlayer timeline, the sentence duration badges
 * and the exported metadata.json.
 *
 * Two effects move segment boundaries away from a naive sum of raw durations:
 *
 * 1. Silence removal (when `trimSilence` is on) shortens each segment to its
 *    `trimmedDuration`.
 * 2. `acrossfade` overlaps each joint by `crossfadeDuration`.
 *
 * The crossfade region belongs to *both* neighbours in the audio, but a
 * timeline needs one owner per instant: overlapping spans made the waveform
 * paint the previous segment's colour over the start of the next one, put the
 * divider line 50ms off from the colour change, and delayed the active-segment
 * highlight. So each joint is **split at its midpoint** — every segment owns
 * the half of the fade where it dominates. The resulting spans are contiguous
 * and never overlap, which also keeps metadata.json's `start`/`end` usable for
 * things like subtitles or cutting the file up.
 *
 * `totalDuration` is unaffected by the split: it stays the real merged length.
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
  /** Width of this span (`end - start`), seconds. */
  duration: number;
}

export interface MergedTimeline {
  /** Contiguous, non-overlapping spans, one per input segment. */
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

  const effective = segments.map(
    (seg) => (trimSilence ? seg.trimmedDuration : undefined) ?? seg.duration ?? 0,
  );

  // Pass 1: where each segment's audio actually sits — consecutive audible
  // segments overlap by the crossfade. This is what fixes the total length.
  const audioStart: number[] = [];
  const audioEnd: number[] = [];
  let offset = 0;
  let joints = 0;
  segments.forEach((_, i) => {
    if (effective[i] <= 0) {
      audioStart[i] = offset;
      audioEnd[i] = offset;
      return;
    }
    const start = joints > 0 ? Math.max(0, offset - xfade) : offset;
    audioStart[i] = start;
    audioEnd[i] = start + effective[i];
    offset = audioEnd[i];
    joints++;
  });
  const totalDuration = offset;

  // Pass 2: one boundary per joint, at the midpoint of the overlap.
  const audible = segments.map((_, i) => i).filter((i) => effective[i] > 0);
  const boundaries: number[] = [0];
  for (let k = 1; k < audible.length; k++) {
    const midpoint = (audioEnd[audible[k - 1]] + audioStart[audible[k]]) / 2;
    // Stay monotonic even when a segment is shorter than the crossfade.
    boundaries.push(
      Math.min(totalDuration, Math.max(boundaries[k - 1], midpoint)),
    );
  }
  boundaries.push(Math.max(boundaries[boundaries.length - 1], totalDuration));

  const spans: SegmentSpan[] = [];
  let k = 0;
  let cursor = 0;
  segments.forEach((_, i) => {
    if (effective[i] <= 0) {
      spans.push({ index: i, start: cursor, end: cursor, duration: 0 });
      return;
    }
    const start = boundaries[k];
    const end = boundaries[k + 1];
    spans.push({ index: i, start, end, duration: end - start });
    cursor = end;
    k++;
  });

  return { spans, totalDuration };
}
