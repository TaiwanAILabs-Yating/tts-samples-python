/**
 * Format seconds to SRT time format: HH:MM:SS,mmm
 */
export function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const ms = String(millis).padStart(3, "0");

  return `${hh}:${mm}:${ss},${ms}`;
}

export interface SrtSegment {
  text: string;
  duration: number;
}

/**
 * Generate SRT subtitle content from segments.
 *
 * @param segments - Array of { text, duration } objects
 * @returns SRT formatted string
 */
export function generateSrt(segments: SrtSegment[]): string {
  let currentTime = 0.0;
  const lines: string[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const { text, duration } = segments[idx];
    const start = formatSrtTime(currentTime);
    const end = formatSrtTime(currentTime + duration);
    lines.push(`${idx + 1}\n${start} --> ${end}\n${text}\n`);
    currentTime += duration;
  }

  return lines.join("\n");
}
