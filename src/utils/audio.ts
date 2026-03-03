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
