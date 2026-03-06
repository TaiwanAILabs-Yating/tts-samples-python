import { useState, useCallback, useRef } from "react";
import { useProjectStore } from "../stores/project-store.ts";
import {
  generateAll,
  regenerateSegment,
  regenerateSentence,
  type PipelineState,
  type OrchestratorCallbacks,
} from "../services/tts-orchestrator.ts";
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
  const selectedIndex = useProjectStore((s) => s.selectedSentenceIndex);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);

  // Track per-sentence generating state for individual operations
  const [generatingIndices, setGeneratingIndices] = useState<Set<number>>(
    () => new Set()
  );

  // Track which specific segment is currently regenerating (null = none)
  const [regeneratingSegmentKey, setRegeneratingSegmentKey] = useState<string | null>(null);

  const ttsConfig = useRef(getConfig({
    modelId: config.modelId,
  }));

  // Update ttsConfig when modelId changes
  ttsConfig.current = getConfig({ modelId: config.modelId });

  const handleGenerateAll = useCallback(async () => {
    if (isGenerating) return;

    // Find sentences that need generation (pending or error)
    const toGenerate = sentences.filter(
      (s) => s.status === "pending" || s.status === "error"
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

      try {
        const pipeline = await generateAll(
          {
            text: sentence.text,
            promptVoiceFile: config.promptVoiceFile,
            promptVoiceText: config.promptVoiceText,
            segmentMode: config.segmentMode,
            minTokens: config.minTokens,
            maxTokens: config.maxTokens,
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

  const handleApproveAll = useCallback(() => {
    sentences.forEach((s, i) => {
      if (s.status === "generated") {
        updateSentence(i, { status: "approved" });
      }
    });
  }, [sentences, updateSentence]);

  const handleRegenerateSentence = useCallback(
    async (sentenceIndex: number) => {
      const sentence = sentences[sentenceIndex];
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
    [sentences, config, updateSentence]
  );

  const handleRegenerateSegment = useCallback(
    async (sentenceIndex: number, segmentIndex: number) => {
      const sentence = sentences[sentenceIndex];
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
    [sentences, config, updateSentence]
  );

  return {
    isGenerating,
    progress,
    generatingIndices,
    regeneratingSegmentKey,
    handleGenerateAll,
    handleApproveAll,
    handleRegenerateSentence,
    handleRegenerateSegment,
  };
}
