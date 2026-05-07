import type { TtsConfig } from "../config/index";
import type { ConcatProgress, FadeCurve } from "./ffmpeg-service";
import type { ZeroShotRequest } from "./tts-client";
import { sendZeroShotRequest, uploadPromptVoice } from "./tts-client";
import { concatWavsWithCrossfade, padAudioWithSilence } from "./ffmpeg-service";
import { getWavDuration } from "../utils/audio";
import { generateWithRetry, generateBatch } from "./batch-generator";
import { logger } from "../utils/logger";

// --- Types ---

export type SegmentStatus = "pending" | "generating" | "success" | "error";

export interface HistoryEntry {
  audio: ArrayBuffer;
  duration: number;
  timestamp: number;
}

export interface WordSegState {
  word: string;
  tailo: string;         // 當前選中的台羅
  tailoList: string[];   // 所有候選發音
  inVocab: boolean;
  useTailo: boolean;     // true = 送 TTS 時用台羅替換該詞
}

export interface SegmentState {
  index: number;
  text: string;
  status: SegmentStatus;
  audio?: ArrayBuffer;
  duration?: number;
  error?: string;
  attempts: number;
  history: HistoryEntry[];
  wordSegmentation?: WordSegState[];
}

export interface PipelineState {
  segments: SegmentState[];
  concatenatedAudio?: ArrayBuffer;
  promptVoiceAssetKey?: string;
}

export interface SegmentInput {
  text: string;
  wordSegmentation?: WordSegState[];
}

export interface GenerateAllConfig {
  segments: SegmentInput[];
  promptVoiceFile: File | Blob;
  promptVoiceText: string;
  language?: string;
  promptLanguage?: string;
  addEndSilence?: boolean;
  concurrency?: number;
  maxRetries?: number;
  retryBaseDelay?: number;
  crossfadeDuration?: number;
  fadeCurve?: FadeCurve;
  startSilence?: number;
  endSilence?: number;
  /** Skip auto-concat after generation; caller must invoke concatOnly() later. */
  skipConcat?: boolean;
  config: TtsConfig;
}

export interface RegenerateConfig {
  promptVoiceText?: string;
  language?: string;
  promptLanguage?: string;
  addEndSilence?: boolean;
  concurrency?: number;
  maxRetries?: number;
  retryBaseDelay?: number;
  crossfadeDuration?: number;
  fadeCurve?: FadeCurve;
  config: TtsConfig;
}

export interface OrchestratorCallbacks {
  onSegmentUpdate?: (index: number, segment: SegmentState) => void;
  onProgress?: (completed: number, total: number) => void;
  onConcatProgress?: (info: ConcatProgress) => void;
  onConcatComplete?: (audio: ArrayBuffer) => void;
}

// --- Internal helpers ---

/**
 * Build the text to send to TTS API.
 * If the segment has word segmentation with useTailo flags,
 * replace those words with their Tailo romanization.
 */
function buildTtsText(segment: SegmentState): string {
  if (!segment.wordSegmentation?.length) {
    return segment.text;
  }
  return segment.wordSegmentation
    .map((ws) => (ws.useTailo ? ws.tailo : ws.word))
    .join("");
}

function buildSegmentStates(inputs: SegmentInput[]): SegmentState[] {
  return inputs.map((input, index) => ({
    index,
    text: input.text,
    status: "pending" as SegmentStatus,
    attempts: 0,
    history: [],
    ...(input.wordSegmentation ? { wordSegmentation: input.wordSegmentation } : {}),
  }));
}

function pushToHistory(segment: SegmentState): void {
  if (segment.audio && segment.duration != null) {
    segment.history.push({
      audio: segment.audio,
      duration: segment.duration,
      timestamp: Date.now(),
    });
  }
}

async function recombineOutputs(
  segments: SegmentState[],
  crossfadeDuration: number,
  fadeCurve: FadeCurve,
  callbacks?: OrchestratorCallbacks
): Promise<{ concatenatedAudio?: ArrayBuffer }> {
  const successSegments = segments.filter(
    (s) => s.status === "success" && s.audio
  );

  if (successSegments.length === 0) {
    return {};
  }

  const audios = successSegments.map((s) => s.audio!);

  let concatenatedAudio: ArrayBuffer;
  try {
    logger.orchestrator.info(`Concatenating ${audios.length} segments...`);
    concatenatedAudio = await concatWavsWithCrossfade(
      audios,
      crossfadeDuration,
      fadeCurve,
      (info) => callbacks?.onConcatProgress?.(info),
    );
    callbacks?.onConcatComplete?.(concatenatedAudio);
    logger.orchestrator.info("Concat complete");
  } catch (err) {
    logger.orchestrator.error("Concat failed:", err);
    throw new Error(
      `Audio concatenation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { concatenatedAudio };
}

// --- Public functions ---

/**
 * Full pipeline: pre-split segments → TTS → concat.
 * Caller is responsible for splitting; orchestrator only generates audio.
 */
export async function generateAll(
  config: GenerateAllConfig,
  callbacks?: OrchestratorCallbacks
): Promise<PipelineState> {
  if (config.segments.length === 0) {
    throw new Error("generateAll requires at least one segment");
  }

  // Step 1: Build segment states from caller-supplied inputs
  const segments = buildSegmentStates(config.segments);
  logger.orchestrator.info(`Step 1: Built ${segments.length} segment states`);

  // Step 2: Pad prompt voice with silence (match Python behavior)
  const startSilence = config.startSilence ?? 0;
  const endSilence = config.endSilence ?? 0;
  let promptFile: File | Blob = config.promptVoiceFile;

  if (startSilence > 0 || endSilence > 0) {
    logger.orchestrator.info(
      `Step 2a: Padding prompt voice (start=${startSilence}s, end=${endSilence}s)`
    );
    const originalBuffer = await config.promptVoiceFile.arrayBuffer();
    const paddedBuffer = await padAudioWithSilence(
      originalBuffer,
      startSilence,
      endSilence
    );
    promptFile = new Blob([paddedBuffer], { type: "audio/wav" });
  }

  // Step 3: Upload prompt voice
  logger.orchestrator.info("Step 3: Uploading prompt voice...");
  const promptVoiceAssetKey = await uploadPromptVoice(
    promptFile,
    "prompt.wav",
    config.config
  );
  logger.orchestrator.info(`Prompt voice uploaded: ${promptVoiceAssetKey}`);

  const state: PipelineState = {
    segments,
    promptVoiceAssetKey,
  };

  // Step 4: Generate audio for each segment (parallel with retry)
  logger.orchestrator.info("Step 4: Generating audio for segments...");
  const concurrency = config.concurrency ?? 3;
  const maxRetries = config.maxRetries ?? 3;
  const retryBaseDelay = config.retryBaseDelay ?? 1.0;

  const tasks = segments.map((segment, i) => () => {
    segment.status = "generating";
    callbacks?.onSegmentUpdate?.(i, { ...segment });

    const req: ZeroShotRequest = {
      text: buildTtsText(segment),
      promptVoiceText: config.promptVoiceText,
      promptVoiceAssetKey,
      promptVoiceUrl: "",
      language: config.language,
      promptLanguage: config.promptLanguage,
      addEndSilence: config.addEndSilence,
    };

    return generateWithRetry(
      () => sendZeroShotRequest(req, config.config),
      maxRetries,
      retryBaseDelay
    ).then((result) => {
      if (result.success && result.data) {
        segment.status = "success";
        segment.audio = result.data;
        segment.duration = getWavDuration(result.data);
        segment.attempts = result.attempts;
      } else {
        segment.status = "error";
        segment.error = result.error;
        segment.attempts = result.attempts;
      }
      callbacks?.onSegmentUpdate?.(i, { ...segment });
      return segment;
    });
  });

  await generateBatch(tasks, concurrency, (completed, total) => {
    callbacks?.onProgress?.(completed, total);
  });

  // Step 5: Concat (skipped if config.skipConcat — caller will invoke concatOnly later)
  if (config.skipConcat) {
    logger.orchestrator.info(
      `Skipping auto-concat (skipConcat=true; ${segments.length} segments)`,
    );
    return state;
  }

  const crossfadeDuration = config.crossfadeDuration ?? 0.05;
  const fadeCurve = config.fadeCurve ?? "tri";

  const { concatenatedAudio } = await recombineOutputs(
    segments,
    crossfadeDuration,
    fadeCurve,
    callbacks
  );

  state.concatenatedAudio = concatenatedAudio;

  return state;
}

/**
 * Run concat on an existing PipelineState (no re-generation).
 * Used only when the UI explicitly asks for a final concatenated artifact.
 */
export async function concatOnly(
  state: PipelineState,
  crossfadeDuration: number = 0.05,
  fadeCurve: FadeCurve = "tri",
  callbacks?: OrchestratorCallbacks,
): Promise<PipelineState> {
  const { concatenatedAudio } = await recombineOutputs(
    state.segments,
    crossfadeDuration,
    fadeCurve,
    callbacks,
  );
  return { ...state, concatenatedAudio };
}

/**
 * Regenerate a single segment. Re-concat only if this pipeline already has
 * preview audio from short-sentence auto-concat.
 * Saves old version to history before regenerating.
 * Corresponds to AC-27, AC-28, AC-30.
 */
export async function regenerateSegment(
  state: PipelineState,
  index: number,
  rConfig: RegenerateConfig,
  callbacks?: OrchestratorCallbacks
): Promise<PipelineState> {
  const segment = state.segments[index];
  if (!segment) {
    throw new Error(`Segment index ${index} out of range`);
  }
  if (!state.promptVoiceAssetKey) {
    throw new Error("No prompt voice asset key — run generateAll first");
  }

  // AC-30: Save old version to history
  pushToHistory(segment);

  // Mark as generating
  segment.status = "generating";
  segment.error = undefined;
  callbacks?.onSegmentUpdate?.(index, { ...segment });

  const req: ZeroShotRequest = {
    text: buildTtsText(segment),
    promptVoiceText: rConfig.promptVoiceText ?? "",
    promptVoiceAssetKey: state.promptVoiceAssetKey,
    promptVoiceUrl: "",
    language: rConfig.language,
    promptLanguage: rConfig.promptLanguage,
    addEndSilence: rConfig.addEndSilence,
  };

  const result = await generateWithRetry(
    () => sendZeroShotRequest(req, rConfig.config),
    rConfig.maxRetries ?? 3,
    rConfig.retryBaseDelay ?? 1.0
  );

  if (result.success && result.data) {
    segment.status = "success";
    segment.audio = result.data;
    segment.duration = getWavDuration(result.data);
    segment.attempts = result.attempts;
  } else {
    segment.status = "error";
    segment.error = result.error;
    segment.attempts = result.attempts;
  }
  callbacks?.onSegmentUpdate?.(index, { ...segment });

  if (!state.concatenatedAudio) {
    return state;
  }

  // Keep existing short-sentence preview audio fresh.
  const crossfadeDuration = rConfig.crossfadeDuration ?? 0.05;
  const fadeCurve = rConfig.fadeCurve ?? "tri";

  const { concatenatedAudio } = await recombineOutputs(
    state.segments,
    crossfadeDuration,
    fadeCurve,
    callbacks
  );

  state.concatenatedAudio = concatenatedAudio;

  return state;
}

/**
 * Regenerate all segments in a sentence. Re-concat only if this pipeline
 * already has preview audio from short-sentence auto-concat.
 * Saves all existing versions to history before regenerating.
 * Corresponds to AC-29, AC-30.
 */
export async function regenerateSentence(
  state: PipelineState,
  rConfig: RegenerateConfig,
  callbacks?: OrchestratorCallbacks
): Promise<PipelineState> {
  if (!state.promptVoiceAssetKey) {
    throw new Error("No prompt voice asset key — run generateAll first");
  }

  // AC-30: Save all existing versions to history
  for (const segment of state.segments) {
    pushToHistory(segment);
    segment.status = "pending";
    segment.error = undefined;
  }

  // Regenerate all segments in parallel
  const maxRetries = rConfig.maxRetries ?? 3;
  const retryBaseDelay = rConfig.retryBaseDelay ?? 1.0;

  const tasks = state.segments.map((segment, i) => () => {
    segment.status = "generating";
    callbacks?.onSegmentUpdate?.(i, { ...segment });

    const req: ZeroShotRequest = {
      text: buildTtsText(segment),
      promptVoiceText: rConfig.promptVoiceText ?? "",
      promptVoiceAssetKey: state.promptVoiceAssetKey!,
      promptVoiceUrl: "",
      language: rConfig.language,
      promptLanguage: rConfig.promptLanguage,
      addEndSilence: rConfig.addEndSilence,
    };

    return generateWithRetry(
      () => sendZeroShotRequest(req, rConfig.config),
      maxRetries,
      retryBaseDelay
    ).then((result) => {
      if (result.success && result.data) {
        segment.status = "success";
        segment.audio = result.data;
        segment.duration = getWavDuration(result.data);
        segment.attempts = result.attempts;
      } else {
        segment.status = "error";
        segment.error = result.error;
        segment.attempts = result.attempts;
      }
      callbacks?.onSegmentUpdate?.(i, { ...segment });
      return segment;
    });
  });

  const concurrency = rConfig.concurrency ?? 3;
  await generateBatch(tasks, concurrency, (completed, total) => {
    callbacks?.onProgress?.(completed, total);
  });

  if (!state.concatenatedAudio) {
    return state;
  }

  // Keep existing short-sentence preview audio fresh.
  const crossfadeDuration = rConfig.crossfadeDuration ?? 0.05;
  const fadeCurve = rConfig.fadeCurve ?? "tri";

  const { concatenatedAudio } = await recombineOutputs(
    state.segments,
    crossfadeDuration,
    fadeCurve,
    callbacks
  );

  state.concatenatedAudio = concatenatedAudio;

  return state;
}
