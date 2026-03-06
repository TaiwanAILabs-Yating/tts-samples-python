import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TopNav } from "../components/TopNav.tsx";
import { VoiceSetup } from "../components/setup/VoiceSetup.tsx";
import { TextInputCard } from "../components/setup/TextInputCard.tsx";
import { GenerationParams } from "../components/setup/GenerationParams.tsx";
import { AdvancedSettingsDrawer } from "../components/workspace/AdvancedSettingsDrawer.tsx";
import { useProjectStore, type SentenceState } from "../stores/project-store.ts";
import { splitSentences, countTokens } from "../utils/preprocessing.ts";
import type { PipelineState, SegmentState as OrcSegmentState } from "../services/tts-orchestrator.ts";

export function SetupPage() {
  const navigate = useNavigate();
  const rawText = useProjectStore((s) => s.rawText);
  const config = useProjectStore((s) => s.config);
  const isSettingsOpen = useProjectStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useProjectStore((s) => s.setSettingsOpen);

  const [showPreview, setShowPreview] = useState(false);

  const canCreate = rawText.trim().length > 0 && config.promptVoiceText.trim().length > 0;

  // Build sentences from rawText based on inputMode (same as WorkspacePage)
  const inputMode = useProjectStore((s) => s.inputMode);
  const sentenceTexts = useMemo(() => {
    const text = rawText.trim();
    if (!text) return [];
    if (inputMode === "upload") {
      return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    }
    return [text];
  }, [rawText, inputMode]);

  // Preview: split each sentence into segments using current config
  const previewSegments = useMemo(() => {
    if (!showPreview) return [];
    return sentenceTexts.map((text, i) => ({
      sentenceIndex: i,
      text,
      segments: splitSentences(text, config.segmentMode, config.minTokens, config.maxTokens),
    }));
  }, [showPreview, sentenceTexts, config.segmentMode, config.minTokens, config.maxTokens]);

  const handleCreate = () => {
    // Build new sentences directly from current rawText + config
    const newSentences: SentenceState[] = sentenceTexts.map((text, i) => {
      const segTexts = splitSentences(text, config.segmentMode, config.minTokens, config.maxTokens);
      const segments: OrcSegmentState[] = segTexts.map((segText, si) => ({
        index: si,
        text: segText,
        status: "pending" as const,
        attempts: 0,
        history: [],
      }));
      const pipeline: PipelineState = { segments };
      return { index: i, text, status: "pending" as const, pipeline };
    });

    useProjectStore.setState({
      autoGenerate: true,
      sentences: newSentences,
      selectedSentenceIndex: 0,
    });
    navigate("/workspace");
  };

  return (
    <div className="flex flex-col h-screen">
      <TopNav />
      <main className="flex-1 overflow-auto p-8">
        <div className="flex gap-8 max-w-[1200px] mx-auto">
          {/* Left: Voice Setup */}
          <VoiceSetup />

          {/* Right: Text Input & Params */}
          <section className="flex flex-col gap-6 flex-1">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold text-text-primary">
                Text Input & Parameters
              </h1>
              <p className="text-sm text-text-secondary">
                Enter text to synthesize and configure generation settings
              </p>
            </div>

            <TextInputCard />
            <GenerationParams />

            {/* Action Row */}
            <div className="flex justify-end gap-3">
              <button
                disabled={!rawText.trim()}
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-text-primary px-5 py-2.5 rounded-md border border-border-secondary hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4 text-text-secondary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Preview Segments
              </button>

              {/* Advanced Settings button */}
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-text-secondary px-4 py-2.5 rounded-md border border-border-secondary hover:bg-bg-tertiary transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" x2="4" y1="21" y2="14" />
                  <line x1="4" x2="4" y1="10" y2="3" />
                  <line x1="12" x2="12" y1="21" y2="12" />
                  <line x1="12" x2="12" y1="8" y2="3" />
                  <line x1="20" x2="20" y1="21" y2="16" />
                  <line x1="20" x2="20" y1="12" y2="3" />
                  <line x1="2" x2="6" y1="14" y2="14" />
                  <line x1="10" x2="14" y1="8" y2="8" />
                  <line x1="18" x2="22" y1="16" y2="16" />
                </svg>
                Advanced
              </button>

              {/* Create & Generate button */}
              <button
                disabled={!canCreate}
                onClick={handleCreate}
                className="flex items-center gap-2 text-sm font-semibold text-white bg-accent-primary hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-md transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                </svg>
                Create & Generate
              </button>
            </div>
          </section>
        </div>
      </main>

      {isSettingsOpen && <AdvancedSettingsDrawer />}

      {/* Preview Segments Modal */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-bg-secondary border border-border-secondary rounded-lg w-full max-w-[680px] max-h-[80vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-secondary">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Segment Preview</h2>
                <p className="text-xs text-text-muted mt-0.5">
                  Mode: {config.segmentMode} · Tokens: {config.minTokens}–{config.maxTokens}
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-5">
              {previewSegments.map((sent) => (
                <div key={sent.sentenceIndex} className="flex flex-col gap-2">
                  <div className="text-xs font-medium text-text-muted">
                    Sentence #{String(sent.sentenceIndex + 1).padStart(3, "0")}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {sent.segments.map((seg, si) => (
                      <div
                        key={si}
                        className="flex items-start gap-3 px-3 py-2 rounded-md bg-bg-tertiary/50"
                      >
                        <span className="shrink-0 text-[11px] font-mono text-accent-primary mt-0.5">
                          S{si + 1}
                        </span>
                        <span className="text-sm text-text-primary flex-1">{seg}</span>
                        <span className="shrink-0 text-[11px] font-mono text-text-muted mt-0.5">
                          {countTokens(seg)}t
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {sent.segments.length} segment{sent.segments.length !== 1 ? "s" : ""} · Total {countTokens(sent.text)} tokens
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex justify-end px-6 py-3 border-t border-border-secondary">
              <button
                onClick={() => setShowPreview(false)}
                className="text-sm font-medium text-text-primary px-4 py-2 rounded-md border border-border-secondary hover:bg-bg-tertiary transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
