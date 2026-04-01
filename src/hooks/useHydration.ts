import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/project-store";
import { loadPromptVoice, loadApprovedAudio } from "../stores/audio-storage";

/**
 * App-level hydration hook.
 *
 * On mount, restores binary data from IndexedDB that Zustand persist
 * cannot store in localStorage:
 * - promptVoiceFile (Blob) → store.config.promptVoiceFile
 * - approved sentence audio (ArrayBuffer) → sentence.pipeline.concatenatedAudio
 *
 * Sentences that are not "approved" and have no audio are reset to "pending".
 */
export function useHydration() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function hydrate() {
      const state = useProjectStore.getState();
      const { projectId, sentences, updateConfig } = state;

      // 1. Restore prompt voice from IndexedDB
      const promptBlob = await loadPromptVoice(projectId);
      if (promptBlob) {
        updateConfig({ promptVoiceFile: promptBlob });
      }

      // 2. Restore approved audio + reset non-approved sentences
      const updatedSentences = await Promise.all(
        sentences.map(async (sentence) => {
          if (sentence.status === "approved" && sentence.pipeline) {
            const audio = await loadApprovedAudio(
              projectId,
              sentence.index,
            );
            if (audio) {
              return {
                ...sentence,
                pipeline: {
                  ...sentence.pipeline,
                  concatenatedAudio: audio,
                },
              };
            }
            // Approved but audio missing from IndexedDB — keep approved status
            // but user won't be able to play (they can re-export or regenerate)
            return sentence;
          }

          // Non-approved sentences with no audio: reset to pending
          if (
            sentence.status === "generating" ||
            sentence.status === "generated" ||
            sentence.status === "error"
          ) {
            return { ...sentence, status: "pending" as const };
          }

          return sentence;
        }),
      );

      useProjectStore.setState({ sentences: updatedSentences });
    }

    hydrate().catch((err) =>
      console.error("Hydration failed:", err),
    );
  }, []);
}
