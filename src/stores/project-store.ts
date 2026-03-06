import { create } from "zustand";
import type { PipelineState, SegmentState } from "../services/tts-orchestrator";
import type { SegmentMode } from "../utils/preprocessing";
import type { FadeCurve } from "../services/ffmpeg-service";

// --- Sentence-level state ---

export type InputMode = "direct" | "upload";

export type SentenceStatus =
  | "pending"
  | "generating"
  | "generated"
  | "approved"
  | "rejected"
  | "error";

export interface SentenceState {
  index: number;
  text: string;
  status: SentenceStatus;
  rejectNote?: string;
  notes?: string;
  pipeline?: PipelineState;
}

// --- Project config (maps to GenerateAllConfig) ---

export interface ProjectConfig {
  promptVoiceFile?: File | Blob;
  promptVoiceFileName?: string;
  promptVoiceText: string;
  language: string;
  promptLanguage: string;
  modelId: string;
  segmentMode: SegmentMode;
  minTokens: number;
  maxTokens: number;
  addEndSilence: boolean;
  concurrency: number;
  maxRetries: number;
  retryBaseDelay: number;
  crossfadeDuration: number;
  fadeCurve: FadeCurve;
  startSilence: number;
  endSilence: number;
}

// --- Saved project snapshot (excludes audio blobs for serialisation) ---

export interface SavedProject {
  id: string;
  projectName: string;
  config: Omit<ProjectConfig, "promptVoiceFile">;
  inputMode: InputMode;
  rawText: string;
  sentences: SentenceState[];
  selectedSentenceIndex: number;
  createdAt: string;
}

// --- Store ---

interface ProjectStore {
  // Project metadata
  projectId: string;
  projectName: string;
  setProjectName: (name: string) => void;

  // Config
  config: ProjectConfig;
  updateConfig: (partial: Partial<ProjectConfig>) => void;

  // Input mode & raw text
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  rawText: string;
  setRawText: (text: string) => void;

  // Sentences
  sentences: SentenceState[];
  setSentences: (sentences: SentenceState[]) => void;
  updateSentence: (index: number, partial: Partial<SentenceState>) => void;

  // Segment-level update
  updateSegmentText: (sentenceIndex: number, segmentIndex: number, text: string) => void;

  // Selection
  selectedSentenceIndex: number;
  setSelectedSentenceIndex: (index: number) => void;

  // Advanced settings drawer
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // Auto-generate flag (set from Setup, consumed by Workspace)
  autoGenerate: boolean;

  // Multi-project management
  savedProjects: SavedProject[];
  saveCurrentProject: () => void;
  switchProject: (id: string) => void;
  deleteProject: (id: string) => void;

  // Reset
  reset: () => void;
}

const defaultConfig: ProjectConfig = {
  promptVoiceText: "",
  language: "nan",
  promptLanguage: "nan",
  modelId: "MasterZhengyanKaishi",
  segmentMode: "sentence",
  minTokens: 10,
  maxTokens: 40,
  addEndSilence: true,
  concurrency: 5,
  maxRetries: 3,
  retryBaseDelay: 1.0,
  crossfadeDuration: 0.05,
  fadeCurve: "hsin",
  startSilence: 0.3,
  endSilence: 0.3,
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  projectId: generateId(),
  projectName: "My Project",
  setProjectName: (projectName) => set({ projectName }),

  config: { ...defaultConfig },
  updateConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),

  inputMode: "direct",
  setInputMode: (inputMode) => set({ inputMode }),

  rawText: "",
  setRawText: (rawText) => set({ rawText }),

  sentences: [],
  setSentences: (sentences) => set({ sentences }),
  updateSentence: (index, partial) =>
    set((state) => ({
      sentences: state.sentences.map((s, i) =>
        i === index ? { ...s, ...partial } : s,
      ),
    })),

  updateSegmentText: (sentenceIndex, segmentIndex, text) =>
    set((state) => ({
      sentences: state.sentences.map((s, i) => {
        if (i !== sentenceIndex || !s.pipeline) return s;
        const newSegments = [...s.pipeline.segments];
        newSegments[segmentIndex] = { ...newSegments[segmentIndex], text };
        return { ...s, pipeline: { ...s.pipeline, segments: newSegments } };
      }),
    })),

  selectedSentenceIndex: 0,
  setSelectedSentenceIndex: (selectedSentenceIndex) =>
    set({ selectedSentenceIndex }),

  isSettingsOpen: false,
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),

  autoGenerate: true,

  // --- Multi-project management ---

  savedProjects: [],

  saveCurrentProject: () => {
    const state = get();
    if (state.sentences.length === 0 && !state.rawText) return; // Don't save empty projects
    const { promptVoiceFile: _, ...configWithoutBlob } = state.config;
    const existingProject = state.savedProjects.find((p) => p.id === state.projectId);
    const snapshot: SavedProject = {
      id: state.projectId,
      projectName: state.projectName,
      config: configWithoutBlob,
      inputMode: state.inputMode,
      rawText: state.rawText,
      sentences: state.sentences,
      selectedSentenceIndex: state.selectedSentenceIndex,
      createdAt: existingProject?.createdAt ?? new Date().toISOString(),
    };
    set((s) => {
      const existingIdx = s.savedProjects.findIndex((p) => p.id === snapshot.id);
      const updated = [...s.savedProjects];
      if (existingIdx >= 0) {
        updated[existingIdx] = snapshot;
      } else {
        updated.push(snapshot);
      }
      return { savedProjects: updated };
    });
  },

  switchProject: (id: string) => {
    const state = get();
    const target = state.savedProjects.find((p) => p.id === id);
    if (!target || target.id === state.projectId) return;

    // Save current project first
    state.saveCurrentProject();

    // Load target project
    set({
      projectId: target.id,
      projectName: target.projectName,
      config: { ...defaultConfig, ...target.config },
      inputMode: target.inputMode,
      rawText: target.rawText,
      sentences: target.sentences,
      selectedSentenceIndex: target.selectedSentenceIndex,
      isSettingsOpen: false,
      autoGenerate: false,
    });
  },

  deleteProject: (id: string) => {
    const state = get();
    if (id === state.projectId) return; // Cannot delete active project
    set((s) => ({
      savedProjects: s.savedProjects.filter((p) => p.id !== id),
    }));
  },

  reset: () => {
    // Save current project before resetting
    get().saveCurrentProject();
    set({
      projectId: generateId(),
      projectName: "My Project",
      config: { ...defaultConfig },
      inputMode: "direct",
      rawText: "",
      sentences: [],
      selectedSentenceIndex: 0,
      isSettingsOpen: false,
      autoGenerate: true,
    });
  },
}));
