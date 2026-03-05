import { useEffect, useRef, useCallback, useState } from "react";
import { TopNav } from "../components/TopNav.tsx";
import { SentenceSidebar } from "../components/workspace/SentenceSidebar.tsx";
import { WorkspaceHeader } from "../components/workspace/WorkspaceHeader.tsx";
import { WaveformPlayer, type WaveformPlayerHandle } from "../components/workspace/WaveformPlayer.tsx";
import { SegmentCards } from "../components/workspace/SegmentCards.tsx";
import { BottomActions } from "../components/workspace/BottomActions.tsx";
import { useProjectStore, type SentenceState } from "../stores/project-store.ts";
import { useGeneration } from "../hooks/useGeneration.ts";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.ts";
import { splitSentences } from "../utils/preprocessing.ts";
import type { PipelineState, SegmentState as OrcSegmentState } from "../services/tts-orchestrator.ts";

export function WorkspacePage() {
  const rawText = useProjectStore((s) => s.rawText);
  const inputMode = useProjectStore((s) => s.inputMode);
  const sentences = useProjectStore((s) => s.sentences);
  const setSentences = useProjectStore((s) => s.setSentences);
  const projectName = useProjectStore((s) => s.projectName);

  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);
  const setSelectedIndex = useProjectStore((s) => s.setSelectedSentenceIndex);
  const updateSentence = useProjectStore((s) => s.updateSentence);

  const {
    isGenerating,
    progress,
    handleGenerateAll,
    handleApproveAll,
    handleRegenerateSentence,
    handleRegenerateSegment,
  } = useGeneration();

  const waveformRef = useRef<WaveformPlayerHandle>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(-1);

  // Keyboard shortcut callbacks
  const handlePrevSentence = useCallback(() => {
    if (selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
  }, [selectedIndex, setSelectedIndex]);

  const handleNextSentence = useCallback(() => {
    if (selectedIndex < sentences.length - 1) setSelectedIndex(selectedIndex + 1);
  }, [selectedIndex, sentences.length, setSelectedIndex]);

  const handleApprove = useCallback(() => {
    const s = sentences[selectedIndex];
    if (s && s.status === "generated") {
      updateSentence(selectedIndex, { status: "approved" });
    }
  }, [sentences, selectedIndex, updateSentence]);

  const handleReject = useCallback(() => {
    const s = sentences[selectedIndex];
    if (s && (s.status === "generated" || s.status === "approved")) {
      updateSentence(selectedIndex, { status: "rejected" });
    }
  }, [sentences, selectedIndex, updateSentence]);

  useKeyboardShortcuts({
    onTogglePlayPause: () => waveformRef.current?.togglePlayPause(),
    onPrevSegment: () => waveformRef.current?.seekToPrevSegment(),
    onNextSegment: () => waveformRef.current?.seekToNextSegment(),
    onPrevSentence: handlePrevSentence,
    onNextSentence: handleNextSentence,
    onApprove: handleApprove,
    onReject: handleReject,
  });

  const autoGenerateTriggered = useRef(false);

  const config = useProjectStore((s) => s.config);

  // On mount: build sentence list from rawText based on inputMode
  // Direct Input → entire text = 1 sentence
  // Upload File → each non-empty line = 1 sentence
  // Also pre-split each sentence into text-only segments for preview
  useEffect(() => {
    if (rawText && sentences.length === 0) {
      let texts: string[];
      if (inputMode === "upload") {
        texts = rawText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      } else {
        texts = [rawText.trim()];
      }
      const newSentences: SentenceState[] = texts.map((text, i) => {
        // Pre-split text into segments so user can see them immediately
        const segTexts = splitSentences(text, config.segmentMode, config.minTokens, config.maxTokens);
        const segments: OrcSegmentState[] = segTexts.map((segText, si) => ({
          index: si,
          text: segText,
          status: "pending" as const,
          attempts: 0,
          history: [],
        }));
        const pipeline: PipelineState = { segments };
        return {
          index: i,
          text,
          status: "pending" as const,
          pipeline,
        };
      });
      setSentences(newSentences);
    }
  }, [rawText, inputMode, sentences.length, setSentences, config.segmentMode, config.minTokens, config.maxTokens]);

  // Auto-generate on first load if autoGenerate flag is set
  useEffect(() => {
    const { autoGenerate } = useProjectStore.getState();
    if (autoGenerate && sentences.length > 0 && !autoGenerateTriggered.current && !isGenerating) {
      autoGenerateTriggered.current = true;
      // Clear the flag so it doesn't re-trigger
      useProjectStore.setState({ autoGenerate: false });
      handleGenerateAll();
    }
  }, [sentences.length, isGenerating, handleGenerateAll]);

  return (
    <div className="flex flex-col h-screen">
      <TopNav projectName={projectName} />
      <div className="flex flex-1 overflow-hidden">
        <SentenceSidebar
          isGenerating={isGenerating}
          progress={progress}
          onGenerateAll={handleGenerateAll}
          onApproveAll={handleApproveAll}
        />

        {/* Main Workspace */}
        <main className="flex-1 overflow-auto p-6 flex flex-col gap-5">
          {sentences.length > 0 ? (
            <>
              {/* Sticky header + waveform */}
              <div className="sticky top-0 z-10 bg-bg-primary flex flex-col gap-5 pb-2">
                <WorkspaceHeader />
                <WaveformPlayer
                  ref={waveformRef}
                  onCurrentSegmentChange={setActiveSegmentIndex}
                />
              </div>
              <SegmentCards
                onRegenerateSegment={handleRegenerateSegment}
                onSegmentClick={(segIndex) => waveformRef.current?.seekToSegmentIndex(segIndex)}
                activeSegmentIndex={activeSegmentIndex}
              />
              <BottomActions
                onRegenerateSentence={handleRegenerateSentence}
              />
              {/* Notes */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z" />
                  </svg>
                  <span className="text-[13px] font-medium text-text-secondary">Notes</span>
                </div>
                <textarea
                  value={sentences[selectedIndex]?.notes ?? ""}
                  onChange={(e) => updateSentence(selectedIndex, { notes: e.target.value })}
                  placeholder="Add notes for this sentence..."
                  rows={3}
                  className="w-full bg-bg-secondary border border-border rounded-md px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-muted resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary focus:border-accent-primary transition-colors"
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center flex flex-col gap-2">
                <p className="text-text-secondary">No project loaded</p>
                <p className="text-sm text-text-muted">
                  Go to Setup to create a new project
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
