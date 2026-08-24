import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ffmpeg/ffmpeg and @ffmpeg/util before importing the service
const mockExec = vi.fn().mockResolvedValue(0);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi
  .fn()
  .mockResolvedValue(new Uint8Array([1, 2, 3]));
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);
const mockLoad = vi.fn().mockResolvedValue(undefined);
const mockTerminate = vi.fn();
const mockToBlobURL = vi.fn().mockResolvedValue("blob:mock");

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: vi.fn().mockImplementation(() => ({
    loaded: true,
    load: mockLoad,
    exec: mockExec,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    deleteFile: mockDeleteFile,
    terminate: mockTerminate,
  })),
}));

vi.mock("@ffmpeg/util", () => ({
  toBlobURL: (...args: unknown[]) => mockToBlobURL(...args),
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array()),
}));

// Import after mocks
const {
  padAudioWithSilence,
  concatWavsWithCrossfade,
  preloadFFmpeg,
  terminateFFmpeg,
  computeConcatTimeout,
  buildConcatFilterComplex,
  CONCAT_BATCH_SIZE,
  TRIM_SILENCE_THRESHOLD_DB,
  TRIM_SILENCE_KEEP_SEC,
} = await import("../services/ffmpeg-service");
type ConcatProgress = import("../services/ffmpeg-service").ConcatProgress;

describe("padAudioWithSilence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns original data when no padding needed", async () => {
    const input = new ArrayBuffer(100);
    const result = await padAudioWithSilence(input, 0, 0);
    expect(result).toBe(input);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("applies start silence with adelay filter", async () => {
    const input = new ArrayBuffer(100);
    await padAudioWithSilence(input, 0.5, 0);

    expect(mockExec).toHaveBeenCalledWith([
      "-i",
      "pad_input.wav",
      "-af",
      "adelay=500|500",
      "pad_output.wav",
    ]);
  });

  it("applies end silence with apad filter", async () => {
    const input = new ArrayBuffer(100);
    await padAudioWithSilence(input, 0, 0.3);

    expect(mockExec).toHaveBeenCalledWith([
      "-i",
      "pad_input.wav",
      "-af",
      "apad=pad_dur=0.3",
      "pad_output.wav",
    ]);
  });

  it("applies both start and end silence", async () => {
    const input = new ArrayBuffer(100);
    await padAudioWithSilence(input, 0.2, 0.5);

    expect(mockExec).toHaveBeenCalledWith([
      "-i",
      "pad_input.wav",
      "-af",
      "adelay=200|200,apad=pad_dur=0.5",
      "pad_output.wav",
    ]);
  });

  it("cleans up virtual files after processing", async () => {
    const input = new ArrayBuffer(100);
    await padAudioWithSilence(input, 0.1, 0);

    expect(mockDeleteFile).toHaveBeenCalledWith("pad_input.wav");
    expect(mockDeleteFile).toHaveBeenCalledWith("pad_output.wav");
  });
});

describe("concatWavsWithCrossfade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws for empty input", async () => {
    await expect(concatWavsWithCrossfade([])).rejects.toThrow(
      "No audio files to concatenate"
    );
  });

  it("returns single buffer unchanged", async () => {
    const input = new ArrayBuffer(100);
    const result = await concatWavsWithCrossfade([input]);
    expect(result).toBe(input);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("uses simple crossfade for 2 files", async () => {
    const buf1 = new ArrayBuffer(100);
    const buf2 = new ArrayBuffer(200);
    await concatWavsWithCrossfade([buf1, buf2], 0.05, "tri");

    expect(mockExec).toHaveBeenCalledWith([
      "-i",
      "crossfade_input_0.wav",
      "-i",
      "crossfade_input_1.wav",
      "-filter_complex",
      "[0][1]acrossfade=d=0.05:c1=tri:c2=tri",
      "crossfade_output.wav",
    ]);
  });

  it("chains crossfades for 3+ files", async () => {
    const bufs = [
      new ArrayBuffer(100),
      new ArrayBuffer(100),
      new ArrayBuffer(100),
    ];
    await concatWavsWithCrossfade(bufs, 0.05, "hsin");

    const call = mockExec.mock.calls[0][0];
    const filterComplex = call[call.indexOf("-filter_complex") + 1];
    expect(filterComplex).toBe(
      "[0][1]acrossfade=d=0.05:c1=hsin:c2=hsin[a0];[a0][2]acrossfade=d=0.05:c1=hsin:c2=hsin"
    );
  });

  it("chains crossfades for 4 files", async () => {
    const bufs = Array.from({ length: 4 }, () => new ArrayBuffer(100));
    await concatWavsWithCrossfade(bufs, 0.03, "exp");

    const call = mockExec.mock.calls[0][0];
    const filterComplex = call[call.indexOf("-filter_complex") + 1];
    expect(filterComplex).toBe(
      "[0][1]acrossfade=d=0.03:c1=exp:c2=exp[a0];" +
        "[a0][2]acrossfade=d=0.03:c1=exp:c2=exp[a1];" +
        "[a1][3]acrossfade=d=0.03:c1=exp:c2=exp"
    );
  });

  it("cleans up all virtual files", async () => {
    const bufs = [new ArrayBuffer(100), new ArrayBuffer(100)];
    await concatWavsWithCrossfade(bufs);

    expect(mockDeleteFile).toHaveBeenCalledWith(
      "crossfade_input_0.wav"
    );
    expect(mockDeleteFile).toHaveBeenCalledWith(
      "crossfade_input_1.wav"
    );
    expect(mockDeleteFile).toHaveBeenCalledWith(
      "crossfade_output.wav"
    );
  });

  it("uses single-pass when N === CONCAT_BATCH_SIZE", async () => {
    const bufs = Array.from({ length: CONCAT_BATCH_SIZE }, () => new ArrayBuffer(100));
    await concatWavsWithCrossfade(bufs);
    // Single exec call, single output file label
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith("crossfade_output.wav");
  });

  it("uses two passes when N === CONCAT_BATCH_SIZE + 1", async () => {
    const bufs = Array.from(
      { length: CONCAT_BATCH_SIZE + 1 },
      () => new ArrayBuffer(100),
    );
    await concatWavsWithCrossfade(bufs);
    // Pass 1: 2 batches (50 + 1 → but second batch has 1 file, returned as-is, no exec)
    // Pass 2: 1 final exec to merge
    // So: 1 exec for batch 0 (50 files) + 0 for batch 1 (1 file → early-returned) + 1 for pass2 = 2
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("uses two passes when N=110 (3 batches + 1 merge = 4 execs)", async () => {
    const bufs = Array.from({ length: 110 }, () => new ArrayBuffer(100));
    await concatWavsWithCrossfade(bufs);
    // Pass 1: 3 batches (50 + 50 + 10) → 3 exec; Pass 2: 1 merge → 1 exec; total 4
    expect(mockExec).toHaveBeenCalledTimes(4);
  });

  it("invokes onProgress with pass1/pass2/done sequence", async () => {
    const bufs = Array.from({ length: 110 }, () => new ArrayBuffer(100));
    const progress: ConcatProgress[] = [];
    await concatWavsWithCrossfade(bufs, 0.05, "tri", (info) => {
      progress.push(info);
    });
    // Expect real progress shape, including FFmpeg exec progress.
    expect(progress).toEqual([
      { phase: "pass1", current: 0, total: 3, progress: 0 },
      { phase: "pass1", current: 0, total: 3, progress: 1 },
      { phase: "pass1", current: 1, total: 3, progress: 0 },
      { phase: "pass1", current: 1, total: 3, progress: 1 },
      { phase: "pass1", current: 2, total: 3, progress: 0 },
      { phase: "pass1", current: 2, total: 3, progress: 1 },
      { phase: "pass2", current: 0, total: 1, progress: 0 },
      { phase: "pass2", current: 0, total: 1, progress: 1 },
      { phase: "done", current: 1, total: 1, progress: 1 },
    ]);
  });

  it("invokes onProgress for single-pass case", async () => {
    const bufs = Array.from({ length: CONCAT_BATCH_SIZE }, () => new ArrayBuffer(100));
    const progress: ConcatProgress[] = [];
    await concatWavsWithCrossfade(bufs, 0.05, "tri", (info) => {
      progress.push(info);
    });
    expect(progress).toEqual([
      { phase: "pass1", current: 0, total: 1, progress: 0 },
      { phase: "pass1", current: 0, total: 1, progress: 1 },
      { phase: "done", current: 1, total: 1, progress: 1 },
    ]);
  });
});

describe("buildConcatFilterComplex", () => {
  const base = { crossfadeDuration: 0.05, fadeCurve: "hsin" as const };

  it("builds simple crossfade for 2 inputs without trim", () => {
    expect(buildConcatFilterComplex(2, base)).toBe(
      "[0][1]acrossfade=d=0.05:c1=hsin:c2=hsin",
    );
  });

  it("chains crossfades for 4 inputs without trim", () => {
    expect(buildConcatFilterComplex(4, base)).toBe(
      "[0][1]acrossfade=d=0.05:c1=hsin:c2=hsin[a0];" +
        "[a0][2]acrossfade=d=0.05:c1=hsin:c2=hsin[a1];" +
        "[a1][3]acrossfade=d=0.05:c1=hsin:c2=hsin",
    );
  });

  it("prepends per-input silenceremove when trim is enabled (2 inputs)", () => {
    const trim = { thresholdDb: -50, keepSec: 0.1 };
    const sr =
      "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1:" +
      "stop_periods=1:stop_threshold=-50dB:stop_silence=0.1:detection=rms";
    expect(buildConcatFilterComplex(2, { ...base, trim })).toBe(
      `[0]${sr}[s0];[1]${sr}[s1];[s0][s1]acrossfade=d=0.05:c1=hsin:c2=hsin`,
    );
  });

  it("prepends per-input silenceremove when trim is enabled (3 inputs)", () => {
    const trim = { thresholdDb: -50, keepSec: 0.1 };
    const out = buildConcatFilterComplex(3, { ...base, trim });
    expect(out).toContain("[0]silenceremove");
    expect(out).toContain("[1]silenceremove");
    expect(out).toContain("[2]silenceremove");
    expect(out).toContain("[s0][s1]acrossfade=d=0.05:c1=hsin:c2=hsin[a0]");
    expect(out).toContain("[a0][s2]acrossfade=d=0.05:c1=hsin:c2=hsin");
    expect(out.match(/silenceremove/g)).toHaveLength(3);
  });

  it("uses provided trim parameters in the filter", () => {
    const out = buildConcatFilterComplex(2, {
      ...base,
      trim: { thresholdDb: -40, keepSec: 0.2 },
    });
    expect(out).toContain("start_threshold=-40dB");
    expect(out).toContain("stop_threshold=-40dB");
    expect(out).toContain("start_silence=0.2");
    expect(out).toContain("stop_silence=0.2");
  });

  it("respects crossfade duration and curve", () => {
    expect(buildConcatFilterComplex(2, { crossfadeDuration: 0.1, fadeCurve: "tri" })).toBe(
      "[0][1]acrossfade=d=0.1:c1=tri:c2=tri",
    );
  });

  it("exports default trim constants", () => {
    expect(TRIM_SILENCE_THRESHOLD_DB).toBe(-50);
    expect(TRIM_SILENCE_KEEP_SEC).toBe(0.1);
  });
});

describe("concatWavsWithCrossfade with trimSilence", () => {
  beforeEach(() => {
    mockExec.mockClear();
  });

  const buffers = (n: number) => Array.from({ length: n }, () => new ArrayBuffer(8));

  it("includes silenceremove in filter_complex when trimSilence is true", async () => {
    await concatWavsWithCrossfade(buffers(3), 0.05, "hsin", undefined, {
      trimSilence: true,
    });
    const args = mockExec.mock.calls[0][0] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter.match(/silenceremove/g)).toHaveLength(3);
    expect(filter).toContain(`start_threshold=${TRIM_SILENCE_THRESHOLD_DB}dB`);
    expect(filter).toContain(`start_silence=${TRIM_SILENCE_KEEP_SEC}`);
  });

  it("omits silenceremove when trimSilence is false or unset", async () => {
    await concatWavsWithCrossfade(buffers(3), 0.05, "hsin");
    const args = mockExec.mock.calls[0][0] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).not.toContain("silenceremove");
  });

  it("applies trim only in pass1, not pass2, for hierarchical concat", async () => {
    await concatWavsWithCrossfade(buffers(CONCAT_BATCH_SIZE + 1), 0.05, "hsin", undefined, {
      trimSilence: true,
    });
    // Pass 1: batch of 50 (1 exec; leftover single-file batch needs no exec) + Pass 2: 1 exec
    expect(mockExec).toHaveBeenCalledTimes(2);
    const pass1Filter = (mockExec.mock.calls[0][0] as string[]).find((a: string) =>
      a.includes("acrossfade"),
    )!;
    const pass2Filter = (mockExec.mock.calls[1][0] as string[]).find((a: string) =>
      a.includes("acrossfade"),
    )!;
    expect(pass1Filter).toContain("silenceremove");
    expect(pass2Filter).not.toContain("silenceremove");
  });
});

describe("computeConcatTimeout", () => {
  it("returns base + 2s per file for small N", () => {
    expect(computeConcatTimeout(0)).toBe(30_000);
    expect(computeConcatTimeout(50)).toBe(130_000);
    expect(computeConcatTimeout(100)).toBe(230_000);
  });

  it("caps at 5 minutes for large N", () => {
    expect(computeConcatTimeout(135)).toBe(300_000);
    expect(computeConcatTimeout(500)).toBe(300_000);
    expect(computeConcatTimeout(10_000)).toBe(300_000);
  });
});

describe("terminateFFmpeg", () => {
  it("can be called without error", async () => {
    await expect(terminateFFmpeg()).resolves.not.toThrow();
  });
});

describe("FFmpeg loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton state by terminating any existing instance
    terminateFFmpeg();
  });

  it("calls toBlobURL with correct paths and MIME types", async () => {
    await preloadFFmpeg();

    expect(mockToBlobURL).toHaveBeenCalledWith(
      "/ffmpeg/ffmpeg-core.js",
      "text/javascript"
    );
    expect(mockToBlobURL).toHaveBeenCalledWith(
      "/ffmpeg/ffmpeg-core.wasm",
      "application/wasm"
    );
  });

  it("calls ffmpeg.load with blob URLs from toBlobURL", async () => {
    mockToBlobURL
      .mockResolvedValueOnce("blob:core-url")
      .mockResolvedValueOnce("blob:wasm-url");

    await preloadFFmpeg();

    expect(mockLoad).toHaveBeenCalledWith({
      coreURL: "blob:core-url",
      wasmURL: "blob:wasm-url",
    });
  });

  it("reuses loaded instance on subsequent calls", async () => {
    await preloadFFmpeg();
    await preloadFFmpeg();

    // toBlobURL should only be called once (2 calls for core + wasm)
    expect(mockToBlobURL).toHaveBeenCalledTimes(2);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it("allows retry after load failure", async () => {
    mockLoad.mockRejectedValueOnce(new Error("load failed"));

    await expect(preloadFFmpeg()).rejects.toThrow("load failed");

    // Reset mock for retry
    mockLoad.mockResolvedValueOnce(undefined);

    // Should succeed on retry (not reuse failed instance)
    await expect(preloadFFmpeg()).resolves.not.toThrow();
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });
});
