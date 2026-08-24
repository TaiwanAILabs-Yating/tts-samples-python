/**
 * Single builder for the initial `SentenceState[]` of a project.
 *
 * Both entry points into a project — SetupPage's "Create & Generate" and
 * WorkspacePage's on-mount build (for projects restored with rawText but no
 * sentences) — must produce identical state. They used to duplicate this
 * logic, which is how `sentence.text` ended up losing the user's punctuation
 * on the Setup path after only the Workspace path was fixed.
 *
 * Invariant: segments carry the punctuation-stripped TTS input, while
 * `sentence.text` carries the user's original text verbatim.
 */

import type { SentenceState } from "../stores/project-store";
import type { PipelineState, SegmentState } from "../services/tts-orchestrator";
import { extractOriginalSentenceTexts } from "./sentence-text";

export type OriginalTextSource =
  /** Direct Input: one long text that segment groups map back into. */
  | { mode: "direct"; rawText: string }
  /** Upload File: each non-empty line is one sentence, already verbatim. */
  | { mode: "upload"; lines: string[] };

/**
 * @param groups - Segment texts per sentence, as produced by
 *   `splitDirectInputIntoSentences()` (direct) or per-line `splitSentences()`
 *   (upload).
 * @param source - Where to recover each sentence's original text from.
 */
export function buildSentenceStates(
  groups: string[][],
  source: OriginalTextSource,
): SentenceState[] {
  const originalTexts =
    source.mode === "upload"
      ? source.lines
      : extractOriginalSentenceTexts(source.rawText, groups);

  return groups.map((segs, i) => {
    const segments: SegmentState[] = segs.map((text, si) => ({
      index: si,
      text,
      status: "pending" as const,
      attempts: 0,
      history: [],
    }));
    const pipeline: PipelineState = { segments };
    return {
      index: i,
      text: originalTexts[i]?.trim() || segs.join(""),
      status: "pending" as const,
      pipeline,
    };
  });
}
