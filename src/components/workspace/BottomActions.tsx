import { useProjectStore } from "../../stores/project-store.ts";

interface BottomActionsProps {
  onRegenerateSentence: (sentenceIndex: number) => void;
  isSegmentRegenerating?: boolean;
  canRegenerate: boolean;
}

export function BottomActions({ onRegenerateSentence, isSegmentRegenerating, canRegenerate }: BottomActionsProps) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);

  const sentence = sentences[selectedIndex];
  if (!sentence) return null;

  const isGenerating = sentence.status === "generating";
  const isDisabled = !canRegenerate || isGenerating || !sentence.pipeline || !!isSegmentRegenerating;

  return (
    <div className="flex items-center">
      <button
        onClick={() => onRegenerateSentence(selectedIndex)}
        disabled={isDisabled}
        className={`flex items-center gap-1.5 text-[13px] font-medium text-text-primary px-4 py-2 rounded-md border border-border-secondary transition-colors ${
          isDisabled
            ? "opacity-50 cursor-not-allowed"
            : "hover:bg-bg-tertiary"
        }`}
        title={canRegenerate ? "Regenerate all segments in this sentence" : "生成中，請稍候"}
      >
        <svg
          className={`w-3.5 h-3.5 text-text-secondary ${isGenerating ? "animate-spin" : ""}`}
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
        {isGenerating ? "Regenerating..." : "Regenerate Sentence"}
      </button>
    </div>
  );
}
