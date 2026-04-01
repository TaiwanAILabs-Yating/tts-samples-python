import { useState, useCallback } from "react";
import { useProjectStore, type SentenceStatus } from "../../stores/project-store.ts";

const STATUS_STYLE: Record<SentenceStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: "#6B72801A", text: "#6B7280", label: "Pending" },
  generating: { bg: "#3B82F61A", text: "#3B82F6", label: "Generating" },
  generated: { bg: "#F59E0B1A", text: "#F59E0B", label: "Generated" },
  approved: { bg: "#10B9811A", text: "#10B981", label: "Approved" },
  rejected: { bg: "#EF44441A", text: "#EF4444", label: "Rejected" },
  error: { bg: "#EF44441A", text: "#EF4444", label: "Error" },
};

interface WorkspaceHeaderProps {
  canApproveReject: boolean;
}

export function WorkspaceHeader({ canApproveReject }: WorkspaceHeaderProps) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const updateSentence = useProjectStore((s) => s.updateSentence);
  const projectName = useProjectStore((s) => s.projectName);
  const [expanded, setExpanded] = useState(false);

  const sentence = sentences[selectedIndex];
  if (!sentence) return null;

  const statusCfg = STATUS_STYLE[sentence.status];
  const totalDuration = sentence.pipeline?.segments
    .filter((s) => s.duration != null)
    .reduce((sum, s) => sum + s.duration!, 0);
  const durStr = totalDuration != null && totalDuration > 0 ? `${totalDuration.toFixed(2)}s` : "--";

  const isGenerating = sentence.status === "generating";
  const isApproved = sentence.status === "approved";
  const canDownload = isApproved && !!sentence.pipeline?.concatenatedAudio;

  const handleDownloadSentence = useCallback(() => {
    if (!sentence.pipeline?.concatenatedAudio) return;
    const blob = new Blob([sentence.pipeline.concatenatedAudio], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}_sentence_${String(selectedIndex + 1).padStart(3, "0")}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sentence.pipeline?.concatenatedAudio, projectName, selectedIndex]);

  // Truncate at ~80 chars
  const TRUNCATE_LEN = 80;
  const isLong = sentence.text.length > TRUNCATE_LEN;
  const displayText = expanded || !isLong
    ? sentence.text
    : sentence.text.slice(0, TRUNCATE_LEN) + "...";

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: Title + badges + actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">
          Sentence #{String(selectedIndex + 1).padStart(3, "0")}
        </h2>
        <div className="flex items-center gap-2">
          {/* Status badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium"
            style={{ backgroundColor: statusCfg.bg, color: statusCfg.text }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusCfg.text }} />
            {statusCfg.label}
          </div>

          {/* Duration badge */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-bg-tertiary text-xs font-mono font-medium text-text-secondary">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {durStr}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-border-secondary mx-1" />

          {/* Approve */}
          <button
            onClick={() => updateSentence(selectedIndex, { status: "approved" })}
            disabled={!canApproveReject}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-status-approved rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            title={canApproveReject ? "Approve this sentence" : "生成中，請稍候"}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Approve
          </button>

          {/* Reject */}
          <button
            onClick={() => updateSentence(selectedIndex, { status: "rejected" })}
            disabled={!canApproveReject}
            className="flex items-center gap-1.5 text-xs font-medium text-status-error rounded-md px-3 py-1.5 border border-status-error hover:bg-status-error/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={canApproveReject ? "Reject this sentence" : "生成中，請稍候"}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            Reject
          </button>

          {/* Download (single sentence, WAV) */}
          <button
            onClick={handleDownloadSentence}
            disabled={!canDownload}
            className="flex items-center gap-1.5 text-xs font-medium text-text-primary rounded-md px-3 py-1.5 border border-border-secondary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={canDownload ? "Download this sentence as WAV" : "Approve first to download"}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Download
          </button>
        </div>
      </div>

      {/* Row 2: Sentence text (truncated) + expand button */}
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-text-secondary leading-relaxed">
          {displayText}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs font-medium text-accent-primary hover:opacity-80 transition-opacity self-start"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
            {expanded ? "Hide full text" : "Show full text"}
          </button>
        )}
      </div>

      {/* Error message banner */}
      {sentence.status === "error" && sentence.rejectNote && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30">
          <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <p className="text-xs text-red-300 break-all">{sentence.rejectNote}</p>
        </div>
      )}
    </div>
  );
}
