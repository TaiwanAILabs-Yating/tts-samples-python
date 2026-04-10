# Architecture

## Project Structure

```
src/
├── main.tsx                 # Entry point (BrowserRouter + React root)
├── App.tsx                  # Route definitions
├── index.css                # Global theme variables (Tailwind CSS)
├── vite-env.d.ts            # Vite type declarations
│
├── pages/
│   ├── SetupPage.tsx        # Project creation & configuration
│   └── WorkspacePage.tsx    # Audio generation & editing workspace
│
├── components/
│   ├── TopNav.tsx           # Shared top navigation bar
│   ├── setup/
│   │   ├── VoiceSetup.tsx       # Voice prompt upload & config
│   │   ├── TextInputCard.tsx    # Text input (direct/file upload)
│   │   └── GenerationParams.tsx # Language, model, segmentation params
│   └── workspace/
│       ├── WorkspaceHeader.tsx       # Sentence header + action buttons
│       ├── SentenceSidebar.tsx       # Sentence list + download controls
│       ├── WaveformPlayer.tsx        # Waveform visualization + playback
│       ├── SegmentCards.tsx          # Segment cards with inline editing
│       ├── WordSegmentation.tsx     # Word segmentation + Tailo display (nan only)
│       ├── BottomActions.tsx         # Regenerate sentence button
│       ├── AdvancedSettingsDrawer.tsx # Advanced settings panel
│       └── WaveformPlaceholder.tsx   # Static waveform placeholder
│
├── hooks/
│   ├── useGeneration.ts         # TTS generation orchestration
│   ├── useAudioPlayer.ts       # Web Audio API playback controller
│   ├── useLexicon.ts            # Lexicon auto-load hook (nan only)
│   └── useKeyboardShortcuts.ts  # Workspace keyboard bindings
│
├── services/
│   ├── tts-orchestrator.ts  # Full pipeline: text → segments → audio → concat
│   ├── tts-client.ts        # HTTP client for TTS API
│   ├── batch-generator.ts   # Retry + parallel execution utilities
│   ├── ffmpeg-service.ts    # FFmpeg.wasm audio processing
│   ├── lexicon-service.ts   # Lexicon: segmentWords, toTailo, validateWords
│   └── auth.ts              # API authentication (key/token)
│
├── stores/
│   ├── project-store.ts     # Zustand global state
│   └── lexicon-store.ts     # Lexicon data store (lazy-loaded)
│
├── utils/
│   ├── preprocessing.ts     # Text segmentation & token counting
│   └── audio.ts             # WAV parsing & Web Audio crossfade
│
└── config/
    └── index.ts             # Runtime configuration (env vars)
```

## Routing

| Path | Page | Description |
|------|------|-------------|
| `/setup` | SetupPage | Create project, upload voice, configure params |
| `/workspace` | WorkspacePage | Generate, review, approve audio sentences |
| `/*` | Redirect → `/setup` | Default route |

## Data Flow

```
User Input (SetupPage)
    │
    ├── Voice upload → presign → S3 upload → asset key
    ├── Text input → rawText (store)
    └── Config → ProjectConfig (store)
    │
    ▼
Navigate to /workspace
    │
    ▼
WorkspacePage mount
    │
    ├── Split rawText → SentenceState[] (store)
    ├── Pre-split each sentence → segments (preview)
    └── Auto-trigger generateAll() if autoGenerate flag set
    │
    ▼
Generation Pipeline (useGeneration → tts-orchestrator)
    │
    ├── For each sentence:
    │   ├── For each segment:
    │   │   ├── sendZeroShotRequest() → WAV audio
    │   │   └── Retry on failure (exponential backoff)
    │   ├── padAudioWithSilence() → add start/end silence
    │   └── concatWavsWithCrossfade() → concatenated WAV
    │
    └── Update store: sentence.status, sentence.pipeline
    │
    ▼
User Review
    ├── Play/preview audio in WaveformPlayer
    ├── Edit segment text → regenerate
    ├── Approve / Reject each sentence
    ├── Add notes per sentence
    │
    ▼
Export
    ├── Single sentence → WAV download
    └── All approved → ZIP (audio + optional metadata.json)
```

## State Management (Zustand)

Single store (`project-store.ts`) manages all application state:

```typescript
interface ProjectStore {
  // Project metadata
  projectId: string;           // Unique ID for multi-project management
  projectName: string;

  // Generation config
  config: ProjectConfig;      // voice, language, model, segmentation, crossfade, etc.

  // Input
  inputMode: "direct" | "upload";
  rawText: string;

  // Sentences (core data model)
  sentences: SentenceState[];  // { index, text, status, notes, pipeline }

  // UI state
  selectedSentenceIndex: number;
  isSettingsOpen: boolean;
  autoGenerate: boolean;

  // Multi-project management
  savedProjects: SavedProject[];  // All saved project snapshots
  saveCurrentProject: () => void; // Save current state to savedProjects
  switchProject: (id) => void;    // Save current + load target project
  deleteProject: (id) => void;    // Remove a saved project (not active)
}
```

### Multi-Project System

Projects are managed in-memory via `savedProjects[]`. Each project is a `SavedProject` snapshot containing all state except `promptVoiceFile` (non-serialisable blob).

- **Auto-save**: WorkspacePage saves the active project whenever sentences change
- **Switch**: Saves current project, then loads target project from `savedProjects`
- **New Project**: Calls `reset()` which saves current project first, then creates fresh state with a new `projectId`
- **Delete**: Removes a saved project (cannot delete the currently active project)

### SentenceState Lifecycle

```
pending → generating → generated → approved
                    ↘            ↗ rejected
                      error
```

| Status | Description |
|--------|-------------|
| `pending` | Not yet generated |
| `generating` | Generation in progress |
| `generated` | Audio ready for review |
| `approved` | User approved |
| `rejected` | User rejected |
| `error` | Generation failed |

## Audio Pipeline

Two audio processing backends:

| Backend | File | Used For |
|---------|------|----------|
| **FFmpeg.wasm** | `ffmpeg-service.ts` | Crossfade with curve types, silence padding |
| **Web Audio API** | `audio.ts` | WAV duration parsing, playback |

FFmpeg.wasm is lazy-loaded (~25MB) on first audio concatenation. It supports configurable crossfade curves (tri, qsin, hsin, log, exp) via the `acrossfade` filter.

## Theme System

Dark theme defined in `index.css` via CSS custom properties:

| Category | Variables |
|----------|----------|
| Backgrounds | `--color-bg-primary` (#111827), `bg-secondary`, `bg-tertiary`, `bg-nav` |
| Text | `--color-text-primary` (#F9FAFB), `text-secondary`, `text-muted` |
| Accent | `--color-accent-primary` (#8B5CF6 purple) |
| Status | `approved` (#10B981), `rejected` (#EF4444), `generating` (#3B82F6), etc. |
| Segments | 6-color palette for waveform segment visualization |
| Fonts | Inter, Noto Sans TC (sans), JetBrains Mono (mono) |
