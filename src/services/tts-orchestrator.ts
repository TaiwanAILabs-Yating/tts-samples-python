import type { TtsConfig } from "../config/index";
import type { FadeCurve } from "./ffmpeg-service";
import type { SegmentMode } from "../utils/preprocessing";
import type { ZeroShotRequest } from "./tts-client";
import { preprocessText, splitSentences, generateUttId } from "../utils/preprocessing";
import { sendZeroShotRequest, uploadPromptVoice } from "./tts-client";
import { concatWavsWithCrossfade } from "./ffmpeg-service";
import { generateSrt } from "../utils/srt";
import { getWavDuration } from "../utils/audio";
import { generateWithRetry, generateBatch } from "./batch-generator";

// --- Types ---

export type SegmentStatus = "pending" | "generating" | "success" | "error";

export interface HistoryEntry {
  audio: ArrayBuffer;
  duration: number;
  timestamp: number;
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
}

export interface PipelineState {
  segments: SegmentState[];
  concatenatedAudio?: ArrayBuffer;
  srtContent?: string;
  promptVoiceAssetKey?: string;
}

export interface GenerateAllConfig {
  text: string;
  promptVoiceFile: File | Blob;
  promptVoiceText: string;
  audioBasename?: string;
  segmentMode?: SegmentMode;
  minTokens?: number;
  maxTokens?: number;
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
  config: TtsConfig;
}

export interface RegenerateConfig {
  language?: string;
  promptLanguage?: string;
  addEndSilence?: boolean;
  maxRetries?: number;
  retryBaseDelay?: number;
  crossfadeDuration?: number;
  fadeCurve?: FadeCurve;
  config: TtsConfig;
}

export interface OrchestratorCallbacks {
  onSegmentUpdate?: (index: number, segment: SegmentState) => void;
  onProgress?: (completed: number, total: number) => void;
  onConcatComplete?: (audio: ArrayBuffer) => void;
  onSrtComplete?: (srt: string) => void;
}

// --- Internal helpers ---

function buildSegmentStates(texts: string[]): SegmentState[] {
  return texts.map((text, index) => ({
    index,
    text,
    status: "pending" as SegmentStatus,
    attempts: 0,
    history: [],
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
): Promise<{ concatenatedAudio?: ArrayBuffer; srtContent?: string }> {
  const successSegments = segments.filter(
    (s) => s.status === "success" && s.audio
  );

  if (successSegments.length === 0) {
    return {};
  }

  const audios = successSegments.map((s) => s.audio!);
  const concatenatedAudio = await concatWavsWithCrossfade(
    audios,
    crossfadeDuration,
    fadeCurve
  );
  callbacks?.onConcatComplete?.(concatenatedAudio);

  const srtSegments = successSegments.map((s) => ({
    text: s.text,
    duration: s.duration!,
  }));
  const srtContent = generateSrt(srtSegments);
  callbacks?.onSrtComplete?.(srtContent);

  return { concatenatedAudio, srtContent };
}

// --- Public functions ---

/**
 * Full pipeline: text → segments → TTS → concat → SRT.
 * Equivalent to Python main.py:main() Steps 1-5.
 */
export async function generateAll(
  config: GenerateAllConfig,
  callbacks?: OrchestratorCallbacks
): Promise<PipelineState> {
  // Step 1: Preprocess text
  const cleanedText = preprocessText(config.text);

  // Step 2: Split into segments
  const texts = splitSentences(
    cleanedText,
    config.segmentMode ?? "sentence",
    config.minTokens ?? 10,
    config.maxTokens ?? 40
  );

  const segments = buildSegmentStates(texts);

  // Step 3: Upload prompt voice
  const promptVoiceAssetKey = await uploadPromptVoice(
    config.promptVoiceFile,
    "prompt.wav",
    config.config
  );

  const state: PipelineState = {
    segments,
    promptVoiceAssetKey,
  };

  // Step 4: Generate audio for each segment (parallel with retry)
  const concurrency = config.concurrency ?? 3;
  const maxRetries = config.maxRetries ?? 3;
  const retryBaseDelay = config.retryBaseDelay ?? 1.0;

  const tasks = segments.map((segment, i) => () => {
    segment.status = "generating";
    callbacks?.onSegmentUpdate?.(i, { ...segment });

    const req: ZeroShotRequest = {
      text: segment.text,
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

  // Step 5 & 6: Concat + SRT
  const crossfadeDuration = config.crossfadeDuration ?? 0.05;
  const fadeCurve = config.fadeCurve ?? "tri";

  const { concatenatedAudio, srtContent } = await recombineOutputs(
    segments,
    crossfadeDuration,
    fadeCurve,
    callbacks
  );

  state.concatenatedAudio = concatenatedAudio;
  state.srtContent = srtContent;

  return state;
}

/**
 * Regenerate a single segment, then re-concat and re-SRT.
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
    text: segment.text,
    promptVoiceText: "", // already uploaded; text not needed again
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

  // AC-28: Re-concat + re-SRT
  const crossfadeDuration = rConfig.crossfadeDuration ?? 0.05;
  const fadeCurve = rConfig.fadeCurve ?? "tri";

  const { concatenatedAudio, srtContent } = await recombineOutputs(
    state.segments,
    crossfadeDuration,
    fadeCurve,
    callbacks
  );

  state.concatenatedAudio = concatenatedAudio;
  state.srtContent = srtContent;

  return state;
}

/**
 * Regenerate all segments in a sentence.
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
      text: segment.text,
      promptVoiceText: "",
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

  await generateBatch(tasks, 3, (completed, total) => {
    callbacks?.onProgress?.(completed, total);
  });

  // Re-concat + re-SRT
  const crossfadeDuration = rConfig.crossfadeDuration ?? 0.05;
  const fadeCurve = rConfig.fadeCurve ?? "tri";

  const { concatenatedAudio, srtContent } = await recombineOutputs(
    state.segments,
    crossfadeDuration,
    fadeCurve,
    callbacks
  );

  state.concatenatedAudio = concatenatedAudio;
  state.srtContent = srtContent;

  return state;
}
