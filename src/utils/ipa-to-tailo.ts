/**
 * Convert IPA phonetic notation (from Kaldi decode lexicon) to Tailo romanization.
 *
 * Ported from: tools/taigi-glosser/ipa_to_tailo.py
 *
 * Public API:
 *   ipaToTailo(ipaStr) -> string
 *   TW_TONE             -> RegExp matching 19xx tone codes
 */

/** Matches 19xx tone codes used in Taiwanese lexicon entries. */
export const TW_TONE = /19\d\d/;

const TONE_RE = /19(\d\d)/;

// --- Chao tone values → Taiwanese tone numbers ---

const TONE_MAP_OPEN: Record<string, number> = {
  "55": 1, "51": 2, "21": 3, "24": 5, "33": 7,
};
const TONE_MAP_CHECKED: Record<string, number> = {
  "21": 4, "53": 8, "55": 4, "51": 4, "24": 8, "33": 8,
};

// --- IPA consonant → Tailo (order matters for greedy match) ---

const ONSET_MAP: [string, string][] = [
  ["tɕʰ", "tsh"], ["tsʰ", "tsh"], ["tɕ", "ts"], ["pʰ", "ph"],
  ["tʰ", "th"], ["kʰ", "kh"], ["ts", "ts"], ["dz", "j"],
  ["ɕ", "s"], ["b", "b"], ["p", "p"], ["m", "m"], ["t", "t"],
  ["n", "n"], ["l", "l"], ["k", "k"], ["g", "g"], ["ŋ", "ng"],
  ["h", "h"], ["s", "s"],
];

// --- IPA vowels → Tailo (nasalized vowels use base form; nn appended at end) ---

const VOWEL_MAP: Record<string, string> = {
  "a": "a", "aⁿ": "a", "i": "i", "iⁿ": "i",
  "u": "u", "uⁿ": "u", "o": "o", "oⁿ": "o",
  "ɛ": "e", "ɛⁿ": "e", "ə": "o",
  "ɨ": "ir", "ɨⁿ": "ir",
  "m̩": "m", "ŋ̩": "ng",
  "ɛɛ": "ee",
};
const NASAL_VOWELS = new Set(["aⁿ", "iⁿ", "uⁿ", "oⁿ", "ɛⁿ", "ɨⁿ"]);

// --- Coda consonant → Tailo ---

const CODA_MAP: Record<string, string> = {
  "m": "m", "n": "n", "ŋ": "ng", "p": "p", "t": "t", "k": "k", "ʔ": "h",
};
const CODA_SET = new Set(Object.keys(CODA_MAP));
const VOWEL_SET = new Set(Object.keys(VOWEL_MAP));
const STOP_CODAS = new Set(["p", "t", "k", "ʔ"]);

// --- Internal types ---

type Phone = [string, string | null]; // [phoneme, toneCode | null]
type Syllable = [Phone[], string | null]; // [phones, toneCode]

// --- Internal helpers ---

function parseIpaPhones(ipaStr: string): Phone[] {
  const phones: Phone[] = [];
  for (const token of ipaStr.split(/\s+/)) {
    if (!token) continue;
    const m = TONE_RE.exec(token);
    if (m) {
      const clean = token.replace(TONE_RE, "");
      phones.push([clean, m[1]]);
    } else {
      phones.push([token, null]);
    }
  }
  return phones;
}

function syllabify(phones: Phone[]): Syllable[] {
  const syllables: Syllable[] = [];
  let current: Phone[] = [];
  let currentTone: string | null = null;
  let hasNucleus = false;

  function flush(onset: Phone[] = []): void {
    if (current.length > 0) {
      syllables.push([current, currentTone]);
    }
    current = [...onset];
    currentTone = null;
    hasNucleus = false;
  }

  function splitCodaOnset(): Phone[] {
    // Pop trailing consonants (no tone); split into coda (max 1) + onset.
    const tail: Phone[] = [];
    while (current.length > 0 && current[current.length - 1][1] === null) {
      tail.unshift(current.pop()!);
    }
    if (tail.length <= 1) {
      return tail; // single consonant → onset
    }
    // 2+ consonants: first is coda if valid, rest is onset
    if (CODA_SET.has(tail[0][0])) {
      current.push(tail[0]);
      return tail.slice(1);
    }
    return tail;
  }

  for (let i = 0; i < phones.length; i++) {
    const [ph, tone] = phones[i];

    if (tone !== null) {
      // Vowel with tone
      if (currentTone !== null && tone !== currentTone) {
        // Different tone = definitely new syllable
        const onset = splitCodaOnset();
        flush(onset);
      } else if (
        hasNucleus &&
        current.length > 0 &&
        current[current.length - 1][1] === null
      ) {
        // Same tone, but consonant between vowels = new syllable
        const onset = splitCodaOnset();
        flush(onset);
      }

      current.push([ph, tone]);
      currentTone = tone;
      hasNucleus = true;
    } else {
      current.push([ph, null]);
    }
  }

  if (current.length > 0) {
    syllables.push([current, currentTone]);
  }
  return syllables;
}

function convertSyllable(phones: Phone[], toneCode: string | null): string {
  const phonemes = phones.map(([ph]) => ph);

  // Find first and last vowel indices
  let firstV: number | null = null;
  let lastV: number | null = null;
  for (let i = 0; i < phonemes.length; i++) {
    if (VOWEL_SET.has(phonemes[i])) {
      if (firstV === null) firstV = i;
      lastV = i;
    }
  }

  const parts: string[] = [];
  let hasStopCoda = false;

  for (let i = 0; i < phonemes.length; i++) {
    const ph = phonemes[i];
    if (VOWEL_SET.has(ph)) {
      parts.push(VOWEL_MAP[ph]);
    } else if (firstV !== null && i < firstV) {
      // Onset consonant (before first vowel)
      if (ph === "ʔ") continue; // ʔ as onset is silent
      let mapped = ph;
      for (const [ipa, tailo] of ONSET_MAP) {
        if (ph === ipa) { mapped = tailo; break; }
      }
      parts.push(mapped);
    } else if (lastV !== null && i > lastV) {
      // Coda consonant (after last vowel)
      parts.push(CODA_MAP[ph] ?? ph);
      if (STOP_CODAS.has(ph)) hasStopCoda = true;
    } else {
      // Syllabic consonant (no vowel in syllable) or between vowels
      if (VOWEL_SET.has(ph)) {
        parts.push(VOWEL_MAP[ph]);
      } else if (ph in CODA_MAP) {
        parts.push(CODA_MAP[ph]);
      } else {
        let mapped = ph;
        for (const [ipa, tailo] of ONSET_MAP) {
          if (ph === ipa) { mapped = tailo; break; }
        }
        parts.push(mapped);
      }
    }
  }

  let tailo = parts.join("");

  // Handle ɛ → ia before n/t (ɛn→ian, ɛt→iat)
  tailo = tailo.replace(/e(n|t)$/, "ia$1");

  // Append nn for nasalized vowels
  const hasNasal = phones.some(([ph]) => NASAL_VOWELS.has(ph));
  if (hasNasal) {
    if (hasStopCoda && tailo.length > 0 && "hptk".includes(tailo[tailo.length - 1])) {
      tailo = tailo.slice(0, -1) + "nn" + tailo[tailo.length - 1];
    } else if (tailo.endsWith("ng")) {
      tailo = tailo.slice(0, -2) + "nn" + "ng";
    } else if (tailo.endsWith("m")) {
      tailo = tailo.slice(0, -1) + "nn" + "m";
    } else if (tailo.endsWith("n")) {
      tailo = tailo.slice(0, -1) + "nn" + "n";
    } else {
      tailo += "nn";
    }
  }

  // Add tone number
  if (toneCode) {
    const toneNum = hasStopCoda
      ? (TONE_MAP_CHECKED[toneCode] ?? "?")
      : (TONE_MAP_OPEN[toneCode] ?? "?");
    tailo += String(toneNum);
  }

  return tailo;
}

// --- Numeric tone → diacritic conversion ---

// Combining diacritics for each tone number
const TONE_DIACRITICS: Record<number, string> = {
  // 1: unmarked
  2: "\u0301", // combining acute accent  ́
  3: "\u0300", // combining grave accent  ̀
  // 4: unmarked (checked syllable)
  5: "\u0302", // combining circumflex  ̂
  7: "\u0304", // combining macron  ̄
  8: "\u030D", // combining vertical line above  ̍
  9: "\u0306", // combining breve  ̆
};

const TAILO_VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Find the index in `syllable` where the tone diacritic should be placed.
 *
 * Rules (standard Tâi-lô):
 *   1. If 'a' or 'e' is present → mark it
 *   2. If 'oo' is present → mark the first 'o'
 *   3. If 'o' is present → mark it
 *   4. Otherwise → mark the last vowel (i or u)
 */
function findTonePosition(syllable: string): number {
  const lower = syllable.toLowerCase();

  // Rule 1: a or e
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === "a" || lower[i] === "e") return i;
  }

  // Rule 2 & 3: o (handles both 'oo' and single 'o')
  const oIdx = lower.indexOf("o");
  if (oIdx !== -1) return oIdx;

  // Rule 4: last vowel (i or u)
  for (let i = lower.length - 1; i >= 0; i--) {
    if (lower[i] === "i" || lower[i] === "u") return i;
  }

  return -1;
}

/**
 * Convert a single numeric-tone Tailo syllable to diacritic form.
 * e.g., "tsik8" → "tsi̍k", "gua7" → "guā", "tse3" → "tsè"
 *
 * Also converts "oo" → "o͘" (o + combining dot above right).
 */
function syllableToDiacritic(syllable: string): string {
  // Extract trailing tone number
  const m = syllable.match(/^(.+?)(\d)$/);
  if (!m) {
    // No tone number — convert oo → o͘ only
    return syllable.replace(/oo/g, "o\u0358");
  }

  let base = m[1];
  const tone = parseInt(m[2], 10);

  // Convert "oo" → "o͘" (o + combining dot above right U+0358)
  base = base.replace(/oo/g, "o\u0358");

  // Tones 1 and 4: no diacritic
  const diacritic = TONE_DIACRITICS[tone];
  if (!diacritic) return base;

  // Find the vowel to place the diacritic on
  const pos = findTonePosition(base);
  if (pos === -1) return base;

  // Insert combining diacritic after the vowel character
  // (need to account for combining chars already present, e.g., o͘)
  // Find the end of the base character at `pos` (skip any existing combining chars)
  let insertAt = pos + 1;
  while (insertAt < base.length && base.charCodeAt(insertAt) >= 0x0300 && base.charCodeAt(insertAt) <= 0x036F) {
    insertAt++;
  }

  return base.slice(0, insertAt) + diacritic + base.slice(insertAt);
}

/**
 * Convert numeric-tone Tailo string to diacritic form.
 * Handles multi-syllable strings joined by "-".
 * e.g., "gua7-tse3" → "guā-tsè"
 */
export function tailoNumericToDiacritic(tailo: string): string {
  return tailo
    .split("-")
    .map(syllableToDiacritic)
    .join("-");
}

// --- Public API ---

/** Convert decode-lexicon IPA string to Tailo romanization (with diacritics). */
export function ipaToTailo(ipaStr: string): string {
  const phones = parseIpaPhones(ipaStr);
  if (phones.length === 0) return ipaStr;

  const syllables = syllabify(phones);
  const parts: string[] = [];
  for (const [sylPhones, toneCode] of syllables) {
    parts.push(convertSyllable(sylPhones, toneCode));
  }
  // Convert numeric tones to diacritics: "tsik8" → "tsi̍k"
  return tailoNumericToDiacritic(parts.join("-"));
}
