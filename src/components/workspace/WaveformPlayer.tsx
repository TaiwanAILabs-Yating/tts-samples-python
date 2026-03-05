import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useProjectStore } from "../../stores/project-store.ts";
import { useAudioPlayer, type SegmentRange } from "../../hooks/useAudioPlayer.ts";

export interface WaveformPlayerHandle {
  togglePlayPause: () => void;
  seekToPrevSegment: () => void;
  seekToNextSegment: () => void;
  seekToSegmentIndex: (index: number) => void;
}

const SEGMENT_COLORS = [
  "#7C3AED", // purple
  "#2563EB", // blue
  "#059669", // green
  "#D97706", // amber
  "#DC2626", // red
  "#0891B2", // cyan
];

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const CANVAS_HEIGHT = 120;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = s.toFixed(2).padStart(5, "0");
  return `${mm}:${ss}`;
}

/** Compute RMS amplitudes from an AudioBuffer for bar rendering */
function computeAmplitudes(
  audioBuffer: AudioBuffer,
  barCount: number
): number[] {
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBar = Math.floor(channelData.length / barCount);
  const amplitudes: number[] = [];

  for (let i = 0; i < barCount; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, channelData.length);
    let sumSq = 0;
    for (let j = start; j < end; j++) {
      sumSq += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sumSq / (end - start));
    amplitudes.push(rms);
  }

  // Normalize
  const maxAmp = Math.max(...amplitudes, 0.001);
  return amplitudes.map((a) => a / maxAmp);
}

interface WaveformPlayerProps {
  onCurrentSegmentChange?: (index: number) => void;
}

export const WaveformPlayer = forwardRef<WaveformPlayerHandle, WaveformPlayerProps>(
  function WaveformPlayer({ onCurrentSegmentChange }, ref) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const sentence = sentences[selectedIndex];
  const pipeline = sentence?.pipeline;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = 100%

  const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
  const zoomPercent = `${Math.round(zoomLevel * 100)}%`;
  const canvasWidth = Math.round(containerWidth * zoomLevel);

  const player = useAudioPlayer();

  // Compute segment ranges from pipeline data
  const segmentRanges: SegmentRange[] = useMemo(() => {
    if (!pipeline?.segments) return [];
    const ranges: SegmentRange[] = [];
    let offset = 0;
    for (const seg of pipeline.segments) {
      const dur = seg.duration ?? 0;
      ranges.push({
        startTime: offset,
        endTime: offset + dur,
        text: seg.text,
      });
      offset += dur;
    }
    return ranges;
  }, [pipeline?.segments]);

  // Report current segment index to parent
  const prevSegIdxRef = useRef(-1);
  useEffect(() => {
    if (!onCurrentSegmentChange || segmentRanges.length === 0 || player.duration === 0) return;
    let idx = -1;
    for (let i = 0; i < segmentRanges.length; i++) {
      if (player.currentTime >= segmentRanges[i].startTime && player.currentTime < segmentRanges[i].endTime) {
        idx = i;
        break;
      }
    }
    // Handle edge case: at the very end, highlight last segment
    if (idx === -1 && player.currentTime >= player.duration - 0.05 && segmentRanges.length > 0) {
      idx = segmentRanges.length - 1;
    }
    if (idx !== prevSegIdxRef.current) {
      prevSegIdxRef.current = idx;
      onCurrentSegmentChange(idx);
    }
  }, [player.currentTime, segmentRanges, player.duration, onCurrentSegmentChange]);

  // Expose controls for keyboard shortcuts
  useImperativeHandle(ref, () => ({
    togglePlayPause: player.togglePlayPause,
    seekToPrevSegment: () => player.seekToSegment(segmentRanges, "prev"),
    seekToNextSegment: () => player.seekToSegment(segmentRanges, "next"),
    seekToSegmentIndex: (index: number) => {
      if (index >= 0 && index < segmentRanges.length) {
        player.seek(segmentRanges[index].startTime);
      }
    },
  }), [player.togglePlayPause, player.seekToSegment, player.seek, segmentRanges]);

  // Load audio when concatenated audio changes
  useEffect(() => {
    if (pipeline?.concatenatedAudio) {
      player.loadAudio(pipeline.concatenatedAudio);
    }
  }, [pipeline?.concatenatedAudio]);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute amplitudes for bars
  const amplitudes = useMemo(() => {
    if (!player.audioBuffer) return [];
    const barCount = Math.floor(canvasWidth / (BAR_WIDTH + BAR_GAP));
    if (barCount <= 0) return [];
    return computeAmplitudes(player.audioBuffer, barCount);
  }, [player.audioBuffer, canvasWidth]);

  // Get color for a bar based on which segment it belongs to
  const getBarColor = useCallback(
    (barIndex: number, totalBars: number): string => {
      if (segmentRanges.length === 0 || player.duration === 0)
        return "#4B5563";
      const barTime = (barIndex / totalBars) * player.duration;
      for (let i = 0; i < segmentRanges.length; i++) {
        if (barTime >= segmentRanges[i].startTime && barTime < segmentRanges[i].endTime) {
          return SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        }
      }
      return "#4B5563";
    },
    [segmentRanges, player.duration]
  );

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || amplitudes.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasWidth, CANVAS_HEIGHT);

    const totalBars = amplitudes.length;
    const centerY = CANVAS_HEIGHT / 2;
    const maxBarHeight = CANVAS_HEIGHT * 0.85;

    // Draw segment background regions
    if (player.duration > 0) {
      for (let i = 0; i < segmentRanges.length; i++) {
        const seg = segmentRanges[i];
        const x1 = (seg.startTime / player.duration) * canvasWidth;
        const x2 = (seg.endTime / player.duration) * canvasWidth;
        const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        ctx.fillStyle = color + "1F"; // 12% opacity
        ctx.fillRect(x1, 0, x2 - x1, CANVAS_HEIGHT);

        // Segment divider line (except first)
        if (i > 0) {
          ctx.strokeStyle = "#6B728080";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, 0);
          ctx.lineTo(x1, CANVAS_HEIGHT);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Segment label
        ctx.fillStyle = color;
        ctx.font = "500 10px 'JetBrains Mono', monospace";
        const labelX = (x1 + x2) / 2;
        ctx.textAlign = "center";
        ctx.fillText(`Seg ${i + 1}`, labelX, 12);
      }
    }

    // Draw bars
    for (let i = 0; i < totalBars; i++) {
      const x = i * (BAR_WIDTH + BAR_GAP);
      const amp = amplitudes[i];
      const barHeight = Math.max(2, amp * maxBarHeight);
      const barTime = (i / totalBars) * player.duration;

      // Played bars use segment color, unplayed bars are grey
      const isPlayed = barTime <= player.currentTime;
      const color = isPlayed
        ? getBarColor(i, totalBars)
        : "#4B5563";

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(
        x,
        centerY - barHeight / 2,
        BAR_WIDTH,
        barHeight,
        1
      );
      ctx.fill();
    }

    // Draw playhead
    if (player.duration > 0) {
      const playheadX =
        (player.currentTime / player.duration) * canvasWidth;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(playheadX - 1, 0, 2, CANVAS_HEIGHT);
    }

    // Draw time labels at segment boundaries
    if (player.duration > 0) {
      ctx.fillStyle = "#6B7280";
      ctx.font = "normal 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText("00:00", 4, CANVAS_HEIGHT - 4);
      ctx.textAlign = "right";
      ctx.fillText(formatTime(player.duration), canvasWidth - 4, CANVAS_HEIGHT - 4);

      // Segment boundary times
      ctx.textAlign = "center";
      for (let i = 1; i < segmentRanges.length; i++) {
        const seg = segmentRanges[i];
        const x = (seg.startTime / player.duration) * canvasWidth;
        ctx.fillText(formatTime(seg.startTime), x, CANVAS_HEIGHT - 4);
      }
    }
  }, [amplitudes, canvasWidth, player.currentTime, player.duration, segmentRanges, getBarColor]);

  // Zoom in / out
  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => {
      const idx = ZOOM_STEPS.indexOf(prev);
      return idx < ZOOM_STEPS.length - 1 ? ZOOM_STEPS[idx + 1] : prev;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => {
      const idx = ZOOM_STEPS.indexOf(prev);
      return idx > 0 ? ZOOM_STEPS[idx - 1] : prev;
    });
  }, []);

  // Keep playhead in view when zoomed
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || player.duration === 0 || zoomLevel <= 1) return;
    const playheadX = (player.currentTime / player.duration) * canvasWidth;
    const viewLeft = scrollEl.scrollLeft;
    const viewRight = viewLeft + scrollEl.clientWidth;
    if (playheadX < viewLeft + 40 || playheadX > viewRight - 40) {
      scrollEl.scrollLeft = playheadX - scrollEl.clientWidth / 2;
    }
  }, [player.currentTime, player.duration, canvasWidth, zoomLevel]);

  // Handle click on waveform to seek
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || player.duration === 0) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      player.seek(ratio * player.duration);
    },
    [player]
  );

  // No audio state
  const hasAudio = !!pipeline?.concatenatedAudio;

  return (
    <div className="rounded-lg bg-bg-secondary border border-border-secondary flex flex-col">
      {/* Waveform area */}
      <div
        ref={containerRef}
        className="relative"
        style={{ height: CANVAS_HEIGHT }}
      >
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden cursor-crosshair"
          style={{ height: CANVAS_HEIGHT }}
        >
          {hasAudio ? (
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              style={{ width: canvasWidth, height: CANVAS_HEIGHT, display: "block" }}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="text-sm text-text-muted">
                {sentence?.status === "generating"
                  ? "Generating audio..."
                  : "No audio — generate to see waveform"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-border-secondary">
        {/* Left controls */}
        <div className="flex items-center gap-2">
          {/* Skip to start */}
          <button
            onClick={() => player.seek(0)}
            disabled={!hasAudio}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" x2="5" y1="19" y2="5" />
            </svg>
          </button>
          {/* Previous segment */}
          <button
            onClick={() => player.seekToSegment(segmentRanges, "prev")}
            disabled={!hasAudio}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          {/* Play / Pause */}
          <button
            onClick={player.togglePlayPause}
            disabled={!hasAudio}
            className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            {player.isPlaying ? (
              <svg className="w-4 h-4 text-bg-primary" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-bg-primary ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          {/* Next segment */}
          <button
            onClick={() => player.seekToSegment(segmentRanges, "next")}
            disabled={!hasAudio}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          {/* Skip to end */}
          <button
            onClick={() => player.seek(player.duration)}
            disabled={!hasAudio}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" x2="19" y1="5" y2="19" />
            </svg>
          </button>

          {/* Time display */}
          {hasAudio && (
            <span className="text-xs font-mono text-text-muted ml-2">
              {formatTime(player.currentTime)} / {formatTime(player.duration)}
            </span>
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-4">
          {/* Playback speed */}
          <div className="relative">
            <button
              onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
              className="flex items-center gap-1 text-xs font-mono font-medium text-text-primary px-2 py-1 rounded border border-border-input hover:bg-bg-tertiary transition-colors"
            >
              {player.playbackRate}x
              <svg className="w-3 h-3 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {speedMenuOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-bg-nav border border-border rounded-md shadow-lg py-1 z-10">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => {
                      player.changePlaybackRate(rate);
                      setSpeedMenuOpen(false);
                    }}
                    className={`block w-full text-left px-3 py-1 text-xs font-mono hover:bg-bg-tertiary transition-colors ${
                      player.playbackRate === rate
                        ? "text-accent-primary"
                        : "text-text-primary"
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= ZOOM_STEPS[0]}
              className="w-7 h-7 rounded border border-border-input flex items-center justify-center text-text-secondary hover:bg-bg-tertiary transition-colors disabled:opacity-30"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" x2="16.65" y1="21" y2="16.65" />
                <line x1="8" x2="14" y1="11" y2="11" />
              </svg>
            </button>
            <span className="text-[11px] font-mono font-medium text-text-secondary min-w-[36px] text-center">
              {zoomPercent}
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              className="w-7 h-7 rounded border border-border-input flex items-center justify-center text-text-secondary hover:bg-bg-tertiary transition-colors disabled:opacity-30"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" x2="16.65" y1="21" y2="16.65" />
                <line x1="11" x2="11" y1="8" y2="14" />
                <line x1="8" x2="14" y1="11" y2="11" />
              </svg>
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={player.volume}
              onChange={(e) =>
                player.changeVolume(parseFloat(e.target.value))
              }
              className="w-20 accent-text-secondary"
            />
          </div>
        </div>
      </div>
    </div>
  );
});
