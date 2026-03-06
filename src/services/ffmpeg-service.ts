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

/**
 * Concatenate WAV files with crossfade to eliminate clicking/popping.
 *
 * Equivalent to Python's concat_wavs_with_crossfade() using acrossfade filter chain.
 *
 * @param audioBuffers - Array of WAV audio data as ArrayBuffers
 * @param crossfadeDuration - Crossfade duration in seconds (default: 0.05)
 * @param fadeCurve - Fade curve type (default: "tri")
 * @returns Concatenated audio as ArrayBuffer (WAV)
 */
export async function concatWavsWithCrossfade(
  audioBuffers: ArrayBuffer[],
  crossfadeDuration: number = 0.05,
  fadeCurve: FadeCurve = "tri"
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
  const ffmpeg = await getFFmpeg();
  const inputFiles: string[] = [];
  const outputFile = "crossfade_output.wav";

  try {
    // Write all input files to virtual FS
    for (let i = 0; i < audioBuffers.length; i++) {
      const fileName = `crossfade_input_${i}.wav`;
      inputFiles.push(fileName);
      await ffmpeg.writeFile(
        fileName,
        new Uint8Array(audioBuffers[i].slice(0))
      );
    }

    // Build input arguments
    const inputArgs: string[] = [];
    for (const file of inputFiles) {
      inputArgs.push("-i", file);
    }

    // Build filter_complex (same logic as Python version)
    let filterComplex: string;
    const d = crossfadeDuration;
    const c1 = fadeCurve;
    const c2 = fadeCurve;

    if (audioBuffers.length === 2) {
      filterComplex = `[0][1]acrossfade=d=${d}:c1=${c1}:c2=${c2}`;
    } else {
      const filters: string[] = [];
      for (let i = 0; i < audioBuffers.length - 1; i++) {
        if (i === 0) {
          filters.push(
            `[0][1]acrossfade=d=${d}:c1=${c1}:c2=${c2}[a0]`
          );
        } else if (i === audioBuffers.length - 2) {
          filters.push(
            `[a${i - 1}][${i + 1}]acrossfade=d=${d}:c1=${c1}:c2=${c2}`
          );
        } else {
          filters.push(
            `[a${i - 1}][${i + 1}]acrossfade=d=${d}:c1=${c1}:c2=${c2}[a${i}]`
          );
        }
      }
      filterComplex = filters.join(";");
    }

    await withTimeout(
      ffmpeg.exec([
        ...inputArgs,
        "-filter_complex",
        filterComplex,
        outputFile,
      ]),
      EXEC_TIMEOUT_MS,
      "FFmpeg concat"
    );

    const data = await ffmpeg.readFile(outputFile);
    logger.ffmpeg.info("Concat complete");
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
