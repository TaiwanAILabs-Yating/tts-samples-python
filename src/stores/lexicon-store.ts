import { create } from "zustand";
import {
  createLexiconService,
  type LexiconService,
  type WordToken,
  type ValidationResult,
} from "../services/lexicon-service";

interface LexiconStore {
  /** The loaded lexicon service instance, or null if not loaded. */
  service: LexiconService | null;
  isLoading: boolean;
  error: string | null;

  /** Load the bundled lexicon (fetches /lexicon-nan.json). */
  loadLexicon: () => Promise<void>;

  /** Clear the loaded lexicon. */
  clearLexicon: () => void;

  // Convenience accessors (delegate to service; no-op if not loaded)
  segmentWords: (sentence: string) => string[];
  toTailo: (words: string[]) => WordToken[];
  validateWords: (words: string[]) => ValidationResult[];
}

export const useLexiconStore = create<LexiconStore>()((set, get) => ({
  service: null,
  isLoading: false,
  error: null,

  loadLexicon: async () => {
    const { service, isLoading } = get();
    if (service || isLoading) return; // Already loaded or loading

    set({ isLoading: true, error: null });

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}lexicon-nan.json`);
      if (!res.ok) {
        throw new Error(`Failed to fetch lexicon: ${res.status} ${res.statusText}`);
      }

      const data: Record<string, string[]> = await res.json();
      const svc = createLexiconService(data);

      set({ service: svc, isLoading: false });
      console.log(`[lexicon] Loaded ${svc.vocabSize} entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isLoading: false, error: msg });
      console.error("[lexicon] Load failed:", msg);
    }
  },

  clearLexicon: () => {
    set({ service: null, error: null });
  },

  segmentWords: (sentence: string) => {
    const { service } = get();
    if (!service) return [];
    return service.segmentWords(sentence);
  },

  toTailo: (words: string[]) => {
    const { service } = get();
    if (!service) return words.map((w) => ({ word: w, tailoList: [] }));
    return service.toTailo(words);
  },

  validateWords: (words: string[]) => {
    const { service } = get();
    if (!service) return words.map((w) => ({ word: w, inVocab: false }));
    return service.validateWords(words);
  },
}));
