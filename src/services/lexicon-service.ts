/**
 * Lexicon service: word segmentation + Tailo romanization.
 *
 * Provides 3 APIs:
 *   1. segmentWords(sentence) — backward maximum match word segmentation
 *   2. toTailo(words) — Tailo romanization lookup (returns all pronunciations)
 *   3. validateWords(words) — vocabulary membership check
 */

// --- Types ---

export interface WordToken {
  word: string;
  /** All Tailo pronunciations for this word, empty array if OOV. */
  tailoList: string[];
}

export interface ValidationResult {
  word: string;
  inVocab: boolean;
}

export interface LexiconService {
  readonly isLoaded: boolean;
  readonly vocabSize: number;

  /** API 1: 給一個中文 sentence，切成 words sequence */
  segmentWords(sentence: string): string[];

  /** API 2: 給一組合法的 words sequence，輸出台羅拼音（所有候選發音） */
  toTailo(words: string[]): WordToken[];

  /** API 3: 給一組 words sequence，檢查每個 word 是否在 vocabulary 中 */
  validateWords(words: string[]): ValidationResult[];
}

// --- Unicode punctuation detection ---

/**
 * Check if a character is a punctuation character.
 * Covers CJK punctuation, general punctuation, and ASCII punctuation.
 */
function isPunctuation(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;

  // ASCII punctuation
  if (
    (code >= 0x21 && code <= 0x2f) || // ! " # $ % & ' ( ) * + , - . /
    (code >= 0x3a && code <= 0x40) || // : ; < = > ? @
    (code >= 0x5b && code <= 0x60) || // [ \ ] ^ _ `
    (code >= 0x7b && code <= 0x7e)    // { | } ~
  ) return true;

  // CJK punctuation & symbols
  if (code >= 0x3000 && code <= 0x303f) return true;
  // Fullwidth punctuation
  if (code >= 0xff01 && code <= 0xff0f) return true;
  if (code >= 0xff1a && code <= 0xff20) return true;
  if (code >= 0xff3b && code <= 0xff40) return true;
  if (code >= 0xff5b && code <= 0xff65) return true;
  // General punctuation block
  if (code >= 0x2000 && code <= 0x206f) return true;

  return false;
}

// --- Implementation ---

class LexiconServiceImpl implements LexiconService {
  private vocab: Set<string>;
  private tailoMap: Map<string, string[]>;
  private maxLen: number;

  constructor(data: Record<string, string[]>) {
    this.tailoMap = new Map(Object.entries(data));
    this.vocab = new Set(this.tailoMap.keys());
    this.maxLen = 1;
    for (const word of this.vocab) {
      if (word.length > this.maxLen) this.maxLen = word.length;
    }
  }

  get isLoaded(): boolean {
    return true;
  }

  get vocabSize(): number {
    return this.vocab.size;
  }

  segmentWords(sentence: string): string[] {
    const text = sentence;
    const tokens: string[] = [];
    let i = text.length;

    while (i > 0) {
      const ch = text[i - 1];

      // Skip whitespace
      if (/\s/.test(ch)) {
        i--;
        continue;
      }

      // Punctuation as individual token
      if (isPunctuation(ch)) {
        tokens.push(ch);
        i--;
        continue;
      }

      // Backward maximum match
      let matched = false;
      const maxTry = Math.min(this.maxLen, i);
      for (let length = maxTry; length > 0; length--) {
        const candidate = text.slice(i - length, i);
        if (this.vocab.has(candidate)) {
          tokens.push(candidate);
          i -= length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Single character fallback (OOV)
        tokens.push(ch);
        i--;
      }
    }

    tokens.reverse();
    return tokens;
  }

  toTailo(words: string[]): WordToken[] {
    return words.map((word) => ({
      word,
      tailoList: this.tailoMap.get(word) ?? [],
    }));
  }

  validateWords(words: string[]): ValidationResult[] {
    return words.map((word) => ({
      word,
      inVocab: this.vocab.has(word),
    }));
  }
}

/**
 * Create a LexiconService from pre-processed JSON data.
 * The data should be Record<string, string[]> mapping words to Tailo pronunciation arrays.
 */
export function createLexiconService(data: Record<string, string[]>): LexiconService {
  return new LexiconServiceImpl(data);
}
