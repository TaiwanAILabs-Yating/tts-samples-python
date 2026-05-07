import { useState, useCallback, useRef } from "react";
import { useProjectStore } from "../stores/project-store.ts";
import {
  generateAll,
  regenerateSegment,
  regenerateSentence,
  concatOnly,
  type PipelineState,
  type OrchestratorCallbacks,
} from "../services/tts-orchestrator.ts";
import { type ConcatProgress } from "../services/ffmpeg-service.ts";
import { MAX_SEGMENTS_FOR_PLAYER } from "../utils/preprocessing.ts";
import { getConfig } from "../config/index.ts";
import { logger } from "../utils/logger.ts";

export interface GenerationProgress {
  completed: number;
  total: number;
}

export function useGeneration() {
  const config = useProjectStore((s) => s.config);
  const sentences = useProjectStore((s) => s.sentences);
  const updateSentence = useProjectStore((s) => s.updateSentence);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);

  // Track per-sentence generating state for individual operations
  const [generatingIndices, setGeneratingIndices] = useState<Set<number>>(
    () => new Set()
  );

  // Track which specific segment is currently regenerating (null = none)
  const [regeneratingSegmentKey, setRegeneratingSegmentKey] = useState<string | null>(null);

  // Concat-only state for explicit final-audio operations.
  const [isConcatting, setIsConcatting] = useState(false);
  const [concatProgress, setConcatProgress] = useState<ConcatProgress | null>(null);

  const ttsConfig = useRef(getConfig({
    modelId: config.modelId,
  }));

  // Update ttsConfig when modelId changes
  ttsConfig.current = getConfig({ modelId: config.modelId });

  const handleGenerateAll = useCallback(async () => {
    if (isGenerating) return;

    // Find sentences that need (re)generation
    const toGenerate = sentences.filter(
      (s) =>
        s.status === "pending" ||
        s.status === "error" ||
        s.status === "generated" ||
        s.status === "approved"
    );
    if (toGenerate.length === 0) return;

    if (!config.promptVoiceFile) {
      console.error("No prompt voice file uploaded");
      return;
    }

    setIsGenerating(true);
    setProgress({ completed: 0, total: toGenerate.length });

    let globalCompleted = 0;

    // Generate each sentence sequentially (each sentence has its own pipeline)
    for (const sentence of toGenerate) {
      const idx = sentence.index;

      logger.generation.info(`Generating sentence ${idx}: "${sentence.text.slice(0, 30)}..."`);
      updateSentence(idx, { status: "generating" });

      const callbacks: OrchestratorCallbacks = {
        onSegmentUpdate: (_segIdx, segment) => {
          // Update the sentence's pipeline state as segments complete
          const currentSentence = useProjectStore.getState().sentences[idx];
          if (currentSentence?.pipeline) {
            const newSegments = [...currentSentence.pipeline.segments];
            newSegments[_segIdx] = segment;
            updateSentence(idx, {
              pipeline: { ...currentSentence.pipeline, segments: newSegments },
            });
          }
        },
        onProgress: (completed, total) => {
          // Per-sentence segment progress — we track overall sentence progress
          setProgress({
            completed: globalCompleted,
            total: toGenerate.length,
          });
        },
      };

      const segmentInputs = sentence.pipeline?.segments.map((s) => ({
        text: s.text,
        wordSegmentation: s.wordSegmentation,
      })) ?? [];

      if (segmentInputs.length === 0) {
        updateSentence(idx, {
          status: "error",
          rejectNote: "No segments to generate",
        });
        globalCompleted++;
        setProgress({ completed: globalCompleted, total: toGenerate.length });
        continue;
      }

      // Auto-concat only for short sentences. Larger sentences are exported
      // as segments unless the user explicitly asks for final concat at
      // download.
      const skipConcat = segmentInputs.length >= MAX_SEGMENTS_FOR_PLAYER;

      try {
        const pipeline = await generateAll(
          {
            segments: segmentInputs,
            promptVoiceFile: config.promptVoiceFile,
            promptVoiceText: config.promptVoiceText,
            language: config.language,
            promptLanguage: config.promptLanguage,
            addEndSilence: config.addEndSilence,
            concurrency: config.concurrency,
            maxRetries: config.maxRetries,
            retryBaseDelay: config.retryBaseDelay,
            crossfadeDuration: config.crossfadeDuration,
            fadeCurve: config.fadeCurve,
            startSilence: config.startSilence,
            endSilence: config.endSilence,
            skipConcat,
            config: ttsConfig.current,
          },
          callbacks
        );

        const hasErrors = pipeline.segments.some((s) => s.status === "error");
        updateSentence(idx, {
          status: hasErrors ? "error" : "generated",
          pipeline,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateSentence(idx, {
          status: "error",
          rejectNote: errMsg,
        });
        logger.generation.error(`Generation failed for sentence ${idx}:`, err);
      }

      globalCompleted++;
      setProgress({ completed: globalCompleted, total: toGenerate.length });
    }

    setIsGenerating(false);
    setProgress(null);
  }, [isGenerating, sentences, config, updateSentence]);

  const handleRegenerateSentence = useCallback(
    async (sentenceIndex: number) => {
      if (isGenerating) return;
      const sentence = useProjectStore.getState().sentences[sentenceIndex];
      if (!sentence?.pipeline) return;

      setGeneratingIndices((prev) => new Set(prev).add(sentenceIndex));
      updateSentence(sentenceIndex, { status: "generating" });

      const callbacks: OrchestratorCallbacks = {
        onSegmentUpdate: (_segIdx, segment) => {
          const current = useProjectStore.getState().sentences[sentenceIndex];
          if (current?.pipeline) {
            const newSegments = [...current.pipeline.segments];
            newSegments[_segIdx] = segment;
            updateSentence(sentenceIndex, {
              pipeline: { ...current.pipeline, segments: newSegments },
            });
          }
        },
      };

      try {
        const updatedPipeline = await regenerateSentence(
          sentence.pipeline,
          {
            promptVoiceText: config.promptVoiceText,
            language: config.language,
            promptLanguage: config.promptLanguage,
            addEndSilence: config.addEndSilence,
            maxRetries: config.maxRetries,
            retryBaseDelay: config.retryBaseDelay,
            crossfadeDuration: config.crossfadeDuration,
            fadeCurve: config.fadeCurve,
            config: ttsConfig.current,
          },
          callbacks
        );

        const hasErrors = updatedPipeline.segments.some(
          (s) => s.status === "error"
        );
        updateSentence(sentenceIndex, {
          status: hasErrors ? "error" : "generated",
          pipeline: updatedPipeline,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateSentence(sentenceIndex, { status: "error", rejectNote: errMsg });
        console.error(`Regenerate sentence ${sentenceIndex} failed:`, err);
      }

      setGeneratingIndices((prev) => {
        const next = new Set(prev);
        next.delete(sentenceIndex);
        return next;
      });
    },
    [isGenerating, sentences, config, updateSentence]
  );

  const handleRegenerateSegment = useCallback(
    async (sentenceIndex: number, segmentIndex: number) => {
      if (isGenerating) return;
      const sentence = useProjectStore.getState().sentences[sentenceIndex];
      if (!sentence?.pipeline) return;

      setGeneratingIndices((prev) => new Set(prev).add(sentenceIndex));
      setRegeneratingSegmentKey(`${sentenceIndex}:${segmentIndex}`);

      const callbacks: OrchestratorCallbacks = {
        onSegmentUpdate: (_segIdx, segment) => {
          const current = useProjectStore.getState().sentences[sentenceIndex];
          if (current?.pipeline) {
            const newSegments = [...current.pipeline.segments];
            newSegments[_segIdx] = segment;
            updateSentence(sentenceIndex, {
              pipeline: { ...current.pipeline, segments: newSegments },
            });
          }
        },
      };

      try {
        const updatedPipeline = await regenerateSegment(
          sentence.pipeline,
          segmentIndex,
          {
            promptVoiceText: config.promptVoiceText,
            language: config.language,
            promptLanguage: config.promptLanguage,
            addEndSilence: config.addEndSilence,
            maxRetries: config.maxRetries,
            retryBaseDelay: config.retryBaseDelay,
            crossfadeDuration: config.crossfadeDuration,
            fadeCurve: config.fadeCurve,
            config: ttsConfig.current,
          },
          callbacks
        );

        const hasErrors = updatedPipeline.segments.some(
          (s) => s.status === "error"
        );
        updateSentence(sentenceIndex, {
          status: hasErrors ? "error" : "generated",
          pipeline: updatedPipeline,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateSentence(sentenceIndex, { status: "error", rejectNote: errMsg });
        console.error(
          `Regenerate segment ${segmentIndex} of sentence ${sentenceIndex} failed:`,
          err
        );
      }

      setGeneratingIndices((prev) => {
        const next = new Set(prev);
        next.delete(sentenceIndex);
        return next;
      });
      setRegeneratingSegmentKey(null);
    },
    [isGenerating, config, updateSentence]
  );


  /**
   * Concat the existing pipeline.segments into final audio.
   * Used when a caller explicitly needs final audio from existing segments.
   * Returns true on success, false on failure (no state change on failure).
   */
  const handleConcatOnly = useCallback(
    async (sentenceIndex: number): Promise<boolean> => {
      const sentence = useProjectStore.getState().sentences[sentenceIndex];
      if (!sentence?.pipeline) return false;
      if (sentence.pipeline.concatenatedAudio) return true;

      setIsConcatting(true);
      setConcatProgress(null);
      try {
        const updatedPipeline = await concatOnly(
          sentence.pipeline,
          config.crossfadeDuration ?? 0.05,
          config.fadeCurve ?? "tri",
          { onConcatProgress: (info) => setConcatProgress(info) },
        );
        updateSentence(sentenceIndex, { pipeline: updatedPipeline });
        return true;
      } catch (err) {
        logger.generation.error(
          `Concat-only failed for sentence ${sentenceIndex}:`,
          err,
        );
        return false;
      } finally {
        setIsConcatting(false);
        setConcatProgress(null);
      }
    },
    [config, updateSentence],
  );

  const handleApproveAll = useCallback(async () => {
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (s.status !== "generated") continue;
      updateSentence(i, { status: "approved" });
    }
  }, [sentences, updateSentence]);

  // canRegenerate is intentionally decoupled from isConcatting — the concat
  // overlay (z-50, inset-0) blocks clicks anyway, and propagating this flag to
  // 1485 segment cards would force a re-render storm even with React.memo.
  const canRegenerate = !isGenerating;
  const canApproveReject = !isGenerating && !isConcatting;

  return {
    isGenerating,
    isConcatting,
    concatProgress,
    canRegenerate,
    canApproveReject,
    progress,
    generatingIndices,
    regeneratingSegmentKey,
    handleGenerateAll,
    handleApproveAll,
    handleConcatOnly,
    handleRegenerateSentence,
    handleRegenerateSegment,
  };
}
