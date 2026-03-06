# Pages & Components

## Pages

### SetupPage (`src/pages/SetupPage.tsx`)

Project creation and configuration page. Two-column layout:

**Left Column:**
- `VoiceSetup` - Prompt voice upload, language selection, prompt text

**Right Column:**
- `TextInputCard` - Text input (direct typing or file upload)
- `GenerationParams` - Language, model, segmentation controls

**Footer:**
- "Create & Generate" button (creates project and auto-generates all sentences)
- Segment preview modal showing how text will be split

**Props:** None (reads from store)

---

### WorkspacePage (`src/pages/WorkspacePage.tsx`)

Main audio generation and review workspace. Sidebar + main area layout:

**Sidebar:** `SentenceSidebar`
**Main Area (top to bottom):**
1. `WorkspaceHeader` + `WaveformPlayer` (sticky)
2. `SegmentCards`
3. `BottomActions`
4. Notes textarea

**Key behaviors:**
- On mount: splits rawText into sentences, pre-creates segment previews
- Auto-triggers `generateAll()` if `autoGenerate` flag is set
- Manages `activeSegmentIndex` for waveform ↔ segment card sync
- Registers keyboard shortcuts via `useKeyboardShortcuts`

---

## Shared Components

### TopNav (`src/components/TopNav.tsx`)

Top navigation bar shared across both pages.

| Mode | Left | Right |
|------|------|-------|
| Setup | "New Project" text | Cancel button |
| Workspace | Project name + dropdown chevron (Project Switcher) | "+ New Project" button |

**Project Switcher Dropdown** (Workspace mode only):
- Triggered by clicking the project name button
- Shows all saved projects with status dots:
  - Green: all sentences approved
  - Yellow: partially approved
  - Gray: no approved sentences
- Click a project to switch (auto-saves current first)
- Trash icon to delete non-active projects
- "+ New Project" link at bottom (saves current, navigates to Setup)
- Click outside to close

**Props:** `projectName?: string`

---

## Setup Components

### VoiceSetup (`src/components/setup/VoiceSetup.tsx`)

Voice prompt configuration panel.

**Features:**
- Project name text input
- Drag & drop voice audio upload (WAV/MP3)
- Audio playback with play/pause + duration display
- Prompt language selector (Chinese, Taiwanese, English)
- Prompt text textarea

**State:** Uses internal state for audio playback, reads/writes config from store.

---

### TextInputCard (`src/components/setup/TextInputCard.tsx`)

Text input with tab switching between Direct Input and Upload File.

**Direct Input tab:**
- Textarea with character/token counts
- Real-time token counting via `countTokens()`

**Upload File tab:**
- Drag & drop zone + "Browse Files" button
- Auto-detects Kaldi format (>80% lines matching `^\S+\s+.+`)
- Shows file info (name, line count, size) after upload
- Remove file button

**Props:** None (reads from store)

---

### GenerationParams (`src/components/setup/GenerationParams.tsx`)

Generation parameter controls.

**Controls:**
- Target Language: Chinese / Taiwanese / English
- Model: MasterZhengyanKaishi / MasterZhengyanFoJing
- Segmentation Mode: Raw / Sentence / Clause
- Min/Max Token range sliders (1-100)

**Props:** None (reads from store)

---

## Workspace Components

### WorkspaceHeader (`src/components/workspace/WorkspaceHeader.tsx`)

Current sentence display and action buttons.

**Layout:**
- Row 1: Sentence title (#001) + Status badge + Duration badge | Approve / Reject / Download buttons
- Row 2: Sentence full text (truncated at 80 chars with expand/collapse)
- Error banner (shown when sentence has error status)

**Download behavior:** Single sentence WAV download, enabled only when sentence is approved and has concatenated audio.

**Props:** None (reads from store)

---

### SentenceSidebar (`src/components/workspace/SentenceSidebar.tsx`)

Left sidebar with sentence list and bulk actions.

**Sections:**
1. **Header** - Regenerate All / Approve All buttons, filter row with stats
2. **Sentence List** - Scrollable list with status indicators, text preview, segment/duration info
3. **Footer** - Split download button

**Split Download Button:**
- Main button: "Download Approved (ZIP)"
- Dropdown toggle: chevron arrow
- Options: "Audio + Metadata" (default, includes metadata.json) / "Audio Only"

**metadata.json format:**
```json
{
  "project": "My Project",
  "exportedAt": "2026-03-05T...",
  "config": {
    "language": "nan",
    "promptLanguage": "nan",
    "promptVoiceText": "...",
    "promptVoiceFileName": "voice.wav",
    "modelId": "MasterZhengyanKaishi",
    "segmentMode": "sentence",
    "minTokens": 10,
    "maxTokens": 40,
    "advanced": {
      "addEndSilence": true,
      "concurrency": 5,
      "maxRetries": 3,
      "retryBaseDelay": 1.0,
      "crossfadeDuration": 0.05,
      "fadeCurve": "hsin",
      "startSilence": 0.3,
      "endSilence": 0.3,
      "outputSrt": true
    }
  },
  "sentences": [
    {
      "index": 0,
      "text": "...",
      "status": "approved",
      "notes": "reviewer comment here",
      "segmentCount": 3,
      "duration": 5.23,
      "audioFile": "project_sentence_001.wav"
    }
  ]
}
```

**ZIP creation:** Pure JavaScript implementation with CRC32 checksums (no external dependencies).

---

### WaveformPlayer (`src/components/workspace/WaveformPlayer.tsx`)

Canvas-based waveform visualization with full playback controls.

**Visual elements:**
- Waveform amplitude bars (color-coded by segment)
- Segment backgrounds with labels
- Playhead line with time label
- Time markers

**Controls:**
- Transport: skip-to-start, prev/next segment, play/pause, skip-to-end
- Zoom: zoom-out, percentage display, zoom-in (0.5x - 4x)
- Speed: cycle through 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x
- Volume: slider control
- Time: current / total display

**Imperative handle** (via `forwardRef`):
```typescript
interface WaveformPlayerHandle {
  togglePlayPause: () => void;
  seekToPrevSegment: () => void;
  seekToNextSegment: () => void;
  seekToSegmentIndex: (index: number) => void;
}
```

**Props:**
- `onCurrentSegmentChange?: (index: number) => void`

---

### SegmentCards (`src/components/workspace/SegmentCards.tsx`)

Displays individual segment cards with editing capabilities.

**Each card shows:**
- Segment number + time range + color-coded left border
- Editable text (click to inline-edit, Enter/blur to save, Escape to cancel)
- Regenerate button (re-generates single segment)
- Status indicator (spinner during generation, error icon)

**Active segment highlighting:** Ring border when `activeSegmentIndex` matches.

**Props:**
- `onRegenerateSegment: (sentenceIndex, segmentIndex) => void`
- `onSegmentClick?: (segmentIndex: number) => void`
- `activeSegmentIndex?: number`

---

### BottomActions (`src/components/workspace/BottomActions.tsx`)

Single "Regenerate Sentence" button, left-aligned below segment cards.

**Props:**
- `onRegenerateSentence: () => void`

---

### AdvancedSettingsDrawer (`src/components/workspace/AdvancedSettingsDrawer.tsx`)

Sliding drawer panel with advanced configuration.

**Sections:**
| Section | Controls |
|---------|----------|
| Audio Generation | End silence token toggle, parallel workers (1-20), max retries (0-10), retry delay (0.1-5s) |
| Silence Padding | Start silence (0-1s), End silence (0-1s) |
| Crossfade | Duration (0-0.2s), Curve type (tri/qsin/hsin/log/exp) |
| SRT Subtitles | Output SRT toggle |

**Props:** None (reads from store, opened via `isSettingsOpen`)
