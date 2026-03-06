import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore, type SentenceStatus } from "../../stores/project-store.ts";
import type { GenerationProgress } from "../../hooks/useGeneration.ts";

type DownloadMode = "audio_metadata" | "audio_only";

const STATUS_CONFIG: Record<
  SentenceStatus,
  { color: string; label: string }
> = {
  pending: { color: "#6B7280", label: "pending" },
  generating: { color: "#3B82F6", label: "generating" },
  generated: { color: "#F59E0B", label: "generated" },
  approved: { color: "#10B981", label: "approved" },
  rejected: { color: "#EF4444", label: "rejected" },
  error: { color: "#EF4444", label: "error" },
};

interface SentenceSidebarProps {
  isGenerating: boolean;
  progress: GenerationProgress | null;
  onGenerateAll: () => void;
  onApproveAll: () => void;
}

export function SentenceSidebar({
  isGenerating,
  progress,
  onGenerateAll,
  onApproveAll,
}: SentenceSidebarProps) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const setSelected = useProjectStore((s) => s.setSelectedSentenceIndex);

  const projectName = useProjectStore((s) => s.projectName);
  const config = useProjectStore((s) => s.config);

  const approvedCount = sentences.filter((s) => s.status === "approved").length;
  const pendingCount = sentences.filter(
    (s) => s.status === "pending" || s.status === "generated",
  ).length;
  const errorCount = sentences.filter((s) => s.status === "error").length;

  const [downloadMode, setDownloadMode] = useState<DownloadMode>("audio_metadata");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const buildZip = useCallback((files: { name: string; data: Uint8Array }[]) => {
    // CRC32 lookup table
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
    function crc32(data: Uint8Array): number {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < data.length; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const encoder = new TextEncoder();
    const centralEntries: Uint8Array[] = [];
    const localParts: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const crc = crc32(file.data);

      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lv = new DataView(localHeader);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, file.data.length, true);
      lv.setUint32(22, file.data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      new Uint8Array(localHeader).set(nameBytes, 30);

      const localHeaderBytes = new Uint8Array(localHeader);
      localParts.push(localHeaderBytes, file.data);

      const centralHeader = new ArrayBuffer(46 + nameBytes.length);
      const cv = new DataView(centralHeader);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, file.data.length, true);
      cv.setUint32(24, file.data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      new Uint8Array(centralHeader).set(nameBytes, 46);
      centralEntries.push(new Uint8Array(centralHeader));

      offset += localHeaderBytes.length + file.data.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const entry of centralEntries) centralDirSize += entry.length;

    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirOffset, true);
    ev.setUint16(20, 0, true);

    const allParts = [...localParts, ...centralEntries, new Uint8Array(eocd)];
    const totalLen = allParts.reduce((sum, p) => sum + p.length, 0);
    const zipBuffer = new Uint8Array(totalLen);
    let pos = 0;
    for (const part of allParts) {
      zipBuffer.set(part, pos);
      pos += part.length;
    }
    return zipBuffer;
  }, []);

  const handleDownloadZip = useCallback(() => {
    const approved = sentences.filter(
      (s) => s.status === "approved" && s.pipeline?.concatenatedAudio,
    );
    if (approved.length === 0) return;

    const files: { name: string; data: Uint8Array }[] = approved.map((s) => ({
      name: `${projectName}_sentence_${String(s.index + 1).padStart(3, "0")}.wav`,
      data: new Uint8Array(s.pipeline!.concatenatedAudio!),
    }));

    // Include metadata.json when mode is audio_metadata
    if (downloadMode === "audio_metadata") {
      const metadata = {
        project: projectName,
        exportedAt: new Date().toISOString(),
        config: {
          language: config.language,
          promptLanguage: config.promptLanguage,
          promptVoiceText: config.promptVoiceText,
          promptVoiceFileName: config.promptVoiceFileName || null,
          modelId: config.modelId,
          segmentMode: config.segmentMode,
          minTokens: config.minTokens,
          maxTokens: config.maxTokens,
          advanced: {
            addEndSilence: config.addEndSilence,
            concurrency: config.concurrency,
            maxRetries: config.maxRetries,
            retryBaseDelay: config.retryBaseDelay,
            crossfadeDuration: config.crossfadeDuration,
            fadeCurve: config.fadeCurve,
            startSilence: config.startSilence,
            endSilence: config.endSilence,
            outputSrt: config.outputSrt,
          },
        },
        sentences: sentences.map((s) => ({
          index: s.index,
          text: s.text,
          status: s.status,
          notes: s.notes || null,
          segmentCount: s.pipeline?.segments.length ?? 0,
          duration: s.pipeline?.segments
            .filter((seg) => seg.duration != null)
            .reduce((sum, seg) => sum + seg.duration!, 0) ?? null,
          audioFile: s.status === "approved" && s.pipeline?.concatenatedAudio
            ? `${projectName}_sentence_${String(s.index + 1).padStart(3, "0")}.wav`
            : null,
        })),
      };
      const encoder = new TextEncoder();
      files.push({
        name: "metadata.json",
        data: encoder.encode(JSON.stringify(metadata, null, 2)),
      });
    }

    const zipBuffer = buildZip(files);
    const blob = new Blob([zipBuffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}_approved.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sentences, projectName, downloadMode, config, buildZip]);

  return (
    <aside className="w-[340px] shrink-0 bg-bg-nav border-r border-border flex flex-col">
      {/* Header */}
      <div className="flex flex-col gap-3 p-4 pb-3 border-b border-border">
        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onGenerateAll}
            disabled={isGenerating}
            className={`flex-1 flex items-center justify-center gap-1.5 text-[13px] font-medium text-white rounded-md py-1.5 transition-colors ${
              isGenerating
                ? "bg-accent-primary/60 cursor-not-allowed"
                : "bg-accent-primary hover:bg-accent-hover"
            }`}
          >
            {isGenerating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                {progress
                  ? `${progress.completed}/${progress.total}`
                  : "Generating..."}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Generate All
              </>
            )}
          </button>
          <button
            onClick={onApproveAll}
            disabled={isGenerating}
            className="flex-1 flex items-center justify-center text-[13px] font-medium text-text-secondary rounded-md py-1.5 border border-border-secondary hover:bg-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve All
          </button>
        </div>
        {/* Filter row */}
        <div className="flex items-center justify-between">
          <button className="flex items-center gap-1.5 text-xs font-medium text-text-secondary px-2 py-1 rounded hover:bg-bg-tertiary transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            All
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <span className="text-[11px] text-text-muted">
            {approvedCount}/{sentences.length} approved · {pendingCount} pending · {errorCount} error
          </span>
        </div>
      </div>

      {/* Sentence List */}
      <div className="flex-1 overflow-y-auto">
        {sentences.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-text-muted">No sentences yet</span>
          </div>
        ) : (
          sentences.map((sentence, i) => {
            const isSelected = i === selectedIndex;
            const cfg = STATUS_CONFIG[sentence.status];
            const segCount = sentence.pipeline?.segments.length ?? 0;
            const duration = sentence.pipeline?.segments
              .filter((s) => s.duration != null)
              .reduce((sum, s) => sum + s.duration!, 0);
            const durStr =
              duration != null && duration > 0
                ? `${duration.toFixed(2)}s`
                : "--";

            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className={`w-full text-left px-4 py-3 flex flex-col gap-1.5 transition-colors ${
                  isSelected
                    ? "bg-bg-secondary border-l-[3px] border-l-accent-primary"
                    : "border-l-[3px] border-l-transparent hover:bg-bg-secondary/50"
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-semibold font-mono text-accent-primary">
                    #{String(i + 1).padStart(3, "0")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {sentence.status === "generating" ? (
                      <span
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: cfg.color }}
                      />
                    ) : (
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: cfg.color }}
                      />
                    )}
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                </div>
                {/* Text */}
                <span className="text-[13px] text-gray-300 line-clamp-2 leading-relaxed">
                  {sentence.text}
                </span>
                {/* Meta */}
                <span className="text-[11px] font-mono text-text-muted">
                  Segments: {segCount} | Duration: {durStr}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="relative" ref={dropdownRef}>
          {/* Dropdown menu (above the button) */}
          {dropdownOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-bg-secondary border border-border rounded-md p-1 flex flex-col gap-0.5 z-20">
              <button
                onClick={() => { setDownloadMode("audio_metadata"); setDropdownOpen(false); }}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded text-[13px] transition-colors ${
                  downloadMode === "audio_metadata" ? "bg-bg-tertiary text-text-primary" : "text-text-secondary hover:bg-bg-tertiary"
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                  <path d="m3.3 7 8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </svg>
                <span className="flex-1 text-left font-medium">Audio + Metadata</span>
                {downloadMode === "audio_metadata" && (
                  <svg className="w-3.5 h-3.5 text-status-approved shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => { setDownloadMode("audio_only"); setDropdownOpen(false); }}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded text-[13px] transition-colors ${
                  downloadMode === "audio_only" ? "bg-bg-tertiary text-text-primary" : "text-text-secondary hover:bg-bg-tertiary"
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span className="flex-1 text-left">Audio Only</span>
                {downloadMode === "audio_only" && (
                  <svg className="w-3.5 h-3.5 text-status-approved shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </div>
          )}
          {/* Split button */}
          <div className="flex">
            <button
              onClick={handleDownloadZip}
              disabled={approvedCount === 0}
              className="flex-1 flex items-center justify-center gap-1.5 text-[13px] font-medium text-white bg-status-approved rounded-l-md py-2 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
              Download Approved (ZIP)
            </button>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              disabled={approvedCount === 0}
              className="flex items-center justify-center px-2 text-white bg-emerald-600 rounded-r-md border-l border-emerald-700 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
