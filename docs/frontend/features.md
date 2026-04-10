# Features

## Page Flow

```
Setup Page → Workspace Page
   │              │
   ├── Voice      ├── Regenerate All / per-sentence
   ├── Text       ├── Waveform playback + zoom
   ├── Params     ├── Segment editing + regeneration
   └── Advanced   ├── Approve / Reject / Download
                  ├── Notes per sentence
                  ├── Export (ZIP + metadata)
                  └── Project switching (TopNav dropdown)
```

---

## 0. Multi-Project Management

Users can work on multiple projects and switch between them without losing progress.

### Project Switcher
- Located in the top-left corner of the Workspace page (project name button)
- Click to open a dropdown listing all saved projects
- Each project shows a status indicator dot:
  - **Green**: all sentences approved
  - **Yellow**: some sentences approved
  - **Gray**: no approved sentences / pending
- Click a project to switch (current project is auto-saved first)
- Trash icon to delete any non-active project
- "+ New Project" at the bottom creates a fresh project and navigates to Setup

### Auto-Save
- Projects are automatically saved to the in-memory project list when:
  - Sentences change (status updates, text edits, notes)
  - User switches to another project
  - User clicks "New Project" (which calls `reset()`)

### Limitations
- Projects are stored in memory only (not persisted to localStorage/backend)
- `promptVoiceFile` (audio blob) is not preserved when switching projects

---

## 1. Project Setup

### Voice Prompt Upload
- Drag & drop or click to upload WAV/MP3 voice file
- In-page audio playback with duration display
- Prompt language selection (Chinese, Taiwanese, English)
- Prompt text transcription input

### Text Input
**Direct Input:**
- Free-form textarea
- Real-time character and token count display

**File Upload:**
- Drag & drop `.txt` files
- Auto-detects Kaldi format (`utterance_id text` per line)
- Shows file metadata (name, line count, file size)
- Each non-empty line becomes a separate sentence

### Segment Preview
- Before creating project, preview how text will be split into segments
- Shows segment count and per-segment token counts
- Adjustable via segmentation mode and min/max token settings

---

## 2. Audio Generation

### Generation Pipeline
1. Upload prompt voice to asset storage
2. For each sentence:
   - Split into segments by configured mode
   - Generate each segment via zero-shot TTS API
   - Parallel execution with configurable concurrency (default: 5)
   - Automatic retry with exponential backoff on failure
3. Post-processing per sentence:
   - Pad each segment with configurable start/end silence
   - Concatenate segments with crossfade (FFmpeg.wasm)
   - Generate SRT subtitles (optional)

### Regeneration
- **Sentence-level:** Regenerate all segments in a sentence
- **Segment-level:** Regenerate individual segment (click regenerate button on segment card)
- Text can be edited before regeneration

---

## 3. Waveform Player

### Visualization
- Canvas-based waveform with amplitude bars
- Color-coded segments (6-color palette)
- Segment labels and divider lines
- Playhead with time display

### Controls
| Control | Description |
|---------|-------------|
| Play/Pause | Toggle playback (Space key) |
| Prev/Next Segment | Navigate between segments ([ ] keys) |
| Skip to Start/End | Jump to beginning or end |
| Zoom | 0.5x to 4x magnification with scroll |
| Playback Speed | 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x |
| Volume | Slider control |
| Click to Seek | Click anywhere on waveform to jump |

### Sticky Behavior
- Header + waveform stays fixed at top when scrolling through many segments

---

## 4. Segment Editing

### Inline Text Editing
- Click on segment text to enter edit mode
- Input field replaces text display
- **Enter** or **blur**: save changes
- **Escape**: cancel editing
- Changes stored in `updateSegmentText()` in project store

### Segment Highlighting
- During playback, the current segment card is highlighted with a ring border
- Click on a segment card to seek waveform to that segment's position

### Word Segmentation (Taiwanese only)
When language is set to `nan` (台語), each segment card displays a word segmentation section:

- **Auto-segmentation**: Text is split into words using backward maximum match against a ~400K word lexicon
- **Word chips**: Each word displayed as a chip with Tailo pronunciation on top, Chinese below
- **Vocabulary validation**: Green background = in lexicon, Red background = OOV (out of vocabulary)
- **Display toggle**: Click a word to switch between Chinese-primary and Tailo-primary display
- **Pronunciation selection**: Click on the Tailo label to open a popover with all candidate pronunciations
- **Custom pronunciation**: Popover includes a text input for entering custom Tailo
- **Custom segmentation**: Editable input at the bottom allows manual word boundary adjustment (space-separated)

The lexicon (~14MB JSON) is lazy-loaded on first use and cached in a Zustand store.

---

## 5. Review Workflow

### Per-Sentence Actions
| Action | Trigger | Description |
|--------|---------|-------------|
| Approve | Button / `A` key | Mark sentence as approved |
| Reject | Button / `R` key | Mark sentence as rejected |
| Download | Button | Download single sentence as WAV (only when approved) |

### Bulk Actions
| Action | Location | Description |
|--------|----------|-------------|
| Regenerate All | Sidebar header | Regenerate all pending/error sentences |
| Approve All | Sidebar header | Approve all generated sentences |

### Status Indicators
| Status | Color | Badge |
|--------|-------|-------|
| Pending | Gray | `pending` |
| Generating | Blue | `generating` (animated pulse) |
| Generated | Yellow | `generated` |
| Approved | Green | `approved` |
| Rejected | Red | `rejected` |
| Error | Red | `error` |

---

## 6. Notes

Each sentence has a notes field at the bottom of the workspace area.

- Free-form textarea for recording observations
- Persisted per-sentence in `SentenceState.notes`
- Included in metadata.json when exporting with "Audio + Metadata" mode
- Useful for tracking reviewer comments, pronunciation issues, etc.

---

## 7. Export & Download

### Single Sentence Download
- Available via Download button in WorkspaceHeader
- Only enabled when sentence is approved and has concatenated audio
- Downloads as WAV: `{projectName}_sentence_{XXX}.wav`

### Batch Download (ZIP)
Split button in sidebar footer with two modes:

**Audio + Metadata (default):**
- All approved sentence WAV files
- `metadata.json` with:
  - Project name and export timestamp
  - Full config snapshot:
    - Basic: language, promptLanguage, promptVoiceText, promptVoiceFileName, modelId
    - Segmentation: segmentMode, minTokens, maxTokens
    - Advanced: addEndSilence, concurrency, maxRetries, retryBaseDelay, crossfadeDuration, fadeCurve, startSilence, endSilence, outputSrt
  - All sentences with index, text, status, notes, segment count, duration, audio filename

**Audio Only:**
- Only approved sentence WAV files

ZIP files are built in-browser using pure JavaScript (CRC32 checksums, no external library).

---

## 8. Keyboard Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| `Space` | Toggle play/pause | Not in text input |
| `[` | Previous segment | Not in text input |
| `]` | Next segment | Not in text input |
| `Arrow Up` | Previous sentence | Not in text input |
| `Arrow Down` | Next sentence | Not in text input |
| `A` | Approve sentence | Not in text input |
| `R` | Reject sentence | Not in text input |

Shortcuts are disabled when the cursor is in a text input, textarea, or contenteditable element.

---

## 9. Advanced Settings

Accessible via gear icon in SetupPage. Slide-out drawer with:

| Section | Settings |
|---------|----------|
| Audio Generation | End silence token, parallel workers, max retries, retry delay |
| Silence Padding | Start silence (0-1s), End silence (0-1s) |
| Crossfade | Duration (0-0.2s), Curve type (tri/qsin/hsin/log/exp) |

These settings are stored in `ProjectConfig` and passed through the generation pipeline.
