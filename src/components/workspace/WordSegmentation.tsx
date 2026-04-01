import { useState, useRef, useEffect, useCallback } from "react";
import { useLexicon } from "../../hooks/useLexicon";
import type { WordToken, ValidationResult } from "../../services/lexicon-service";
import type { WordSegState } from "../../services/tts-orchestrator";

interface WordSegmentationProps {
  segmentText: string;
  initialWordSeg?: WordSegState[];
  onWordStatesChange?: (states: WordSegState[]) => void;
}

export function WordSegmentation({ segmentText, initialWordSeg, onWordStatesChange }: WordSegmentationProps) {
  const { service, isLoading, isAvailable } = useLexicon();
  const [wordStates, setWordStates] = useState<WordSegState[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [popoverIndex, setPopoverIndex] = useState<number | null>(null);
  const [customTailoInput, setCustomTailoInput] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build word states from a list of words
  const buildWordStates = useCallback(
    (words: string[]): WordSegState[] => {
      if (!service) return [];
      const tokens: WordToken[] = service.toTailo(words);
      const validations: ValidationResult[] = service.validateWords(words);
      return tokens.map((t, i) => ({
        word: t.word,
        tailo: t.tailoList[0] ?? "",
        tailoList: t.tailoList,
        inVocab: validations[i]?.inVocab ?? false,
        useTailo: false,
      }));
    },
    [service],
  );

  // Auto-segment on mount or when text/service changes
  // If store has saved wordSegmentation, use it instead of re-segmenting
  useEffect(() => {
    if (!service || !segmentText) return;

    if (initialWordSeg?.length) {
      setWordStates(initialWordSeg);
      setCustomInput(initialWordSeg.map((ws) => ws.word).join(" "));
    } else {
      const words = service.segmentWords(segmentText);
      const states = buildWordStates(words);
      setWordStates(states);
      setCustomInput(words.join(" "));
      onWordStatesChange?.(states);
    }
  }, [service, segmentText, buildWordStates]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: initialWordSeg and onWordStatesChange intentionally excluded to avoid re-init loops

  // Close popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setPopoverIndex(null);
        setCustomTailoInput("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Helper: update wordStates and notify parent
  const updateStates = useCallback(
    (updater: (prev: WordSegState[]) => WordSegState[]) => {
      setWordStates((prev) => {
        const next = updater(prev);
        onWordStatesChange?.(next);
        return next;
      });
    },
    [onWordStatesChange],
  );

  // Handle custom segmentation input commit
  const commitCustomInput = useCallback(() => {
    if (!service) return;
    const words = customInput
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return;
    const states = buildWordStates(words);
    setWordStates(states);
    onWordStatesChange?.(states);
    setIsEditing(false);
  }, [customInput, service, buildWordStates, onWordStatesChange]);

  if (!isAvailable) return null;
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-[11px] text-text-muted">
          Loading lexicon...
        </span>
      </div>
    );
  }
  if (!service || wordStates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      {/* Word chips */}
      <div className="flex flex-wrap gap-1.5">
        {wordStates.map((ws, i) => {
          const isPunct =
            ws.word.length === 1 && /[\p{P}\p{S}]/u.test(ws.word);
          if (isPunct) {
            return (
              <div
                key={i}
                className="flex flex-col items-center px-1.5 py-1"
              >
                <span className="text-[10px] font-mono text-transparent select-none">
                  &nbsp;
                </span>
                <span className="text-[13px] text-text-muted">{ws.word}</span>
              </div>
            );
          }

          const bgColor = ws.inVocab
            ? "bg-emerald-900/20"
            : "bg-red-900/30";

          return (
            <div key={i} className="relative">
              <div
                className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded ${bgColor}`}
              >
                {/* Tailo (top) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopoverIndex(popoverIndex === i ? null : i);
                    setCustomTailoInput("");
                  }}
                  className={`text-[10px] font-mono leading-tight cursor-pointer hover:underline ${
                    ws.useTailo
                      ? "text-text-primary font-medium"
                      : ws.inVocab
                        ? "text-text-muted"
                        : "text-red-400"
                  }`}
                  title="Click to select pronunciation"
                >
                  {ws.tailo || "?"}
                </button>

                {/* Word (bottom) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateStates((prev) =>
                      prev.map((w, j) =>
                        j === i ? { ...w, useTailo: !w.useTailo } : w,
                      ),
                    );
                  }}
                  className={`text-[13px] leading-tight cursor-pointer ${
                    ws.useTailo
                      ? "text-text-muted"
                      : ws.inVocab
                        ? "text-text-primary font-medium"
                        : "text-red-300 font-medium"
                  }`}
                  title="Click to toggle display mode"
                >
                  {ws.word}
                </button>
              </div>

              {/* Tailo popover */}
              {popoverIndex === i && (
                <div
                  ref={popoverRef}
                  className="absolute z-20 top-full mt-1 left-0 w-44 bg-bg-secondary border border-border rounded-md shadow-lg overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-bg-primary border-b border-border">
                    <span className="text-[11px] font-semibold text-text-secondary">
                      {ws.word}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      — Select Tailo
                    </span>
                  </div>

                  {/* Options (scrollable) */}
                  <div className="max-h-[120px] overflow-y-auto">
                    {ws.tailoList.length > 0 ? (
                      ws.tailoList.map((t, ti) => (
                        <button
                          key={ti}
                          type="button"
                          onClick={() => {
                            updateStates((prev) =>
                              prev.map((w, j) =>
                                j === i ? { ...w, tailo: t, useTailo: true } : w,
                              ),
                            );
                            setPopoverIndex(null);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left text-[12px] font-mono transition-colors ${
                            ws.tailo === t
                              ? "bg-accent-primary/10 text-accent-primary"
                              : "text-text-primary hover:bg-bg-tertiary"
                          }`}
                        >
                          {t}
                          {ws.tailo === t && (
                            <svg
                              className="w-3 h-3 text-accent-primary"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-[11px] text-text-muted italic">
                        No pronunciations found (OOV)
                      </div>
                    )}
                  </div>

                  {/* Custom input */}
                  <div className="border-t border-border px-3 py-2 flex items-center gap-1.5">
                    <svg
                      className="w-3 h-3 text-text-muted shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838.838-2.872a2 2 0 0 1 .506-.855z" />
                    </svg>
                    <input
                      value={customTailoInput}
                      onChange={(e) => setCustomTailoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customTailoInput.trim()) {
                          updateStates((prev) =>
                            prev.map((w, j) =>
                              j === i
                                ? { ...w, tailo: customTailoInput.trim(), useTailo: true }
                                : w,
                            ),
                          );
                          setPopoverIndex(null);
                          setCustomTailoInput("");
                        }
                        if (e.key === "Escape") {
                          setPopoverIndex(null);
                          setCustomTailoInput("");
                        }
                      }}
                      placeholder="Custom tailo..."
                      className="flex-1 min-w-0 bg-bg-primary text-text-primary text-[11px] font-mono rounded px-2 py-1 border border-border focus:outline-none focus:border-accent-primary"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom segmentation input */}
      <div className="flex items-center gap-2">
        <svg
          className="w-3.5 h-3.5 text-text-muted shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838.838-2.872a2 2 0 0 1 .506-.855z" />
        </svg>
        {isEditing ? (
          <input
            ref={inputRef}
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onBlur={commitCustomInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCustomInput();
              if (e.key === "Escape") setIsEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-bg-primary text-text-primary text-[12px] font-mono rounded px-2.5 py-1.5 border border-accent-primary focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="flex-1 min-w-0 text-left bg-bg-primary text-text-muted text-[12px] font-mono rounded px-2.5 py-1.5 border border-border hover:border-border-input transition-colors truncate"
          >
            {customInput || "Edit segmentation..."}
          </button>
        )}
      </div>
    </div>
  );
}
