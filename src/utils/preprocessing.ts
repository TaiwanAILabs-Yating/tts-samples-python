// Segmentation mode constants
export const SEGMENT_MODE_RAW = "raw" as const; // No splitting, send text as-is
export const SEGMENT_MODE_SENTENCE = "sentence" as const; // Split on sentence endings: 。.？！?!
export const SEGMENT_MODE_CLAUSE = "clause" as const; // Split on sentence + clause endings

export type SegmentMode =
  | typeof SEGMENT_MODE_RAW
  | typeof SEGMENT_MODE_SENTENCE
  | typeof SEGMENT_MODE_CLAUSE;

// Punctuation patterns for stripping
// Leading: remove all punctuation from start
const LEADING_PUNCTUATION =
  /^[。.？?！!，,、；;：:「」『』（）()\[\]【】\s]+/;
// Trailing: remove punctuation including period (keep ！？)
const TRAILING_PUNCTUATION =
  /[。.，,、；;：:「」『』（）()\[\]【】\s]+$/;

/**
 * Preprocess text by removing line number prefixes and joining lines.
 */
export function preprocessText(text: string): string {
  const lines = text.split("\n");

  const cleanedLines: string[] = [];
  for (const line of lines) {
    // Remove line number prefix (pattern: "     N→")
    const cleaned = line.replace(/^\s*\d+→/, "").trim();
    if (cleaned) {
      cleanedLines.push(cleaned);
    }
  }

  return cleanedLines.join(" ");
}

/**
 * Strip punctuation from text edges.
 * - Leading: remove all punctuation
 * - Trailing: remove punctuation including period (keep ！？)
 */
export function stripPunctuation(text: string): string {
  text = text.replace(LEADING_PUNCTUATION, "");
  text = text.replace(TRAILING_PUNCTUATION, "");
  return text;
}

/**
 * Count tokens in text.
 * - Chinese character: 1 token
 * - English word: 1.5 tokens (fixed average)
 */
export function countTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + Math.floor(englishWords * 1.5);
}

/**
 * Force split text by character when no punctuation is available.
 * Each segment is guaranteed <= maxTokens.
 */
export function forceSplitByChar(
  text: string,
  maxTokens: number
): string[] {
  const result: string[] = [];
  let current = "";

  for (const char of text) {
    if (countTokens(current + char) <= maxTokens) {
      current += char;
    } else {
      if (current) {
        result.push(current);
      }
      current = char;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
}

/**
 * Ensure text is split into segments where each segment <= maxTokens.
 *
 * Strategy:
 * 1. If text already <= maxTokens, return as-is
 * 2. Try splitting by clause punctuation (，,、；;)
 * 3. If any part still > maxTokens, force split by character
 */
export function ensureMaxTokens(
  text: string,
  maxTokens: number
): string[] {
  if (countTokens(text) <= maxTokens) {
    return [text];
  }

  // Split by clause punctuation, keeping delimiters
  const parts = text.split(/([，,、；;])/);

  const result: string[] = [];
  let current = "";

  for (const part of parts) {
    if (countTokens(current + part) <= maxTokens) {
      current += part;
    } else {
      if (current) {
        if (countTokens(current) > maxTokens) {
          result.push(...forceSplitByChar(current, maxTokens));
        } else {
          result.push(current);
        }
      }
      current = part;
    }
  }

  if (current) {
    if (countTokens(current) > maxTokens) {
      result.push(...forceSplitByChar(current, maxTokens));
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * Balance segment token counts with hard maxTokens limit and soft minTokens target.
 *
 * Algorithm:
 * 1. First ensure all segments <= maxTokens (using ensureMaxTokens)
 * 2. Greedy merge: combine adjacent segments if combined <= maxTokens
 * 3. Post-process: if last segment is too short, try merging with previous
 */
export function balanceSegments(
  segments: string[],
  minTokens: number = 10,
  maxTokens: number = 40
): string[] {
  if (!segments.length) {
    return segments;
  }

  // Step 1: Ensure all segments are <= maxTokens
  const atomic: string[] = [];
  for (const seg of segments) {
    atomic.push(...ensureMaxTokens(seg, maxTokens));
  }

  if (!atomic.length) {
    return [];
  }

  if (atomic.length === 1) {
    return atomic;
  }

  // Step 2: Greedy merge - only combine if won't exceed maxTokens
  const result: string[] = [];
  let current = "";
  let currentTokens = 0;

  for (const piece of atomic) {
    const pieceTokens = countTokens(piece);

    if (currentTokens + pieceTokens <= maxTokens) {
      current += piece;
      currentTokens += pieceTokens;
    } else {
      if (current) {
        result.push(current);
      }
      current = piece;
      currentTokens = pieceTokens;
    }
  }

  if (current) {
    result.push(current);
  }

  // Step 3: Post-process - handle short last segment
  if (result.length >= 2) {
    const lastTokens = countTokens(result[result.length - 1]);
    if (lastTokens < minTokens) {
      const combined =
        result[result.length - 2] + result[result.length - 1];
      if (countTokens(combined) <= maxTokens) {
        result.splice(-2, 2, combined);
      }
    }
  }

  return result;
}

/**
 * Split text into sentences based on punctuation and segmentation mode.
 *
 * @param text - Input text string
 * @param mode - Segmentation mode: "raw", "sentence", or "clause"
 * @param minTokens - Soft minimum tokens per segment (default 10)
 * @param maxTokens - Hard maximum tokens per segment (default 40)
 */
export function splitSentences(
  text: string,
  mode: SegmentMode = SEGMENT_MODE_SENTENCE,
  minTokens: number = 10,
  maxTokens: number = 40
): string[] {
  // Raw mode: no splitting
  if (mode === SEGMENT_MODE_RAW) {
    return [text];
  }

  // Define delimiter pattern based on mode
  const delimiterPattern =
    mode === SEGMENT_MODE_CLAUSE
      ? /[。.？?！!，,、；;]/
      : /[。.？?！!]/;

  // Split on spaces/tabs between Chinese characters
  text = text.replace(
    /([\u4e00-\u9fff])[\s\u3000]+([\u4e00-\u9fff])/g,
    "$1\n$2"
  );

  // Split on newlines to get segments
  const segments = text.split("\n");

  let sentences: string[] = [];
  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }

    // Further split each segment on delimiters, preserving punctuation
    const parts = segment.split(
      new RegExp(`(${delimiterPattern.source})`)
    );

    const subSentences: string[] = [];
    for (const part of parts) {
      if (!part) {
        continue;
      }
      if (delimiterPattern.test(part)) {
        // This is a delimiter, append to previous sentence
        if (subSentences.length) {
          subSentences[subSentences.length - 1] += part;
        }
      } else {
        subSentences.push(part);
      }
    }

    if (subSentences.length) {
      sentences.push(
        ...subSentences.map((s) => s.trim()).filter((s) => s)
      );
    } else {
      sentences.push(segment);
    }
  }

  // Balance segments in sentence mode
  if (mode === SEGMENT_MODE_SENTENCE) {
    sentences = balanceSegments(sentences, minTokens, maxTokens);
  }

  // Clean up: strip leading/trailing punctuation from each segment
  sentences = sentences
    .map((s) => stripPunctuation(s))
    .filter((s) => s);

  return sentences;
}

/**
 * Generate utterance ID with zero-padded index.
 *
 * @param basename - Base name for utterance IDs
 * @param index - Sentence index (0-based)
 * @returns Formatted utterance ID (e.g., "basename_00001")
 */
export function generateUttId(basename: string, index: number): string {
  return `${basename}_${String(index).padStart(5, "0")}`;
}
