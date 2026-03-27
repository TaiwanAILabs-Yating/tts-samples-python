import { useState, useRef, useEffect } from "react";
import { useProjectStore } from "../../stores/project-store.ts";
import { useLexicon } from "../../hooks/useLexicon.ts";
import { WordSegmentation } from "./WordSegmentation.tsx";

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
        className="text-[13px] text-text-primary truncate cursor-text hover:underline hover:decoration-dotted hover:decoration-text-muted"
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

export function SegmentCards({ onRegenerateSegment, onSegmentClick, activeSegmentIndex, regeneratingSegmentKey }: SegmentCardsProps) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const updateSegmentText = useProjectStore((s) => s.updateSegmentText);
  const updateSegmentWordSeg = useProjectStore((s) => s.updateSegmentWordSeg);
  const { isAvailable: isWordSegAvailable } = useLexicon();

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
    <div className="flex flex-col gap-2">
      {segments.map((segment, i) => {
        const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        const durStr =
          segment.duration != null
            ? `${segment.duration.toFixed(2)}s`
            : "--";
        const isRegenerating = segment.status === "generating";
        const isAnyRegenerating = regeneratingSegmentKey !== null;
        const isActive = activeSegmentIndex === i;

        return (
          <div
            key={i}
            className={`flex flex-col rounded-lg bg-bg-secondary px-4 py-3 border transition-colors hover:bg-bg-tertiary/30 cursor-pointer ${
              isActive ? "ring-1 ring-accent-primary" : ""
            }`}
            style={{ borderColor: isActive ? color : `${color}40` }}
            onClick={() => onSegmentClick?.(i)}
          >
            <div className="flex items-center justify-between">
              {/* Left */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="w-1 h-8 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  {!isWordSegAvailable && (
                    <EditableText
                      text={segment.text}
                      onSave={(t) => updateSegmentText(selectedIndex, i, t)}
                    />
                  )}
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
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 ml-3">
                <button
                  onClick={(e) => { e.stopPropagation(); onRegenerateSegment(selectedIndex, i); }}
                  disabled={isAnyRegenerating}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-input text-[12px] font-medium transition-colors ${
                    isAnyRegenerating
                      ? "opacity-50 cursor-not-allowed text-text-muted"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}
                  title="Regenerate this segment only"
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
                  {isRegenerating ? "..." : "Regen"}
                </button>
              </div>
            </div>

            {/* Word Segmentation (Taiwanese only) */}
            <WordSegmentation
              segmentText={segment.text}
              initialWordSeg={segment.wordSegmentation}
              onWordStatesChange={(states) => updateSegmentWordSeg(selectedIndex, i, states)}
            />
          </div>
        );
      })}
    </div>
  );
}
