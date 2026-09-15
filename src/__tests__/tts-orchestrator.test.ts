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
  TRIM_SILENCE_THRESHOLD_DB: -50,
  TRIM_SILENCE_KEEP_SEC: 0.1,
}));

// Mock audio.ts getWavDuration (needs real WAV headers)
vi.mock("../utils/audio", () => ({
  getWavDuration: vi.fn(),
  estimateTrimmedWavDuration: vi.fn(),
}));

import { sendZeroShotRequest, uploadPromptVoice } from "../services/tts-client";
import { concatWavsWithCrossfade } from "../services/ffmpeg-service";
import { getWavDuration, estimateTrimmedWavDuration } from "../utils/audio";

const mockSendZeroShot = vi.mocked(sendZeroShotRequest);
const mockUploadPromptVoice = vi.mocked(uploadPromptVoice);
const mockConcatWavs = vi.mocked(concatWavsWithCrossfade);
const mockGetWavDuration = vi.mocked(getWavDuration);
const mockEstimateTrimmed = vi.mocked(estimateTrimmedWavDuration);

// --- Helpers ---

const fakeConfig: TtsConfig = getConfig();
const fakeAudio = new ArrayBuffer(100);
const fakeConcatAudio = new ArrayBuffer(500);

function makeGenerateAllConfig(overrides?: Partial<GenerateAllConfig>): GenerateAllConfig {
  return {
    segments: [
      { text: "第一句話" },
      { text: "第二句話" },
      { text: "第三句話" },
    ],
    promptVoiceFile: new Blob(["audio"]),
    promptVoiceText: "prompt text",
    config: fakeConfig,
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
    mockEstimateTrimmed.mockReturnValue(3.0);
    mockConcatWavs.mockResolvedValue(fakeConcatAudio);
  });

  it("measures trimmedDuration alongside duration for every generated segment", async () => {
    const config = makeGenerateAllConfig({
      segments: [{ text: "第一句" }, { text: "第二句" }],
    });
    const result = await generateAll(config);
    expect(result.segments.map((s) => s.duration)).toEqual([3.5, 3.5]);
    expect(result.segments.map((s) => s.trimmedDuration)).toEqual([3.0, 3.0]);
  });

  it("records trimmedDuration even when trimSilence is off (read-time decision)", async () => {
    const config = makeGenerateAllConfig({
      segments: [{ text: "第一句" }, { text: "第二句" }],
      trimSilence: false,
    });
    const result = await generateAll(config);
    // The measurement is config-independent; consumers ignore it when the
    // setting is off, so toggling the setting needs no regeneration.
    expect(result.segments[0].trimmedDuration).toBe(3.0);
  });

  it("leaves trimmedDuration unset on failed segments", async () => {
    mockSendZeroShot
      .mockResolvedValueOnce(fakeAudio)
      .mockRejectedValueOnce(new Error("API error"));
    const result = await generateAll(
      makeGenerateAllConfig({
        segments: [{ text: "成功" }, { text: "失敗" }],
        maxRetries: 0,
      }),
    );
    expect(result.segments[0].trimmedDuration).toBe(3.0);
    expect(result.segments[1].trimmedDuration).toBeUndefined();
  });

  it("executes pipeline: build segments → upload → generate → concat", async () => {
    const config = makeGenerateAllConfig({
      segments: [{ text: "第一句" }, { text: "第二句" }],
    });

    const result = await generateAll(config);

    expect(mockUploadPromptVoice).toHaveBeenCalledOnce();
    expect(mockSendZeroShot).toHaveBeenCalledTimes(2);
    expect(mockConcatWavs).toHaveBeenCalledOnce();

    expect(result.promptVoiceAssetKey).toBe("asset-key-abc");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe("第一句");
    expect(result.segments[1].text).toBe("第二句");
    expect(result.segments[0].status).toBe("success");
    expect(result.segments[1].status).toBe("success");
    expect(result.concatenatedAudio).toBe(fakeConcatAudio);
  });

  it("handles partial failure — some segments fail", async () => {
    mockSendZeroShot
      .mockResolvedValueOnce(fakeAudio)
      .mockRejectedValueOnce(new Error("API error"));

    const config = makeGenerateAllConfig({
      segments: [{ text: "成功句" }, { text: "失敗句" }],
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
      "tri",
      expect.any(Function),
      { trimSilence: true },
    );
  });

  it("handles total failure — all segments fail", async () => {
    mockSendZeroShot.mockRejectedValue(new Error("server down"));

    const config = makeGenerateAllConfig({
      segments: [{ text: "句子一" }, { text: "句子二" }],
      maxRetries: 0,
    });

    const result = await generateAll(config);

    expect(result.segments.every((s) => s.status === "error")).toBe(true);
    // No concat when all fail
    expect(mockConcatWavs).not.toHaveBeenCalled();
    expect(result.concatenatedAudio).toBeUndefined();
  });

  it("calls onSegmentUpdate callbacks during generation", async () => {
    const onSegmentUpdate = vi.fn();

    const config = makeGenerateAllConfig({ segments: [{ text: "唯一一句" }] });
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

    const config = makeGenerateAllConfig({
      segments: [{ text: "第一句" }, { text: "第二句" }],
    });
    await generateAll(config, { onProgress });

    expect(onProgress).toHaveBeenCalled();
    // Final call should have completed === total
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBe(lastCall[1]); // completed === total
    expect(lastCall[0]).toBeGreaterThanOrEqual(1);
  });

  it("calls onConcatComplete callback", async () => {
    const onConcatComplete = vi.fn();

    const config = makeGenerateAllConfig({ segments: [{ text: "一句話" }] });
    await generateAll(config, { onConcatComplete });

    expect(onConcatComplete).toHaveBeenCalledWith(fakeConcatAudio);
  });

  it("passes language and addEndSilence to TTS request", async () => {
    const config = makeGenerateAllConfig({
      segments: [{ text: "測試" }],
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
      segments: [{ text: "甲" }, { text: "乙" }],
      crossfadeDuration: 0.1,
      fadeCurve: "hsin",
    });

    await generateAll(config);

    expect(mockConcatWavs).toHaveBeenCalledWith(
      expect.any(Array),
      0.1,
      "hsin",
      expect.any(Function),
      { trimSilence: true },
    );
  });

  it("preserves wordSegmentation in output segments", async () => {
    const wordSeg = [
      {
        word: "佛七",
        tailo: "huat4-tshit4",
        tailoList: ["huat4-tshit4"],
        inVocab: true,
        useTailo: false,
      },
    ];

    const config = makeGenerateAllConfig({
      segments: [{ text: "佛七法會", wordSegmentation: wordSeg }],
    });

    const result = await generateAll(config);

    expect(result.segments[0].wordSegmentation).toEqual(wordSeg);
  });

  it("uses tailo pronunciation in TTS request when useTailo is true", async () => {
    const wordSeg = [
      {
        word: "佛七",
        tailo: "huat4-tshit4",
        tailoList: ["huat4-tshit4"],
        inVocab: true,
        useTailo: true,
      },
      {
        word: "法會",
        tailo: "huat-hue",
        tailoList: ["huat-hue"],
        inVocab: true,
        useTailo: false,
      },
    ];

    const config = makeGenerateAllConfig({
      segments: [{ text: "佛七法會", wordSegmentation: wordSeg }],
    });

    await generateAll(config);

    expect(mockSendZeroShot).toHaveBeenCalledWith(
      expect.objectContaining({ text: "huat4-tshit4法會" }),
      fakeConfig,
    );
  });

  it("throws when segments array is empty", async () => {
    const config = makeGenerateAllConfig({ segments: [] });
    await expect(generateAll(config)).rejects.toThrow(
      "requires at least one segment",
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

describe("tail artifact cleaning at audio ingestion", () => {
  // 1 kHz tone (-20 dB), 100 ms silence, then a 12 ms full-scale burst — the
  // artifact shape measured on real TTS output.
  function burstWav(): ArrayBuffer {
    const sr = 24000;
    const parts: [number, number][] = [[200, 0.1], [100, 0], [12, 1]];
    const frames = parts.reduce((a, [ms]) => a + (ms * sr) / 1000, 0);
    const buf = new ArrayBuffer(44 + frames * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + frames * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, frames * 2, true);
    let f = 0;
    for (const [ms, amp] of parts) {
      for (let i = 0; i < (ms * sr) / 1000; i++, f++) {
        v.setInt16(44 + f * 2, Math.round(Math.min(32767, amp * 32767) * Math.sin((2 * Math.PI * 1000 * f) / sr)), true);
      }
    }
    return buf;
  }
  const CUT_BYTES = 12 * 24 * 2;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadPromptVoice.mockResolvedValue("asset-key-abc");
    mockGetWavDuration.mockReturnValue(3.5);
    mockEstimateTrimmed.mockReturnValue(3.0);
    mockConcatWavs.mockResolvedValue(fakeConcatAudio);
  });

  it("generateAll stores cleaned audio and records how much was cut", async () => {
    const raw = burstWav();
    mockSendZeroShot.mockResolvedValue(raw);
    const result = await generateAll(makeGenerateAllConfig({ segments: [{ text: "甲" }, { text: "乙" }] }));
    for (const seg of result.segments) {
      expect(seg.audio!.byteLength).toBe(raw.byteLength - CUT_BYTES);
      expect(seg.tailCutMs).toBe(12);
    }
  });

  it("measures durations on the cleaned audio, not the raw response", async () => {
    const raw = burstWav();
    mockSendZeroShot.mockResolvedValue(raw);
    await generateAll(makeGenerateAllConfig({ segments: [{ text: "甲" }] }));
    expect(mockGetWavDuration.mock.calls[0][0].byteLength).toBe(raw.byteLength - CUT_BYTES);
    expect(mockEstimateTrimmed.mock.calls[0][0].byteLength).toBe(raw.byteLength - CUT_BYTES);
  });

  it("concatenates the cleaned audio", async () => {
    const raw = burstWav();
    mockSendZeroShot.mockResolvedValue(raw);
    await generateAll(makeGenerateAllConfig({ segments: [{ text: "甲" }, { text: "乙" }] }));
    const inputs = mockConcatWavs.mock.calls[0][0] as ArrayBuffer[];
    expect(inputs.map((b) => b.byteLength)).toEqual([raw.byteLength - CUT_BYTES, raw.byteLength - CUT_BYTES]);
  });

  it("regenerateSegment and regenerateSentence clean too", async () => {
    const raw = burstWav();
    mockSendZeroShot.mockResolvedValue(raw);
    const one = await regenerateSegment(makePipelineState(2), 0, makeRegenerateConfig());
    expect(one.segments[0].tailCutMs).toBe(12);
    const all = await regenerateSentence(makePipelineState(2), makeRegenerateConfig());
    expect(all.segments.every((s) => s.tailCutMs === 12)).toBe(true);
  });

  it("leaves audio that needs no cleaning without a tailCutMs", async () => {
    mockSendZeroShot.mockResolvedValue(fakeAudio); // not a parseable WAV → returned untouched
    const result = await generateAll(makeGenerateAllConfig({ segments: [{ text: "甲" }] }));
    expect(result.segments[0].audio).toBe(fakeAudio);
    expect(result.segments[0].tailCutMs).toBeUndefined();
  });
});
