import { useEffect } from "react";
import { useProjectStore } from "../stores/project-store";
import { useLexiconStore } from "../stores/lexicon-store";

/**
 * Hook that auto-loads the Taiwanese lexicon when language is "nan".
 *
 * Returns the lexicon service and loading state.
 * When language is not "nan", the service is not loaded and isAvailable is false.
 */
export function useLexicon() {
  const language = useProjectStore((s) => s.config.language);
  const service = useLexiconStore((s) => s.service);
  const isLoading = useLexiconStore((s) => s.isLoading);
  const error = useLexiconStore((s) => s.error);
  const loadLexicon = useLexiconStore((s) => s.loadLexicon);

  useEffect(() => {
    if (language === "nan" && !service && !isLoading && !error) {
      loadLexicon();
    }
  }, [language, service, isLoading, error, loadLexicon]);

  return {
    service,
    isLoading,
    error,
    isAvailable: language === "nan",
  };
}
