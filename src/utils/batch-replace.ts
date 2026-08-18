/**
 * Batch find & replace over segment texts.
 *
 * Pure helpers — no store access. All matching is literal (no regex,
 * case-sensitive) since the primary use case is swapping Chinese
 * characters/words (e.g. 你 → 汝) across a whole project.
 *
 * Only `segment.text` is considered; word segmentation / Tailo state is
 * intentionally left alone (mirrors manual per-segment text editing).
 */

import type { SentenceState } from "../stores/project-store";

export interface ReplaceMatch {
  sentenceIndex: number;
  segmentIndex: number;
  /** Segment text before replacement. */
  before: string;
  /** Segment text after replacing every occurrence. */
  after: string;
  /** Number of occurrences of the search term inside this segment. */
  count: number;
}

export interface SegmentTextEdit {
  sentenceIndex: number;
  segmentIndex: number;
  text: string;
}

export interface SelectionSummary {
  /** Total matched segments (regardless of selection). */
  totalMatches: number;
  /** Total occurrences across all matched segments. */
  totalOccurrences: number;
  /** Selected segments that will be edited. */
  selectedSegments: number;
  /** Distinct sentences touched by the selection. */
  selectedSentences: number;
  /** Selected sentences whose current status is "approved". */
  approvedSentences: number;
  /** Sorted distinct sentence indices touched by the selection. */
  sentenceIndices: number[];
}

export function matchKey(m: { sentenceIndex: number; segmentIndex: number }): string {
  return `${m.sentenceIndex}:${m.segmentIndex}`;
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  for (;;) {
    const idx = text.indexOf(needle, pos);
    if (idx === -1) return count;
    count++;
    pos = idx + needle.length;
  }
}

/** Literal replace-all: no regex, no `$` substitution patterns. */
export function replaceAllLiteral(text: string, needle: string, replacement: string): string {
  if (!needle) return text;
  return text.split(needle).join(replacement);
}

/**
 * Split text into alternating [plain, match, plain, match, ..., plain] parts.
 * Even indices are plain text, odd indices are the matched term.
 * Useful for rendering highlighted previews.
 */
export function splitByTerm(text: string, needle: string): string[] {
  if (!needle) return [text];
  const plain = text.split(needle);
  const out: string[] = [];
  plain.forEach((p, i) => {
    out.push(p);
    if (i < plain.length - 1) out.push(needle);
  });
  return out;
}

export function findReplaceMatches(
  sentences: SentenceState[],
  find: string,
  replaceWith: string,
  scope: { sentenceIndex?: number } = {},
): ReplaceMatch[] {
  if (!find) return [];
  const matches: ReplaceMatch[] = [];
  for (const s of sentences) {
    if (scope.sentenceIndex != null && s.index !== scope.sentenceIndex) continue;
    if (!s.pipeline) continue;
    s.pipeline.segments.forEach((seg, segmentIndex) => {
      const count = countOccurrences(seg.text, find);
      if (count === 0) return;
      matches.push({
        sentenceIndex: s.index,
        segmentIndex,
        before: seg.text,
        after: replaceAllLiteral(seg.text, find, replaceWith),
        count,
      });
    });
  }
  return matches;
}

export function summarizeSelection(
  matches: ReplaceMatch[],
  selectedKeys: Set<string>,
  sentences: SentenceState[],
): SelectionSummary {
  const sentenceSet = new Set<number>();
  let selectedSegments = 0;
  let totalOccurrences = 0;
  for (const m of matches) {
    totalOccurrences += m.count;
    if (!selectedKeys.has(matchKey(m))) continue;
    selectedSegments++;
    sentenceSet.add(m.sentenceIndex);
  }
  const sentenceIndices = [...sentenceSet].sort((a, b) => a - b);
  const approvedSentences = sentenceIndices.filter(
    (i) => sentences.find((s) => s.index === i)?.status === "approved",
  ).length;
  return {
    totalMatches: matches.length,
    totalOccurrences,
    selectedSegments,
    selectedSentences: sentenceIndices.length,
    approvedSentences,
    sentenceIndices,
  };
}

/** Convert selected matches into store edits. */
export function toSegmentEdits(matches: ReplaceMatch[], selectedKeys: Set<string>): SegmentTextEdit[] {
  return matches
    .filter((m) => selectedKeys.has(matchKey(m)))
    .map((m) => ({ sentenceIndex: m.sentenceIndex, segmentIndex: m.segmentIndex, text: m.after }));
}
