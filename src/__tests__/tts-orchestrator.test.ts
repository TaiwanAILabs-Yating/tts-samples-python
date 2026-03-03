import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateAll,
  regenerateSegment,
  regenerateSentence,
} from "../services/tts-orchestrator";
import type {
  PipelineState,
  SegmentState,
  GenerateAllConfig,
  RegenerateConfig,
  OrchestratorCallbacks,
} from "../services/tts-orchestrator";
import type { TtsConfig } from "../config/index";
import { getConfig } from "../config/index";

// --- Mocks ---

// Mock tts-client (network I/O)
vi.mock("../services/tts-client", () => ({
  sendZeroShotRequest: vi.fn(),
  uploadPromptVoice: vi.fn(),
}));

// Mock ffmpeg-service (heavy binary)
vi.mock("../services/ffmpeg-service", () => ({
  concatWavsWithCrossfade: vi.fn(),
}));

// Mock audio.ts getWavDuration (needs real WAV headers)
vi.mock("../utils/audio", () => ({
  getWavDuration: vi.fn(),
}));

import { sendZeroShotRequest, uploadPromptVoice } from "../services/tts-client";
import { concatWavsWithCrossfade } from "../services/ffmpeg-service";
import { getWavDuration } from "../utils/audio";

const mockSendZeroShot = vi.mocked(sendZeroShotRequest);
const mockUploadPromptVoice = vi.mocked(uploadPromptVoice);
const mockConcatWavs = vi.mocked(concatWavsWithCrossfade);
const mockGetWavDuration = vi.mocked(getWavDuration);

// --- Helpers ---

const fakeConfig: TtsConfig = getConfig();
const fakeAudio = new ArrayBuffer(100);
const fakeConcatAudio = new ArrayBuffer(500);

function makeGenerateAllConfig(overrides?: Partial<GenerateAllConfig>): GenerateAllConfig {
  return {
    text: "第一句話。第二句話。第三句話。",
    promptVoiceFile: new Blob(["audio"]),
    promptVoiceText: "prompt text",
    config: fakeConfig,
    minTokens: 1,
    maxTokens: 4,
    concurrency: 3,
    maxRetries: 0,
    retryBaseDelay: 0.001,
    ...overrides,
  };
}

function makeRegenerateConfig(overrides?: Partial<RegenerateConfig>): RegenerateConfig {
  return {
    config: fakeConfig,
    maxRetries: 0,
    retryBaseDelay: 0.001,
    ...overrides,
  };
}

function makePipelineState(segmentCount: number): PipelineState {
  const segments: SegmentState[] = Array.from({ length: segmentCount }, (_, i) => ({
    index: i,
    text: `Segment ${i}`,
    status: "success" as const,
    audio: new ArrayBuffer(50 + i),
    duration: 2.0 + i * 0.5,
    attempts: 1,
    history: [],
  }));
  return {
    segments,
    concatenatedAudio: fakeConcatAudio,
    srtContent: "1\n00:00:00,000 --> 00:00:02,000\nSegment 0\n",
    promptVoiceAssetKey: "asset-key-123",
  };
}

// --- Tests ---

describe("generateAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadPromptVoice.mockResolvedValue("asset-key-abc");
    mockSendZeroShot.mockResolvedValue(fakeAudio);
    mockGetWavDuration.mockReturnValue(3.5);
    mockConcatWavs.mockResolvedValue(fakeConcatAudio);
  });

  it("executes full pipeline: preprocess → split → upload → generate → concat → SRT", async () => {
    const config = makeGenerateAllConfig({
      text: "第一句。第二句。",
    });

    const result = await generateAll(config);

    expect(mockUploadPromptVoice).toHaveBeenCalledOnce();
    expect(mockSendZeroShot).toHaveBeenCalledTimes(2);
    expect(mockConcatWavs).toHaveBeenCalledOnce();

    expect(result.promptVoiceAssetKey).toBe("asset-key-abc");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].status).toBe("success");
    expect(result.segments[1].status).toBe("success");
    expect(result.concatenatedAudio).toBe(fakeConcatAudio);
    expect(result.srtContent).toBeDefined();
    expect(result.srtContent).toContain("第一句。");
    expect(result.srtContent).toContain("第二句。");
  });

  it("handles partial failure — some segments fail", async () => {
    mockSendZeroShot
      .mockResolvedValueOnce(fakeAudio)
      .mockRejectedValueOnce(new Error("API error"));

    const config = makeGenerateAllConfig({
      text: "成功句。失敗句。",
      maxRetries: 0,
    });

    const result = await generateAll(config);

    expect(result.segments[0].status).toBe("success");
    expect(result.segments[1].status).toBe("error");
    expect(result.segments[1].error).toContain("API error");
    // Concat should still work with successful segments only
    expect(mockConcatWavs).toHaveBeenCalledWith(
      [fakeAudio],
      0.05,
      "tri"
    );
  });

  it("handles total failure — all segments fail", async () => {
    mockSendZeroShot.mockRejectedValue(new Error("server down"));

    const config = makeGenerateAllConfig({
      text: "句子一。句子二。",
      maxRetries: 0,
    });

    const result = await generateAll(config);

    expect(result.segments.every((s) => s.status === "error")).toBe(true);
    // No concat or SRT when all fail
    expect(mockConcatWavs).not.toHaveBeenCalled();
    expect(result.concatenatedAudio).toBeUndefined();
    expect(result.srtContent).toBeUndefined();
  });

  it("calls onSegmentUpdate callbacks during generation", async () => {
    const onSegmentUpdate = vi.fn();

    const config = makeGenerateAllConfig({ text: "唯一一句。" });
    await generateAll(config, { onSegmentUpdate });

    // Called twice: once for "generating", once for "success"
    expect(onSegmentUpdate).toHaveBeenCalledTimes(2);

    const firstCall = onSegmentUpdate.mock.calls[0];
    expect(firstCall[0]).toBe(0);
    expect(firstCall[1].status).toBe("generating");

    const secondCall = onSegmentUpdate.mock.calls[1];
    expect(secondCall[0]).toBe(0);
    expect(secondCall[1].status).toBe("success");
  });

  it("calls onProgress callback", async () => {
    const onProgress = vi.fn();

    const config = makeGenerateAllConfig({ text: "第一句。第二句。" });
    await generateAll(config, { onProgress });

    expect(onProgress).toHaveBeenCalled();
    // Final call should have completed === total
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(lastCall[1]); // completed === total
    expect(lastCall[0]).toBeGreaterThanOrEqual(1);
  });

  it("calls onConcatComplete and onSrtComplete callbacks", async () => {
    const onConcatComplete = vi.fn();
    const onSrtComplete = vi.fn();

    const config = makeGenerateAllConfig({ text: "一句話。" });
    await generateAll(config, { onConcatComplete, onSrtComplete });

    expect(onConcatComplete).toHaveBeenCalledWith(fakeConcatAudio);
    expect(onSrtComplete).toHaveBeenCalledWith(expect.stringContaining("一句話。"));
  });

  it("passes language and addEndSilence to TTS request", async () => {
    const config = makeGenerateAllConfig({
      text: "測試。",
      language: "nan",
      addEndSilence: true,
      promptLanguage: "zh",
    });

    await generateAll(config);

    expect(mockSendZeroShot).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "nan",
        addEndSilence: true,
        promptLanguage: "zh",
      }),
      fakeConfig
    );
  });

  it("uses custom crossfade settings", async () => {
    const config = makeGenerateAllConfig({
      text: "甲。乙。",
      crossfadeDuration: 0.1,
      fadeCurve: "hsin",
    });

    await generateAll(config);

    expect(mockConcatWavs).toHaveBeenCalledWith(
      expect.any(Array),
      0.1,
      "hsin"
    );
  });
});

describe("regenerateSegment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendZeroShot.mockResolvedValue(fakeAudio);
    mockGetWavDuration.mockReturnValue(4.0);
    mockConcatWavs.mockResolvedValue(fakeConcatAudio);
  });

  it("regenerates a single segment and re-concats", async () => {
    const state = makePipelineState(3);
    const rConfig = makeRegenerateConfig();

    const result = await regenerateSegment(state, 1, rConfig);

    expect(mockSendZeroShot).toHaveBeenCalledOnce();
    expect(result.segments[1].status).toBe("success");
    expect(result.segments[1].audio).toBe(fakeAudio);
    expect(result.segments[1].duration).toBe(4.0);
    expect(mockConcatWavs).toHaveBeenCalledOnce();
    expect(result.srtContent).toBeDefined();
  });

  it("saves old version to history before regenerating (AC-30)", async () => {
    const state = makePipelineState(2);
    const oldAudio = state.segments[0].audio;
    const oldDuration = state.segments[0].duration;

    await regenerateSegment(state, 0, makeRegenerateConfig());

    expect(state.segments[0].history).toHaveLength(1);
    expect(state.segments[0].history[0].audio).toBe(oldAudio);
    expect(state.segments[0].history[0].duration).toBe(oldDuration);
    expect(state.segments[0].history[0].timestamp).toBeGreaterThan(0);
  });

  it("accumulates history entries on multiple regenerations", async () => {
    const state = makePipelineState(1);

    await regenerateSegment(state, 0, makeRegenerateConfig());
    await regenerateSegment(state, 0, makeRegenerateConfig());

    expect(state.segments[0].history).toHaveLength(2);
  });

  it("handles regeneration failure gracefully", async () => {
    mockSendZeroShot.mockRejectedValue(new Error("timeout"));

    const state = makePipelineState(2);
    const rConfig = makeRegenerateConfig({ maxRetries: 0 });

    await regenerateSegment(state, 0, rConfig);

    expect(state.segments[0].status).toBe("error");
    expect(state.segments[0].error).toContain("timeout");
    // History should still have the old version
    expect(state.segments[0].history).toHaveLength(1);
    // Re-concat still happens with remaining successful segments
    expect(mockConcatWavs).toHaveBeenCalled();
  });

  it("throws on invalid segment index", async () => {
    const state = makePipelineState(2);
    await expect(
      regenerateSegment(state, 5, makeRegenerateConfig())
    ).rejects.toThrow("out of range");
  });

  it("throws when no prompt voice asset key", async () => {
    const state = makePipelineState(1);
    state.promptVoiceAssetKey = undefined;
    await expect(
      regenerateSegment(state, 0, makeRegenerateConfig())
    ).rejects.toThrow("No prompt voice asset key");
  });

  it("calls onSegmentUpdate during regeneration", async () => {
    const onSegmentUpdate = vi.fn();
    const state = makePipelineState(2);

    await regenerateSegment(state, 1, makeRegenerateConfig(), { onSegmentUpdate });

    expect(onSegmentUpdate).toHaveBeenCalledTimes(2);
    expect(onSegmentUpdate.mock.calls[0][1].status).toBe("generating");
    expect(onSegmentUpdate.mock.calls[1][1].status).toBe("success");
  });
});

describe("regenerateSentence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendZeroShot.mockResolvedValue(fakeAudio);
    mockGetWavDuration.mockReturnValue(3.0);
    mockConcatWavs.mockResolvedValue(fakeConcatAudio);
  });

  it("regenerates all segments and re-concats (AC-29)", async () => {
    const state = makePipelineState(3);
    const rConfig = makeRegenerateConfig();

    const result = await regenerateSentence(state, rConfig);

    expect(mockSendZeroShot).toHaveBeenCalledTimes(3);
    expect(result.segments.every((s) => s.status === "success")).toBe(true);
    expect(mockConcatWavs).toHaveBeenCalledOnce();
    expect(result.srtContent).toBeDefined();
  });

  it("saves all existing versions to history (AC-30)", async () => {
    const state = makePipelineState(2);
    const oldAudios = state.segments.map((s) => s.audio);

    await regenerateSentence(state, makeRegenerateConfig());

    for (let i = 0; i < 2; i++) {
      expect(state.segments[i].history).toHaveLength(1);
      expect(state.segments[i].history[0].audio).toBe(oldAudios[i]);
    }
  });

  it("calls onProgress callback", async () => {
    const onProgress = vi.fn();
    const state = makePipelineState(3);

    await regenerateSentence(state, makeRegenerateConfig(), { onProgress });

    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(3);
    expect(lastCall[1]).toBe(3);
  });

  it("throws when no prompt voice asset key", async () => {
    const state = makePipelineState(1);
    state.promptVoiceAssetKey = undefined;
    await expect(
      regenerateSentence(state, makeRegenerateConfig())
    ).rejects.toThrow("No prompt voice asset key");
  });
});
