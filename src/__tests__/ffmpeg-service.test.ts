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
  toBlobURL: vi.fn().mockResolvedValue("blob:mock"),
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array()),
}));

// Import after mocks
const {
  padAudioWithSilence,
  concatWavsWithCrossfade,
  terminateFFmpeg,
} = await import("../services/ffmpeg-service");

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
});

describe("terminateFFmpeg", () => {
  it("can be called without error", async () => {
    await expect(terminateFFmpeg()).resolves.not.toThrow();
  });
});
