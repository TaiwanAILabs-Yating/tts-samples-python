#!/usr/bin/env npx tsx
/**
 * Preprocess raw decode lexicon into compact JSON for frontend use.
 *
 * Usage:
 *   npx tsx scripts/preprocess-lexicon.ts /path/to/lexicon.txt [output-path]
 *
 * Input:  TSV file with lines like "一\ttɕ i1953 k"
 * Output: public/lexicon-nan.json — { "一": "tsik8", ... }
 *
 * Only entries containing 19xx tone codes (Taiwanese) are included.
 * First pronunciation per word wins (dedup).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// --- Inline IPA→Tailo conversion (same logic as src/utils/ipa-to-tailo.ts) ---

const TONE_RE = /19(\d\d)/;
const TW_TONE = /19\d\d/;

const TONE_MAP_OPEN: Record<string, number> = {
  "55": 1, "51": 2, "21": 3, "24": 5, "33": 7,
};
const TONE_MAP_CHECKED: Record<string, number> = {
  "21": 4, "53": 8, "55": 4, "51": 4, "24": 8, "33": 8,
};

const ONSET_MAP: [string, string][] = [
  ["tɕʰ", "tsh"], ["tsʰ", "tsh"], ["tɕ", "ts"], ["pʰ", "ph"],
  ["tʰ", "th"], ["kʰ", "kh"], ["ts", "ts"], ["dz", "j"],
  ["ɕ", "s"], ["b", "b"], ["p", "p"], ["m", "m"], ["t", "t"],
  ["n", "n"], ["l", "l"], ["k", "k"], ["g", "g"], ["ŋ", "ng"],
  ["h", "h"], ["s", "s"],
];

const VOWEL_MAP: Record<string, string> = {
  "a": "a", "aⁿ": "a", "i": "i", "iⁿ": "i",
  "u": "u", "uⁿ": "u", "o": "o", "oⁿ": "o",
  "ɛ": "e", "ɛⁿ": "e", "ə": "o",
  "ɨ": "ir", "ɨⁿ": "ir",
  "m̩": "m", "ŋ̩": "ng",
  "ɛɛ": "ee",
};
const NASAL_VOWELS = new Set(["aⁿ", "iⁿ", "uⁿ", "oⁿ", "ɛⁿ", "ɨⁿ"]);
const CODA_MAP: Record<string, string> = {
  "m": "m", "n": "n", "ŋ": "ng", "p": "p", "t": "t", "k": "k", "ʔ": "h",
};
const CODA_SET = new Set(Object.keys(CODA_MAP));
const VOWEL_SET = new Set(Object.keys(VOWEL_MAP));
const STOP_CODAS = new Set(["p", "t", "k", "ʔ"]);

type Phone = [string, string | null];

function parseIpaPhones(ipaStr: string): Phone[] {
  const phones: Phone[] = [];
  for (const token of ipaStr.split(/\s+/)) {
    if (!token) continue;
    const m = TONE_RE.exec(token);
    if (m) {
      phones.push([token.replace(TONE_RE, ""), m[1]]);
    } else {
      phones.push([token, null]);
    }
  }
  return phones;
}

function syllabify(phones: Phone[]): [Phone[], string | null][] {
  const syllables: [Phone[], string | null][] = [];
  let current: Phone[] = [];
  let currentTone: string | null = null;
  let hasNucleus = false;

  function flush(onset: Phone[] = []): void {
    if (current.length > 0) syllables.push([current, currentTone]);
    current = [...onset];
    currentTone = null;
    hasNucleus = false;
  }

  function splitCodaOnset(): Phone[] {
    const tail: Phone[] = [];
    while (current.length > 0 && current[current.length - 1][1] === null) {
      tail.unshift(current.pop()!);
    }
    if (tail.length <= 1) return tail;
    if (CODA_SET.has(tail[0][0])) {
      current.push(tail[0]);
      return tail.slice(1);
    }
    return tail;
  }

  for (let i = 0; i < phones.length; i++) {
    const [ph, tone] = phones[i];
    if (tone !== null) {
      if (currentTone !== null && tone !== currentTone) {
        flush(splitCodaOnset());
      } else if (hasNucleus && current.length > 0 && current[current.length - 1][1] === null) {
        flush(splitCodaOnset());
      }
      current.push([ph, tone]);
      currentTone = tone;
      hasNucleus = true;
    } else {
      current.push([ph, null]);
    }
  }
  if (current.length > 0) syllables.push([current, currentTone]);
  return syllables;
}

function convertSyllable(phones: Phone[], toneCode: string | null): string {
  const phonemes = phones.map(([ph]) => ph);
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
      if (ph === "ʔ") continue;
      let mapped = ph;
      for (const [ipa, tailo] of ONSET_MAP) {
        if (ph === ipa) { mapped = tailo; break; }
      }
      parts.push(mapped);
    } else if (lastV !== null && i > lastV) {
      parts.push(CODA_MAP[ph] ?? ph);
      if (STOP_CODAS.has(ph)) hasStopCoda = true;
    } else {
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
  tailo = tailo.replace(/e(n|t)$/, "ia$1");

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

  if (toneCode) {
    const toneNum = hasStopCoda
      ? (TONE_MAP_CHECKED[toneCode] ?? "?")
      : (TONE_MAP_OPEN[toneCode] ?? "?");
    tailo += String(toneNum);
  }
  return tailo;
}

// --- Numeric tone → diacritic conversion ---

const TONE_DIACRITICS: Record<number, string> = {
  2: "\u0301", 3: "\u0300", 5: "\u0302", 7: "\u0304", 8: "\u030D", 9: "\u0306",
};

function findTonePosition(syllable: string): number {
  const lower = syllable.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === "a" || lower[i] === "e") return i;
  }
  const oIdx = lower.indexOf("o");
  if (oIdx !== -1) return oIdx;
  for (let i = lower.length - 1; i >= 0; i--) {
    if (lower[i] === "i" || lower[i] === "u") return i;
  }
  return -1;
}

function syllableToDiacritic(syllable: string): string {
  const m = syllable.match(/^(.+?)(\d)$/);
  if (!m) return syllable.replace(/oo/g, "o\u0358");
  let base = m[1];
  const tone = parseInt(m[2], 10);
  base = base.replace(/oo/g, "o\u0358");
  const diacritic = TONE_DIACRITICS[tone];
  if (!diacritic) return base;
  const pos = findTonePosition(base);
  if (pos === -1) return base;
  let insertAt = pos + 1;
  while (insertAt < base.length && base.charCodeAt(insertAt) >= 0x0300 && base.charCodeAt(insertAt) <= 0x036F) {
    insertAt++;
  }
  return base.slice(0, insertAt) + diacritic + base.slice(insertAt);
}

function tailoNumericToDiacritic(tailo: string): string {
  return tailo.split("-").map(syllableToDiacritic).join("-");
}

function ipaToTailo(ipaStr: string): string {
  const phones = parseIpaPhones(ipaStr);
  if (phones.length === 0) return ipaStr;
  const syllables = syllabify(phones);
  const numeric = syllables.map(([p, t]) => convertSyllable(p, t)).join("-");
  return tailoNumericToDiacritic(numeric);
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/preprocess-lexicon.ts <lexicon.txt> [output.json]");
    process.exit(1);
  }

  const inputPath = resolve(args[0]);
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outputPath = args[1]
    ? resolve(args[1])
    : resolve(__dirname, "..", "public", "lexicon-nan.json");

  console.log(`Reading: ${inputPath}`);
  const content = readFileSync(inputPath, "utf-8");
  const lines = content.split("\n");

  const lexicon: Record<string, string[]> = {};
  let totalTw = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const tabIdx = trimmed.indexOf("\t");
    if (tabIdx === -1) continue;

    const word = trimmed.slice(0, tabIdx);
    const pron = trimmed.slice(tabIdx + 1);

    // Only keep Taiwanese entries (those with 19xx tone codes)
    if (!TW_TONE.test(pron)) continue;
    totalTw++;

    const tailo = ipaToTailo(pron);

    // Append all pronunciations per word, skip exact duplicates
    if (!(word in lexicon)) {
      lexicon[word] = [tailo];
    } else if (!lexicon[word].includes(tailo)) {
      lexicon[word].push(tailo);
    }
  }

  const entryCount = Object.keys(lexicon).length;
  const totalProns = Object.values(lexicon).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Taiwanese entries: ${totalTw} (${entryCount} unique words, ${totalProns} unique pronunciations)`);
  console.log(`Writing: ${outputPath}`);

  const json = JSON.stringify(lexicon);
  writeFileSync(outputPath, json, "utf-8");

  const sizeMB = (Buffer.byteLength(json, "utf-8") / 1024 / 1024).toFixed(1);
  console.log(`Output: ${sizeMB} MB (${entryCount} words, ${totalProns} pronunciations)`);
}

main();
