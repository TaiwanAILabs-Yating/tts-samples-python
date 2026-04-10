import { useState, useRef, useEffect, useCallback } from "react";
import { useProjectStore } from "../../stores/project-store.ts";
import { useLexicon } from "../../hooks/useLexicon.ts";
import { WordSegmentation } from "./WordSegmentation.tsx";

/** Plays a single segment's audio ArrayBuffer. Returns cleanup function. */
function useSegmentPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlayingIndex(null);
  }, []);

  const play = useCallback((index: number, audio: ArrayBuffer) => {
    stop();
    const blob = new Blob([audio], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const el = new Audio(url);
    audioRef.current = el;
    setPlayingIndex(index);
    el.onended = () => stop();
    el.play();
  }, [stop]);

  const toggle = useCallback((index: number, audio: ArrayBuffer) => {
    if (playingIndex === index) {
      stop();
    } else {
      play(index, audio);
    }
  }, [playingIndex, play, stop]);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return { playingIndex, toggle };
}

const SEGMENT_COLORS = [
  "#7C3AED", // purple
  "#2563EB", // blue
  "#059669", // green
  "#D97706", // amber
  "#DC2626", // red
  "#0891B2", // cyan
];

interface SegmentCardsProps {
  onRegenerateSegment: (sentenceIndex: number, segmentIndex: number) => void;
  onSegmentClick?: (segmentIndex: number) => void;
  activeSegmentIndex?: number;
  regeneratingSegmentKey?: string | null;
  canRegenerate: boolean;
}

function EditableText({ text, onSave }: { text: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(text); }, [text]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <span
        className="text-[13px] text-text-primary cursor-text hover:underline hover:decoration-dotted hover:decoration-text-muted"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Click to edit"
      >
        {text}
      </span>
    );
  }

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== text) onSave(trimmed);
    else setValue(text);
    setEditing(false);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setValue(text); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="text-[13px] text-text-primary bg-bg-tertiary rounded px-1.5 py-0.5 border border-accent-primary outline-none w-full min-w-0"
    />
  );
}

export function SegmentCards({ onRegenerateSegment, onSegmentClick, activeSegmentIndex, regeneratingSegmentKey, canRegenerate }: SegmentCardsProps) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const updateSegmentText = useProjectStore((s) => s.updateSegmentText);
  const updateSegmentWordSeg = useProjectStore((s) => s.updateSegmentWordSeg);
  const { isAvailable: isWordSegAvailable } = useLexicon();
  const { playingIndex, toggle: togglePlay } = useSegmentPlayer();
  const [tailoEnabledMap, setTailoEnabledMap] = useState<Record<number, boolean>>({});

  const sentence = sentences[selectedIndex];
  const segments = sentence?.pipeline?.segments ?? [];

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm text-text-muted">
          No segments — generate to see results
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 isolate">
      {segments.map((segment, i) => {
        const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        const durStr =
          segment.duration != null
            ? `${segment.duration.toFixed(2)}s`
            : "--";
        const isRegenerating = segment.status === "generating";
        const isRegenDisabled = !canRegenerate || regeneratingSegmentKey !== null;
        const isActive = activeSegmentIndex === i;
        const tailoEnabled = tailoEnabledMap[i] ?? false;

        // Compute display text: when Tailo ON and wordSeg available, replace useTailo words
        const displayText = tailoEnabled && segment.wordSegmentation?.length
          ? segment.wordSegmentation.map(ws => ws.useTailo ? ws.tailo : ws.word).join("")
          : segment.text;

        return (
          <div
            key={i}
            className={`flex flex-col gap-2 rounded-lg bg-bg-secondary px-4 py-3 border transition-colors hover:bg-bg-tertiary/30 cursor-pointer ${
              isActive ? "ring-1 ring-accent-primary" : ""
            }`}
            style={{ borderColor: isActive ? color : `${color}40` }}
            onClick={() => onSegmentClick?.(i)}
          >
            {/* Header Row: Left info + Right actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="w-1 h-8 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[11px] font-mono text-text-muted">
                  Seg {i + 1} · {durStr}
                  {segment.status === "generating" && (
                    <span className="text-blue-400 ml-2">generating...</span>
                  )}
                  {segment.status === "error" && (
                    <span className="text-status-error ml-2">
                      Error: {segment.error}
                    </span>
                  )}
                </span>
              </div>

              {/* Actions: Tailo · Play · Regen · Download */}
              <div className="flex items-center gap-2">
                {/* Tailo toggle (only when lexicon available) */}
                {isWordSegAvailable && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setTailoEnabledMap(prev => ({ ...prev, [i]: !prev[i] }));
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      tailoEnabled
                        ? "bg-accent-primary/10 border-accent-primary/40 text-accent-primary"
                        : "border-border-input text-text-muted hover:text-text-secondary hover:border-text-muted"
                    }`}
                    title={tailoEnabled ? "Hide word segmentation" : "Show word segmentation with Tailo"}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 10H3" />
                      <path d="M21 6H3" />
                      <path d="M21 14H3" />
                      <path d="M17 18H3" />
                    </svg>
                    Tailo
                  </button>
                )}
                {/* Play */}
                <button
                  onClick={(e) => { e.stopPropagation(); if (segment.audio) togglePlay(i, segment.audio); }}
                  disabled={!segment.audio}
                  className={`flex items-center justify-center w-8 h-8 rounded-md border border-border-input transition-colors ${
                    !segment.audio
                      ? "opacity-30 cursor-not-allowed text-text-muted"
                      : playingIndex === i
                        ? "text-accent-primary bg-accent-primary/10 border-accent-primary"
                        : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}
                  title={segment.audio ? "Play this segment" : "No audio available"}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    {playingIndex === i ? (
                      <>
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </>
                    ) : (
                      <path d="M5 3l14 9-14 9V3z" />
                    )}
                  </svg>
                </button>
                {/* Regenerate */}
                <button
                  onClick={(e) => { e.stopPropagation(); onRegenerateSegment(selectedIndex, i); }}
                  disabled={isRegenDisabled}
                  className={`flex items-center justify-center w-8 h-8 rounded-md border border-border-input transition-colors ${
                    isRegenDisabled
                      ? "opacity-50 cursor-not-allowed text-text-muted"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}
                  title={canRegenerate ? "Regenerate this segment only" : "生成中，請稍候"}
                >
                  <svg
                    className={`w-3.5 h-3.5 ${isRegenerating ? "animate-spin" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </button>
                {/* Download */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!segment.audio) return;
                    const blob = new Blob([segment.audio], { type: "audio/wav" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `segment_${selectedIndex + 1}_${i + 1}.wav`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  disabled={!segment.audio}
                  className={`flex items-center justify-center w-8 h-8 rounded-md border border-border-input transition-colors ${
                    !segment.audio
                      ? "opacity-30 cursor-not-allowed text-text-muted"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}
                  title={segment.audio ? "Download this segment" : "No audio available"}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Editable Sentence — always visible */}
            <div className="bg-bg-primary rounded-md px-3 py-2 border border-border">
              {tailoEnabled && segment.wordSegmentation?.length ? (
                <span className="text-[13px] text-text-primary">
                  {displayText}
                </span>
              ) : (
                <EditableText
                  text={segment.text}
                  onSave={(t) => updateSegmentText(selectedIndex, i, t)}
                />
              )}
            </div>

            {/* Word Chips Panel — only when Tailo ON */}
            {tailoEnabled && (
              <WordSegmentation
                segmentText={segment.text}
                initialWordSeg={segment.wordSegmentation}
                onWordStatesChange={(states) => updateSegmentWordSeg(selectedIndex, i, states)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
