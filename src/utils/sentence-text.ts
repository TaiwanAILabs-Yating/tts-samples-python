/**
 * Map punctuation-stripped TTS segments back to spans of the user's original
 * text, so sentence display / metadata can keep the original punctuation.
 *
 * Background: `splitSentences()` strips each segment's leading/trailing
 * punctuation for TTS input quality. A segment's characters therefore appear
 * in the original text in order (internal characters are untouched), which
 * lets us recover each segment's span with an ordered character walk.
 */

import { replaceAllLiteral } from "./batch-replace";

export interface Span {
  /** Index of the first matched character (inclusive). */
  start: number;
  /** Index after the last matched character (exclusive). */
  end: number;
}

/** Closing punctuation that belongs to the preceding sentence chunk. */
const CLOSING_PUNCT = /[。．.！!？?，,、；;：:」』）)”’›》〉…—～~·]/;
/** Opening punctuation that belongs to the following sentence chunk. */
const OPENING_PUNCT = /[「『（(“‘‹《〈［[【]/;

/**
 * Find each segment's span inside `source` by ordered character matching,
 * starting the walk of each segment where the previous one ended.
 * Returns null if any segment character cannot be found in order.
 */
export function findSegmentSpans(source: string, segments: string[]): Span[] | null {
  const spans: Span[] = [];
  let p = 0;
  for (const seg of segments) {
    let start = -1;
    let end = -1;
    for (const ch of seg) {
      const idx = source.indexOf(ch, p);
      if (idx === -1) return null;
      if (start === -1) start = idx;
      end = idx + 1;
      p = idx + 1;
    }
    if (start === -1) {
      // Empty segment — zero-width span at current position.
      start = p;
      end = p;
    }
    spans.push({ start, end });
  }
  return spans;
}

/**
 * Recover the original text chunk for each sentence group (Direct Input mode).
 *
 * Each group of segments maps to a contiguous region of `source`; boundaries
 * are extended so closing punctuation (。！？」…) stays with the chunk before
 * it and opening punctuation (「（…) with the chunk after it. Whitespace
 * between chunks is attached to the preceding chunk so chunks concatenate
 * back to the full source.
 *
 * Falls back to `group.join("")` (previous behavior) for any group whose
 * segments cannot be matched.
 */
export function extractOriginalSentenceTexts(
  source: string,
  groups: string[][],
): string[] {
  const flat = groups.flat();
  const spans = findSegmentSpans(source, flat);
  if (!spans) {
    return groups.map((g) => g.join(""));
  }

  // Compute each group's raw span from its first/last segment spans.
  const bounds: Span[] = [];
  let flatIdx = 0;
  for (const g of groups) {
    if (g.length === 0) {
      bounds.push({ start: -1, end: -1 });
      continue;
    }
    const start = spans[flatIdx].start;
    const end = spans[flatIdx + g.length - 1].end;
    bounds.push({ start, end });
    flatIdx += g.length;
  }

  // Extend boundaries: each cut point sits between prev.end and next.start.
  // Pull opening punctuation back to the next chunk, then give everything
  // else (closing punctuation + whitespace) to the preceding chunk.
  const texts: string[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    if (b.start === -1) {
      texts.push("");
      continue;
    }
    let start: number;
    if (i === 0) {
      start = 0;
    } else {
      start = b.start;
      while (start > 0 && OPENING_PUNCT.test(source[start - 1])) start--;
    }
    let end: number;
    const next = bounds.slice(i + 1).find((nb) => nb.start !== -1);
    if (!next) {
      end = source.length;
    } else {
      end = next.start;
      while (end > b.end && OPENING_PUNCT.test(source[end - 1])) end--;
    }
    texts.push(source.slice(start, end));
  }
  return texts;
}

/**
 * Apply a literal find→replace to a sentence's original text, but only inside
 * the spans that correspond to the selected segments (batch replace honors
 * per-segment selection). Punctuation between spans is left untouched.
 *
 * `oldSegmentTexts` must be the segment texts BEFORE the replacement.
 * Falls back to whole-text replace when spans cannot be matched (e.g. a
 * segment was manually edited and diverged from the sentence text).
 */
export function replaceInSentenceText(
  sentenceText: string,
  oldSegmentTexts: string[],
  selectedSegmentIndices: Set<number>,
  find: string,
  replaceWith: string,
): string {
  if (selectedSegmentIndices.size === 0 || !find) return sentenceText;

  const spans = findSegmentSpans(sentenceText, oldSegmentTexts);
  if (!spans) {
    return replaceAllLiteral(sentenceText, find, replaceWith);
  }

  let out = "";
  let cursor = 0;
  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i];
    out += sentenceText.slice(cursor, start);
    const piece = sentenceText.slice(start, end);
    out += selectedSegmentIndices.has(i)
      ? replaceAllLiteral(piece, find, replaceWith)
      : piece;
    cursor = end;
  }
  out += sentenceText.slice(cursor);
  return out;
}
