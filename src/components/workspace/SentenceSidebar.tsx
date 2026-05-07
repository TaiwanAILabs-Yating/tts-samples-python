import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectStore, type SentenceStatus } from "../../stores/project-store.ts";
import type { GenerationProgress } from "../../hooks/useGeneration.ts";
import {
  concatWavsWithCrossfade,
  type ConcatProgress,
} from "../../services/ffmpeg-service.ts";

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
  const navigate = useNavigate();
  const sentences = useProjectStore((s) => s.sentences);
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const setSelected = useProjectStore((s) => s.setSelectedSentenceIndex);

  const projectName = useProjectStore((s) => s.projectName);
  const projectId = useProjectStore((s) => s.projectId);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const config = useProjectStore((s) => s.config);
  const inputMode = useProjectStore((s) => s.inputMode);

  const approvedCount = sentences.filter((s) => s.status === "approved").length;
  const pendingCount = sentences.filter(
    (s) => s.status === "pending" || s.status === "generated",
  ).length;
  const errorCount = sentences.filter((s) => s.status === "error").length;

  // Direct Input is split into multiple sentences (each ≤50 segments) so the
  // user typically wants a single concatenated final audio → default ON.
  // Upload mode usually wants per-line files → default OFF.
  const [concatAll, setConcatAll] = useState(inputMode === "direct");
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadConcatProgress, setDownloadConcatProgress] =
    useState<ConcatProgress | null>(null);
  const [downloadConcatLabel, setDownloadConcatLabel] = useState("");

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

  const handleDownloadZip = useCallback(async () => {
    const approved = sentences.filter((s) => s.status === "approved");
    if (approved.length === 0) return;

    setIsDownloading(true);
    setDownloadConcatProgress(null);
    setDownloadConcatLabel("");

    const files: { name: string; data: Uint8Array }[] = [];
    const sentenceAudioForFinalConcat: ArrayBuffer[] = [];
    const sentenceAudioName = (index: number) =>
      `${projectName}_sentence_${String(index + 1).padStart(3, "0")}.wav`;

    try {
      for (const s of approved) {
        const pipeline = s.pipeline;
        if (!pipeline) continue;

        let sentenceAudio: ArrayBuffer | undefined;

        if (pipeline.concatenatedAudio) {
          sentenceAudio = pipeline.concatenatedAudio;
        } else {
          const segmentAudios = pipeline.segments
            .filter((seg) => seg.status === "success" && seg.audio)
            .map((seg) => seg.audio!);

          if (segmentAudios.length === 0) continue;
          if (segmentAudios.length === 1) {
            sentenceAudio = segmentAudios[0];
          } else {
            setDownloadConcatLabel(
              `合併句子 ${String(s.index + 1).padStart(3, "0")}`,
            );
            sentenceAudio = await concatWavsWithCrossfade(
              segmentAudios,
              config.crossfadeDuration ?? 0.05,
              config.fadeCurve ?? "tri",
              setDownloadConcatProgress,
            );
          }
        }

        files.push({
          name: sentenceAudioName(s.index),
          data: new Uint8Array(sentenceAudio),
        });
        sentenceAudioForFinalConcat.push(sentenceAudio);
      }

      // Concat all approved sentences into one WAV only when explicitly checked.
      if (concatAll && sentenceAudioForFinalConcat.length > 0) {
        setDownloadConcatLabel("合併所有句子");
        const concatenated = await concatWavsWithCrossfade(
          sentenceAudioForFinalConcat,
          config.crossfadeDuration ?? 0.05,
          config.fadeCurve ?? "tri",
          setDownloadConcatProgress,
        );
        files.push({
          name: `${projectName}_all_sentences.wav`,
          data: new Uint8Array(concatenated),
        });
      }

      // Always include metadata.json
      const metadata = {
        project: projectName,
        exportedAt: new Date().toISOString(),
        concatAll,
        concatAllAudioFile: concatAll ? `${projectName}_all_sentences.wav` : null,
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
          audioFile:
            s.status === "approved" ? sentenceAudioName(s.index) : null,
          segments: (() => {
            const segs = s.pipeline?.segments ?? [];
            let offset = 0;
            return segs.map((seg, si) => {
              const start = offset;
              const dur = seg.duration ?? 0;
              offset += dur;
              const ttsText = seg.wordSegmentation?.length
                ? seg.wordSegmentation.map((ws) => (ws.useTailo ? ws.tailo : ws.word)).join("")
                : seg.text;
              return {
                index: si,
                text: seg.text,
                ttsText: ttsText !== seg.text ? ttsText : undefined,
                start,
                end: offset,
                wordSegmentation: seg.wordSegmentation?.map((ws) => ({
                  word: ws.word,
                  tailo: ws.tailo,
                  useTailo: ws.useTailo,
                  inVocab: ws.inVocab,
                })),
              };
            });
          })(),
        })),
      };
      const encoder = new TextEncoder();
      files.push({
        name: "metadata.json",
        data: encoder.encode(JSON.stringify(metadata, null, 2)),
      });

      const zipBuffer = buildZip(files);
      const blob = new Blob([zipBuffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}_approved.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setShowCleanupDialog(true);
    } catch (e) {
      console.error("Failed to build approved ZIP:", e);
    } finally {
      setIsDownloading(false);
      setDownloadConcatProgress(null);
      setDownloadConcatLabel("");
    }
  }, [sentences, projectName, concatAll, config, buildZip]);

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
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
                Regenerate All
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
      <div className="flex flex-col gap-2 p-4 border-t border-border">
        <button
          onClick={handleDownloadZip}
          disabled={approvedCount === 0 || isDownloading}
          className="flex items-center justify-center gap-1.5 text-[13px] font-medium text-white bg-status-approved rounded-md py-2 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
          {isDownloading ? "Preparing ZIP..." : "Download Approved (ZIP)"}
        </button>
        <label className="flex items-center gap-2 px-1 cursor-pointer">
          <input
            type="checkbox"
            checked={concatAll}
            onChange={(e) => setConcatAll(e.target.checked)}
            className="w-4 h-4 rounded border-border-input bg-transparent text-accent-primary accent-accent-primary cursor-pointer"
          />
          <span className="text-[12px] text-text-secondary">
            Concat all sentences
          </span>
        </label>
      </div>
      {isDownloading && downloadConcatProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-secondary border border-border-secondary rounded-xl w-full max-w-[420px] p-6 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <svg
                className="w-5 h-5 text-accent-primary animate-spin"
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
              <h3 className="text-base font-semibold text-text-primary">
                正在合成下載音檔
              </h3>
            </div>
            <p className="text-sm text-text-secondary">
              {downloadConcatLabel}
              {downloadConcatProgress.phase === "pass1"
                ? `：第 ${downloadConcatProgress.current + 1} / ${downloadConcatProgress.total} 批`
                : downloadConcatProgress.phase === "pass2"
                  ? "：最終合併"
                  : "：完成"}
            </p>
            <div className="w-full h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all"
                style={{
                  width: `${Math.round(
                    Math.min(
                      1,
                      (downloadConcatProgress.current +
                        downloadConcatProgress.progress) /
                        downloadConcatProgress.total,
                    ) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Export Cleanup Dialog */}
      {showCleanupDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowCleanupDialog(false)}
        >
          <div
            className="bg-bg-secondary border border-border rounded-lg w-full max-w-[400px] p-6 flex flex-col items-center gap-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Icon */}
            <div className="w-12 h-12 rounded-full bg-status-approved/15 flex items-center justify-center">
              <svg className="w-6 h-6 text-status-approved" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-text-primary text-center">
              匯出完成
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed text-center">
              ZIP 檔案已下載完成。是否刪除此專案及其所有音檔快取？
            </p>
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setShowCleanupDialog(false)}
                className="flex-1 text-sm font-medium text-text-secondary h-10 rounded-lg border border-border-secondary hover:bg-bg-tertiary transition-colors"
              >
                保留專案
              </button>
              <button
                onClick={() => {
                  deleteProject(projectId);
                  setShowCleanupDialog(false);
                  navigate("/setup");
                }}
                className="flex-1 text-sm font-semibold text-white h-10 rounded-lg bg-status-error hover:opacity-90 transition-opacity"
              >
                刪除專案
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
