import { describe, it, expect } from "vitest";
import { formatSrtTime, generateSrt } from "../utils/srt";
import { getWavDuration } from "../utils/audio";

describe("formatSrtTime", () => {
  it("formats zero", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
  });

  it("formats seconds only", () => {
    expect(formatSrtTime(5.5)).toBe("00:00:05,500");
  });

  it("formats minutes and seconds", () => {
    expect(formatSrtTime(65.123)).toBe("00:01:05,123");
  });

  it("formats hours, minutes, seconds", () => {
    expect(formatSrtTime(3661.5)).toBe("01:01:01,500");
  });

  it("formats fractional milliseconds (truncates)", () => {
    expect(formatSrtTime(1.0999)).toBe("00:00:01,099");
  });

  it("handles exact seconds", () => {
    expect(formatSrtTime(10.0)).toBe("00:00:10,000");
  });
});

describe("generateSrt", () => {
  it("generates correct SRT format", () => {
    const segments = [
      { text: "第一句", duration: 5.0 },
      { text: "第二句", duration: 3.5 },
    ];

    const srt = generateSrt(segments);

    expect(srt).toContain("1\n00:00:00,000 --> 00:00:05,000\n第一句");
    expect(srt).toContain("2\n00:00:05,000 --> 00:00:08,500\n第二句");
  });

  it("generates empty string for empty segments", () => {
    expect(generateSrt([])).toBe("");
  });

  it("accumulates time correctly across segments", () => {
    const segments = [
      { text: "A", duration: 10.099 },
      { text: "B", duration: 27.7 },
    ];

    const srt = generateSrt(segments);

    // First segment: 0 -> 10.099
    expect(srt).toContain("00:00:00,000 --> 00:00:10,099");
    // Second segment: 10.099 + 27.7 ≈ 37.799 (float precision → 37.798)
    expect(srt).toContain("00:00:10,099 --> 00:00:37,798");
  });

  it("indexes start from 1", () => {
    const segments = [{ text: "only", duration: 1.0 }];
    const srt = generateSrt(segments);
    expect(srt.startsWith("1\n")).toBe(true);
  });
});

describe("getWavDuration", () => {
  /**
   * Create a minimal valid WAV file buffer.
   * 16-bit PCM, mono, at given sample rate and number of samples.
   */
  function createWavBuffer(
    sampleRate: number,
    numSamples: number,
    channels: number = 1,
    bitsPerSample: number = 16
  ): ArrayBuffer {
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = numSamples * channels * bytesPerSample;
    const bufferSize = 44 + dataSize; // 44-byte header + data
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, "RIFF");
    view.setUint32(4, bufferSize - 8, true); // file size - 8
    writeString(view, 8, "WAVE");

    // fmt chunk
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(
      28,
      sampleRate * channels * bytesPerSample,
      true
    ); // byte rate
    view.setUint16(32, channels * bytesPerSample, true); // block align
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Fill with silence (zeros - already default)

    return buffer;
  }

  function writeString(
    view: DataView,
    offset: number,
    str: string
  ): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  it("calculates duration for 1-second mono audio", () => {
    const buffer = createWavBuffer(16000, 16000); // 16kHz, 16000 samples = 1s
    const duration = getWavDuration(buffer);
    expect(duration).toBeCloseTo(1.0, 5);
  });

  it("calculates duration for stereo audio", () => {
    const buffer = createWavBuffer(44100, 44100, 2); // 44.1kHz, stereo, 1s
    const duration = getWavDuration(buffer);
    expect(duration).toBeCloseTo(1.0, 5);
  });

  it("calculates fractional durations", () => {
    const buffer = createWavBuffer(16000, 8000); // 0.5s
    const duration = getWavDuration(buffer);
    expect(duration).toBeCloseTo(0.5, 5);
  });

  it("throws for invalid WAV file", () => {
    const buffer = new ArrayBuffer(10);
    expect(() => getWavDuration(buffer)).toThrow(
      "Invalid WAV file: no data chunk found"
    );
  });
});
