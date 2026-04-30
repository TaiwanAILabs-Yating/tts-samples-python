import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { logger } from "../utils/logger";

// WASM files served from public/ffmpeg/ (copied from @ffmpeg/core)
const CORE_PATH = "/ffmpeg/ffmpeg-core.js";
const WASM_PATH = "/ffmpeg/ffmpeg-core.wasm";

export type FadeCurve = "tri" | "qsin" | "hsin" | "log" | "exp";

const LOAD_TIMEOUT_MS = 60_000;
const EXEC_TIMEOUT_MS = 30_000;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Load and return the shared FFmpeg instance.
 * WASM is served from local node_modules via Vite.
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    return ffmpegInstance;
  }

  if (loadPromise) {
    await loadPromise;
    return ffmpegInstance!;
  }

  ffmpegInstance = new FFmpeg();

  logger.ffmpeg.info("Loading FFmpeg WASM...");
  loadPromise = withTimeout(
    (async () => {
      const coreURL = await toBlobURL(CORE_PATH, "text/javascript");
      const wasmURL = await toBlobURL(WASM_PATH, "application/wasm");
      await ffmpegInstance!.load({ coreURL, wasmURL });
    })(),
    LOAD_TIMEOUT_MS,
    "FFmpeg WASM load"
  );

  try {
    await loadPromise;
    logger.ffmpeg.info("FFmpeg WASM loaded successfully");
  } catch (err) {
    // Allow retry on next call
    loadPromise = null;
    ffmpegInstance = null;
    logger.ffmpeg.error("FFmpeg WASM load failed:", err);
    throw err;
  }

  return ffmpegInstance!;
}

/**
 * Preload FFmpeg WASM eagerly (call on page mount).
 */
export async function preloadFFmpeg(): Promise<void> {
  await getFFmpeg();
}

/**
 * Clean up virtual file system entries to free memory.
 */
async function cleanupFiles(
  ffmpeg: FFmpeg,
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

/**
 * Pad audio with silence at the start and/or end.
 *
 * Equivalent to Python's pad_audio_with_silence() using adelay + apad filters.
 *
 * @param audioData - Input audio as ArrayBuffer
 * @param startSilenceSec - Duration of silence at start (seconds)
 * @param endSilenceSec - Duration of silence at end (seconds)
 * @returns Processed audio as ArrayBuffer (WAV)
 */
export async function padAudioWithSilence(
  audioData: ArrayBuffer,
  startSilenceSec: number = 0,
  endSilenceSec: number = 0
): Promise<ArrayBuffer> {
  if (startSilenceSec <= 0 && endSilenceSec <= 0) {
    return audioData;
  }

  logger.ffmpeg.info(
    `Padding audio: start=${startSilenceSec}s, end=${endSilenceSec}s`
  );
  const ffmpeg = await getFFmpeg();
  const inputFile = "pad_input.wav";
  const outputFile = "pad_output.wav";

  try {
    await ffmpeg.writeFile(inputFile, new Uint8Array(audioData.slice(0)));

    // Build filter chain (same as Python version)
    const filters: string[] = [];
    if (startSilenceSec > 0) {
      const ms = Math.round(startSilenceSec * 1000);
      filters.push(`adelay=${ms}|${ms}`);
    }
    if (endSilenceSec > 0) {
      filters.push(`apad=pad_dur=${endSilenceSec}`);
    }

    await withTimeout(
      ffmpeg.exec(["-i", inputFile, "-af", filters.join(","), outputFile]),
      EXEC_TIMEOUT_MS,
      "FFmpeg pad"
    );

    const data = await ffmpeg.readFile(outputFile);
    logger.ffmpeg.info("Padding complete");
    return new Uint8Array(data as Uint8Array).buffer as ArrayBuffer;
  } finally {
    await cleanupFiles(ffmpeg, [inputFile, outputFile]);
  }
}

import { MAX_SEGMENTS_PER_SENTENCE } from "../utils/preprocessing";

/**
 * Concat batch size: split N>K inputs into batches to avoid long filter cascade.
 * Aligned with `MAX_SEGMENTS_PER_SENTENCE` so each Direct-Input sentence can be
 * concatenated in a single FFmpeg pass (no hierarchical concat needed).
 */
export const CONCAT_BATCH_SIZE = MAX_SEGMENTS_PER_SENTENCE;

/** Compute concat exec timeout: base 30s + 2s per file, capped at 5min. */
export function computeConcatTimeout(n: number): number {
  return Math.min(5 * 60 * 1000, 30_000 + n * 2_000);
}

export interface ConcatProgress {
  /** Phase: pass1 (per-batch concat), pass2 (final merge), done. */
  phase: "pass1" | "pass2" | "done";
  /** Batch index (0-based) for pass1; 0 for pass2/done. */
  current: number;
  /** Total batches for pass1; 1 for pass2/done. */
  total: number;
  /** FFmpeg-reported progress for the current exec, 0..1. */
  progress: number;
}

/**
 * Concatenate WAV files with crossfade to eliminate clicking/popping.
 *
 * Equivalent to Python's concat_wavs_with_crossfade() using acrossfade filter chain.
 *
 * For N <= CONCAT_BATCH_SIZE (50), runs a single FFmpeg exec.
 * For N > 50, runs hierarchical concat: Pass 1 splits into batches of 50,
 * Pass 2 merges intermediates. Each exec uses computeConcatTimeout(n).
 *
 * @param audioBuffers - Array of WAV audio data as ArrayBuffers
 * @param crossfadeDuration - Crossfade duration in seconds (default: 0.05)
 * @param fadeCurve - Fade curve type (default: "tri")
 * @param onProgress - Optional callback for batch / pass progress
 * @returns Concatenated audio as ArrayBuffer (WAV)
 */
export async function concatWavsWithCrossfade(
  audioBuffers: ArrayBuffer[],
  crossfadeDuration: number = 0.05,
  fadeCurve: FadeCurve = "tri",
  onProgress?: (info: ConcatProgress) => void,
): Promise<ArrayBuffer> {
  if (audioBuffers.length === 0) {
    throw new Error("No audio files to concatenate");
  }

  if (audioBuffers.length === 1) {
    return audioBuffers[0];
  }

  logger.ffmpeg.info(
    `Concatenating ${audioBuffers.length} segments (crossfade=${crossfadeDuration}s, curve=${fadeCurve})`
  );

  // Small case: single-pass (preserves prior behavior for N <= 50)
  if (audioBuffers.length <= CONCAT_BATCH_SIZE) {
    onProgress?.({ phase: "pass1", current: 0, total: 1, progress: 0 });
    const final = await concatBatch(
      audioBuffers,
      crossfadeDuration,
      fadeCurve,
      "crossfade",
      (progress) =>
        onProgress?.({ phase: "pass1", current: 0, total: 1, progress }),
    );
    onProgress?.({ phase: "done", current: 1, total: 1, progress: 1 });
    return final;
  }

  // Pass 1: split into batches of CONCAT_BATCH_SIZE
  const batches: ArrayBuffer[][] = [];
  for (let i = 0; i < audioBuffers.length; i += CONCAT_BATCH_SIZE) {
    batches.push(audioBuffers.slice(i, i + CONCAT_BATCH_SIZE));
  }
  logger.ffmpeg.info(
    `Hierarchical concat: ${batches.length} batches (size=${CONCAT_BATCH_SIZE})`
  );

  const intermediates: ArrayBuffer[] = [];
  for (let i = 0; i < batches.length; i++) {
    onProgress?.({ phase: "pass1", current: i, total: batches.length, progress: 0 });
    intermediates.push(
      await concatBatch(
        batches[i],
        crossfadeDuration,
        fadeCurve,
        `pass1_b${i}`,
        (progress) =>
          onProgress?.({
            phase: "pass1",
            current: i,
            total: batches.length,
            progress,
          }),
      ),
    );
    // Release the per-batch slice held by the local `batches` array.
    // Caller's audioBuffers array still holds the source ArrayBuffers; this only
    // drops the extra references created by Array.prototype.slice() above.
    batches[i] = [];
  }

  // Pass 2: merge intermediates
  onProgress?.({ phase: "pass2", current: 0, total: 1, progress: 0 });
  const final = await concatBatch(
    intermediates,
    crossfadeDuration,
    fadeCurve,
    "pass2",
    (progress) =>
      onProgress?.({ phase: "pass2", current: 0, total: 1, progress }),
  );

  // Release intermediate ArrayBuffer refs — they have already been consumed by
  // concatBatch (written to MEMFS, then cleaned up). Each intermediate is ~30 MB
  // for K=50 / 13s/segment audio; 30 batches → ~900 MB freed from JS heap.
  intermediates.length = 0;

  // Free WASM linear memory. acrossfade Pass 2 working set can hold 1-3 GB inside
  // wasm32 linear memory which never shrinks until terminate. Reload cost on next
  // concat (~1-2s) is acceptable; preventing OOM is the higher priority.
  await terminateFFmpeg();
  logger.ffmpeg.info("FFmpeg terminated to free WASM heap");

  onProgress?.({ phase: "done", current: 1, total: 1, progress: 1 });
  return final;
}

/** Internal: single-exec concat of audioBuffers. Returns lone buffer if length is 1. */
async function concatBatch(
  audioBuffers: ArrayBuffer[],
  crossfadeDuration: number,
  fadeCurve: FadeCurve,
  label: string,
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer> {
  // A leftover single-file batch (N % 50 === 1 in pass 1) needs no FFmpeg call.
  if (audioBuffers.length === 1) {
    onProgress?.(1);
    return audioBuffers[0];
  }

  const ffmpeg = await getFFmpeg();
  const inputFiles: string[] = [];
  const outputFile = `${label}_output.wav`;

  try {
    // Write all input files to virtual FS
    for (let i = 0; i < audioBuffers.length; i++) {
      const fileName = `${label}_input_${i}.wav`;
      inputFiles.push(fileName);
      await ffmpeg.writeFile(
        fileName,
        new Uint8Array(audioBuffers[i].slice(0)),
      );
    }

    // Build input arguments
    const inputArgs: string[] = [];
    for (const file of inputFiles) {
      inputArgs.push("-i", file);
    }

    // Build filter_complex
    const d = crossfadeDuration;
    const c1 = fadeCurve;
    const c2 = fadeCurve;
    let filterComplex: string;

    if (audioBuffers.length === 2) {
      filterComplex = `[0][1]acrossfade=d=${d}:c1=${c1}:c2=${c2}`;
    } else {
      const filters: string[] = [];
      for (let i = 0; i < audioBuffers.length - 1; i++) {
        if (i === 0) {
          filters.push(`[0][1]acrossfade=d=${d}:c1=${c1}:c2=${c2}[a0]`);
        } else if (i === audioBuffers.length - 2) {
          filters.push(
            `[a${i - 1}][${i + 1}]acrossfade=d=${d}:c1=${c1}:c2=${c2}`,
          );
        } else {
          filters.push(
            `[a${i - 1}][${i + 1}]acrossfade=d=${d}:c1=${c1}:c2=${c2}[a${i}]`,
          );
        }
      }
      filterComplex = filters.join(";");
    }

    const progressHandler = ({ progress }: { progress: number; time: number }) => {
      if (Number.isFinite(progress)) {
        onProgress?.(Math.max(0, Math.min(1, progress)));
      }
    };

    ffmpeg.on?.("progress", progressHandler);
    try {
      await withTimeout(
        ffmpeg.exec([...inputArgs, "-filter_complex", filterComplex, outputFile]),
        computeConcatTimeout(audioBuffers.length),
        `FFmpeg concat ${label}`,
      );
      onProgress?.(1);
    } finally {
      ffmpeg.off?.("progress", progressHandler);
    }

    const data = await ffmpeg.readFile(outputFile);
    logger.ffmpeg.info(`Concat ${label} complete`);
    return new Uint8Array(data as Uint8Array).buffer as ArrayBuffer;
  } finally {
    await cleanupFiles(ffmpeg, [...inputFiles, outputFile]);
  }
}

/**
 * Terminate the FFmpeg instance and free resources.
 */
export async function terminateFFmpeg(): Promise<void> {
  if (ffmpegInstance) {
    ffmpegInstance.terminate();
    ffmpegInstance = null;
    loadPromise = null;
  }
}
