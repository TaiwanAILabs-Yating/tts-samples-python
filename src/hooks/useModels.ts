import { useEffect, useState } from "react";
import { getConfig } from "../config/index.ts";
import { fetchTtsModels } from "../services/model-client.ts";
import { foldModelIds } from "../services/tts-client.ts";
import { logger } from "../utils/logger.ts";

/** Fallback list used when the model service is unavailable. */
export const MODEL_PRESETS = ["MasterZhengyanKaishi", "MasterZhengyanFoJing"];

/**
 * Load the enabled TTS model list on mount. On failure, falls back to
 * MODEL_PRESETS so the Model selector always has options.
 */
export function useModels() {
  const [models, setModels] = useState<string[]>(MODEL_PRESETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = await fetchTtsModels(getConfig());
        const folded = foldModelIds(ids);
        if (!cancelled) {
          setModels(folded.length > 0 ? folded : MODEL_PRESETS);
          setError(false);
        }
      } catch (err) {
        logger.ttsClient.error(`Failed to load model list: ${err}`);
        if (!cancelled) {
          setModels(MODEL_PRESETS);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, error };
}
