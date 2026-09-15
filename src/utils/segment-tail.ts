/**
 * Remove the artifact TTS sometimes leaves at the very end of a segment, then
 * fade the last few ms so playback never stops on a step.
 *
 * Measured on 2,821 raw API outputs (Mandarin + Taiwanese, end-silence token on):
 * ~8% end with a burst that climbs to (near) 0 dBFS within the last ~12 ms, often
 * right after an already quiet tail. A plain fade can't remove it — the burst
 * starts before any short fade window — so it is cut. The burst also defeated
 * silence trimming (it counts as "sound") and got carried into crossfade joints,
 * so segments are cleaned once, as soon as the audio arrives.
 *
 * Rules (tuned by ear on the dataset above; every threshold sits on a plateau
 * where nearby values cut exactly the same files):
 *   1. Short loud tail (≤ 30 ms above -45 dB) right after ≥ 5 ms of quiet.
 *   2. A burst (≤ 30 ms above -20 dB) reaching ≥ -10 dB and ≥ 15 dB louder than
 *      the 20 ms before it — catches bursts that follow a soft breath instead of
 *      silence. Real speech that is merely cut off never jumps up like this.
 *   3. Only if 1 or 2 fired: an isolated smaller click (≤ 15 ms above -30 dB,
 *      ≥ 15 dB above ≥ 3 ms of quiet) within 60 ms before the cut. Final
 *      consonant releases look similar, so this never runs on clean segments.
 *
 * Pure sample math on 16-bit PCM WAV (the TTS API returns LINEAR16). Anything
 * else is returned untouched.
 */

export interface TailCleanOptions {
  thresholdDb: number;
  maxBurstMs: number;
  quietGapMs: number;
  fadeMs: number;
  scanMs: number;
  burstOnsetDb: number;
  burstPeakDb: number;
  burstJumpDb: number;
  contextMs: number;
  burstMarginMs: number;
  preClickLoudDb: number;
  preClickMaxMs: number;
  preClickQuietDb: number;
  preClickGapMs: number;
  preClickJumpDb: number;
  preClickWithinMs: number;
  preClickMarginMs: number;
}

export const TAIL_CLEAN_DEFAULTS: TailCleanOptions = {
  // Rule 1
  thresholdDb: -45,
  maxBurstMs: 30,
  quietGapMs: 5,
  // Always
  fadeMs: 10,
  scanMs: 150,
  // Rule 2
  burstOnsetDb: -20,
  burstPeakDb: -10,
  burstJumpDb: 15,
  contextMs: 20,
  burstMarginMs: 2,
  // Rule 3
  preClickLoudDb: -30,
  preClickMaxMs: 15,
  preClickQuietDb: -40,
  preClickGapMs: 3,
  preClickJumpDb: 15,
  preClickWithinMs: 60,
  preClickMarginMs: 2,
};

export interface TailCleanResult {
  /** Cleaned WAV (a new buffer), or the input itself when skipped. */
  buffer: ArrayBuffer;
  /** Milliseconds removed from the end (0 = nothing cut, fade only). */
  cutMs: number;
  /** 0 = none, 1 / 2 = main burst rule, 3 = pre-click; 13 / 23 = burst + pre-click. */
  rule: number;
  /** Part of `cutMs` removed by rule 3. */
  preClickMs: number;
  /** Set when the input could not be processed and was returned untouched. */
  skipped?: string;
}

interface WavInfo {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bits: number;
  dataStart: number;
  frames: number;
  frameBytes: number;
}

const ascii = (u8: Uint8Array, p: number) =>
  String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

function parseWav(buffer: ArrayBuffer): WavInfo {
  const u8 = new Uint8Array(buffer);
  const v = new DataView(buffer);
  if (u8.length < 12 || ascii(u8, 0) !== "RIFF" || ascii(u8, 8) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let p = 12;
  let fmt: Omit<WavInfo, "dataStart" | "frames" | "frameBytes"> | null = null;
  let dataStart = -1;
  while (p + 8 <= u8.length) {
    const id = ascii(u8, p);
    const size = v.getUint32(p + 4, true);
    if (id === "fmt ") {
      fmt = {
        audioFormat: v.getUint16(p + 8, true),
        channels: v.getUint16(p + 10, true),
        sampleRate: v.getUint32(p + 12, true),
        bits: v.getUint16(p + 22, true),
      };
    }
    if (id === "data") {
      dataStart = p + 8;
      break;
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || dataStart < 0) throw new Error("WAV missing fmt/data chunk");
  // Streaming TTS responses carry placeholder sizes in the header — trust the bytes.
  const frameBytes = fmt.channels * (fmt.bits / 8);
  const frames = Math.floor((u8.length - dataStart) / frameBytes);
  return { ...fmt, dataStart, frames, frameBytes };
}

function encodeWav(info: WavInfo, pcm: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(out);
  const w = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  const blockAlign = info.channels * (info.bits / 8);
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, info.channels, true);
  v.setUint32(24, info.sampleRate, true);
  v.setUint32(28, info.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, info.bits, true);
  w(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(out, 44).set(pcm);
  return out;
}

const toDb = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -Infinity);
const dbToLin = (db: number) => Math.pow(10, db / 20);

export function cleanSegmentTail(
  buffer: ArrayBuffer,
  options: Partial<TailCleanOptions> = {},
): TailCleanResult {
  const o = { ...TAIL_CLEAN_DEFAULTS, ...options };
  let info: WavInfo;
  try {
    info = parseWav(buffer);
  } catch (err) {
    return { buffer, cutMs: 0, rule: 0, preClickMs: 0, skipped: String(err) };
  }
  if (info.audioFormat !== 1 || info.bits !== 16 || info.channels < 1 || info.frames < 1) {
    return {
      buffer, cutMs: 0, rule: 0, preClickMs: 0,
      skipped: `unsupported format (${info.bits}-bit, format ${info.audioFormat}, ${info.channels} ch)`,
    };
  }

  const { dataStart, frames, frameBytes, channels } = info;
  const v = new DataView(buffer);
  const perMs = info.sampleRate / 1000;

  // Peak of each 1 ms window counting back from the end (index 0 = last ms).
  const scan = Math.min(o.scanMs, Math.floor(frames / perMs));
  const peak: number[] = new Array(scan);
  for (let i = 0; i < scan; i++) {
    const endF = frames - Math.round(i * perMs);
    const startF = frames - Math.round((i + 1) * perMs);
    let m = 0;
    for (let f = startF; f < endF; f++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.abs(v.getInt16(dataStart + f * frameBytes + c * 2, true)) / 32768;
        if (s > m) m = s;
      }
    }
    peak[i] = m;
  }

  // Rule 1 — short loud tail right after a quiet gap.
  const threshold = dbToLin(o.thresholdDb);
  let loud = 0;
  while (loud < scan && peak[loud] > threshold) loud++;
  const hasGap =
    loud + o.quietGapMs <= scan &&
    peak.slice(loud, loud + o.quietGapMs).every((x) => x <= threshold);
  let cutMs = loud > 0 && loud <= o.maxBurstMs && hasGap ? loud : 0;
  let rule = cutMs ? 1 : 0;

  // Rule 2 — loud burst jumping well above the audio right before it.
  if (!cutMs) {
    const onset = dbToLin(o.burstOnsetDb);
    let b = 0;
    while (b < scan && peak[b] > onset) b++;
    if (b > 0 && b <= o.maxBurstMs && b + o.contextMs <= scan) {
      const burstPeak = Math.max(...peak.slice(0, b));
      const ctxPeak = Math.max(...peak.slice(b, b + o.contextMs));
      if (toDb(burstPeak) >= o.burstPeakDb && toDb(burstPeak) - toDb(ctxPeak) >= o.burstJumpDb) {
        cutMs = Math.min(scan, b + o.burstMarginMs);
        rule = 2;
      }
    }
  }

  // Rule 3 — isolated smaller click shortly before a confirmed burst.
  let preClickMs = 0;
  if (cutMs > 0) {
    const loudT = dbToLin(o.preClickLoudDb);
    const quietT = dbToLin(o.preClickQuietDb);
    let i = cutMs; // peak[] index of the new last millisecond
    while (i < scan && peak[i] <= loudT) i++; // skip the quiet / decaying tail
    const clickEnd = i;
    while (i < scan && peak[i] > loudT) i++;
    const clickLen = i - clickEnd;
    const gap = peak.slice(i, i + o.preClickGapMs);
    if (
      clickLen > 0 &&
      clickLen <= o.preClickMaxMs &&
      i - cutMs <= o.preClickWithinMs &&
      gap.length === o.preClickGapMs &&
      gap.every((x) => x <= quietT) &&
      toDb(Math.max(...peak.slice(clickEnd, i))) - toDb(Math.max(...gap)) >= o.preClickJumpDb
    ) {
      preClickMs = Math.min(scan, i + o.preClickMarginMs) - cutMs;
      cutMs += preClickMs;
      rule = rule * 10 + 3;
    }
  }

  // Keep everything before the cut, then fade the new end to silence.
  const keepFrames = frames - Math.round(cutMs * perMs);
  const pcm = new Uint8Array(buffer.slice(dataStart, dataStart + keepFrames * frameBytes));
  const pv = new DataView(pcm.buffer);
  const n = Math.min(keepFrames, Math.round(o.fadeMs * perMs));
  for (let k = 0; k < n; k++) {
    const g = 1 - (k + 1) / n;
    const base = (keepFrames - n + k) * frameBytes;
    for (let c = 0; c < channels; c++) {
      pv.setInt16(base + c * 2, Math.round(pv.getInt16(base + c * 2, true) * g), true);
    }
  }
  return { buffer: encodeWav(info, pcm), cutMs, rule, preClickMs };
}
