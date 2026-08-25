/**
 * Get WAV audio duration from an ArrayBuffer using WAV header parsing.
 *
 * This works in any environment (browser, Node, test) without Web Audio API.
 * Handles streaming WAV files where the header may contain placeholder values.
 */
export function getWavDuration(wavBuffer: ArrayBuffer): number {
  const bytes = new Uint8Array(wavBuffer);

  // Find 'data' chunk marker
  const dataMarker = [0x64, 0x61, 0x74, 0x61]; // 'data'
  let dataPos = -1;
  for (let i = 0; i < bytes.length - 4; i++) {
    if (
      bytes[i] === dataMarker[0] &&
      bytes[i + 1] === dataMarker[1] &&
      bytes[i + 2] === dataMarker[2] &&
      bytes[i + 3] === dataMarker[3]
    ) {
      dataPos = i;
      break;
    }
  }

  if (dataPos === -1) {
    throw new Error("Invalid WAV file: no data chunk found");
  }

  // Parse WAV header (RIFF format)
  const view = new DataView(wavBuffer);

  // Channels at offset 22 (2 bytes, little-endian)
  const nChannels = view.getUint16(22, true);
  // Sample rate at offset 24 (4 bytes, little-endian)
  const sampleRate = view.getUint32(24, true);
  // Bits per sample at offset 34 (2 bytes, little-endian)
  const bitsPerSample = view.getUint16(34, true);
  const sampleWidth = bitsPerSample / 8;

  // Data starts at dataPos + 8 (4 bytes 'data' + 4 bytes size field)
  const dataStart = dataPos + 8;
  const actualDataSize = bytes.length - dataStart;

  // Calculate duration from actual data size
  const bytesPerFrame = nChannels * sampleWidth;
  const actualFrames = Math.floor(actualDataSize / bytesPerFrame);

  return actualFrames / sampleRate;
}

/**
 * Estimate the duration a WAV will have after silenceremove head/tail trimming
 * (as applied at concat time — see ffmpeg-service buildConcatFilterComplex).
 *
 * Mirrors FFmpeg's behavior approximately: scans 16-bit PCM with 20ms RMS
 * windows; leading/trailing windows whose RMS is below `thresholdDb` count as
 * silence, and up to `keepSec` of silence is kept on each side.
 *
 * Used only for display (WaveformPlayer segment timeline) — small deviations
 * (~20ms) from FFmpeg's exact windowing are acceptable.
 *
 * Returns 0 when the whole buffer is below the threshold (FFmpeg outputs
 * empty audio in that case).
 */
export function estimateTrimmedWavDuration(
  wavBuffer: ArrayBuffer,
  thresholdDb: number,
  keepSec: number,
): number {
  const bytes = new Uint8Array(wavBuffer);
  const dataMarker = [0x64, 0x61, 0x74, 0x61]; // 'data'
  let dataPos = -1;
  for (let i = 0; i < bytes.length - 4; i++) {
    if (
      bytes[i] === dataMarker[0] &&
      bytes[i + 1] === dataMarker[1] &&
      bytes[i + 2] === dataMarker[2] &&
      bytes[i + 3] === dataMarker[3]
    ) {
      dataPos = i;
      break;
    }
  }
  if (dataPos === -1) {
    throw new Error("Invalid WAV file: no data chunk found");
  }

  const view = new DataView(wavBuffer);
  const nChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (bitsPerSample !== 16) {
    // Unknown sample format — fall back to untrimmed duration.
    return getWavDuration(wavBuffer);
  }

  const dataStart = dataPos + 8;
  const bytesPerFrame = nChannels * 2;
  const totalFrames = Math.floor((bytes.length - dataStart) / bytesPerFrame);
  if (totalFrames === 0) return 0;

  const windowFrames = Math.max(1, Math.round(sampleRate * 0.02)); // 20ms
  const thresholdLinear = Math.pow(10, thresholdDb / 20);
  const windowCount = Math.ceil(totalFrames / windowFrames);

  const windowIsAudible = (w: number): boolean => {
    const startFrame = w * windowFrames;
    const endFrame = Math.min(totalFrames, startFrame + windowFrames);
    let sumSq = 0;
    for (let f = startFrame; f < endFrame; f++) {
      // First channel only — sufficient for silence detection.
      const sample = view.getInt16(dataStart + f * bytesPerFrame, true) / 32768;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / (endFrame - startFrame));
    return rms > thresholdLinear;
  };

  let firstAudible = -1;
  for (let w = 0; w < windowCount; w++) {
    if (windowIsAudible(w)) {
      firstAudible = w;
      break;
    }
  }
  if (firstAudible === -1) return 0;

  let lastAudible = firstAudible;
  for (let w = windowCount - 1; w >= firstAudible; w--) {
    if (windowIsAudible(w)) {
      lastAudible = w;
      break;
    }
  }

  const windowSec = windowFrames / sampleRate;
  const totalSec = totalFrames / sampleRate;
  const leadSilence = firstAudible * windowSec;
  const tailSilence = totalSec - Math.min(totalSec, (lastAudible + 1) * windowSec);
  const audible = Math.min(totalSec, (lastAudible + 1) * windowSec) - leadSilence;
  return audible + Math.min(leadSilence, keepSec) + Math.min(tailSilence, keepSec);
}

/**
 * Get audio duration using Web Audio API (browser only).
 * Use this for non-WAV formats or when higher accuracy is needed.
 */
export async function getAudioDuration(
  buffer: ArrayBuffer
): Promise<number> {
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(
      buffer.slice(0)
    );
    return audioBuffer.duration;
  } finally {
    await audioContext.close();
  }
}

/** Maximum prompt audio duration in seconds. */
export const MAX_PROMPT_DURATION = 10;

export interface PromptDurationValidation {
  valid: boolean;
  duration: number;
}

/**
 * Validate that a prompt audio file does not exceed the maximum duration.
 *
 * @param file - Audio file (File or Blob)
 * @param maxSeconds - Maximum duration in seconds (default: 10)
 * @returns Validation result with measured duration
 */
export async function validatePromptDuration(
  file: File | Blob,
  maxSeconds: number = MAX_PROMPT_DURATION,
): Promise<PromptDurationValidation> {
  const buffer = await file.arrayBuffer();
  const duration = await getAudioDuration(buffer);
  return { valid: duration <= maxSeconds, duration };
}
