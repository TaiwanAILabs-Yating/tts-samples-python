# AILabs Zero-Shot TTS Web Frontend — Design Specification Ticket

## Context

AILabs 內部已建立一套基於 zero-shot 語音合成的 TTS 服務，目前僅提供 Python CLI 工具（`main.py` / `batch_generate.py`），使用者必須透過 command line 操作。現需打造一個 Web 前端介面，讓內部團隊成員（包含非工程背景人員）能直觀地使用此服務。

**設計風格參考**：以 **ElevenLabs** 為主要設計參考 — Dark theme、Progressive disclosure、Canvas-based waveform、狀態色彩編碼、Contextual sidebar。

---

## 1. User Personas

| Persona | 背景 | 需求 |
|---------|------|------|
| **內容製作人員** | 節目製作人員，不熟 CLI | 上傳音檔 clone 聲音，貼上文字批次生成，逐句審核後匯出 |
| **AI 工程師** | TTS 團隊成員 | 快速測試不同 prompt voice、不同參數的效果，精細調整 segment 策略 |
| **語音標註人員** | 基本電腦操作 | 逐句聽取、標記通過/不通過、指定重新生成 |

---

## 2. 頁面架構

```
+---------------------------------------------------------------+
|  Top Navigation Bar                                            |
|  [Logo: AILabs TTS]  [Projects ▼]  [+ New Project]  [Settings]|
+---------------------------------------------------------------+
|  +-----------+  +--------------------------------------------+ |
|  |           |  |                                            | |
|  |  Sentence |  |        Main Workspace Area                 | |
|  |  List     |  |                                            | |
|  |  Sidebar  |  |  +--------------------------------------+  | |
|  |           |  |  |  Waveform Player + SRT Segments      |  | |
|  |  (Left)   |  |  +--------------------------------------+  | |
|  |           |  |                                            | |
|  |           |  |  +--------------------------------------+  | |
|  |           |  |  |  Segment Cards (detail / actions)    |  | |
|  |           |  |  +--------------------------------------+  | |
|  |           |  |                                            | |
|  +-----------+  +--------------------------------------------+ |
+---------------------------------------------------------------+
```

---

## 3. View A — 專案建立 / Voice Setup

**佈局**：Full-width modal 或 stepped wizard。

### 3.1 Voice Clone 設定區
- Prompt voice 音檔上傳（drag & drop，支援 WAV/MP3）
  - 上傳後顯示波形預覽 + 可播放 + 音檔時長
  - 系統呼叫 presign API + upload API 取得 `assetKey`
- Prompt voice text 輸入欄（textarea，必填）
- Silence padding（Advanced，預設收合）
  - `prompt_start_silence`：0.0 ~ 1.0s（slider + input）
  - `prompt_end_silence`：0.0 ~ 1.0s（slider + input）

### 3.2 文本輸入區
- **Tab 切換**：`直接輸入` / `上傳文本檔`
- **直接輸入**：Large textarea，即時顯示字數 / token 統計
- **上傳文本檔（Kaldi 格式）**：
  - Drag & drop `.txt`，格式：`utt_id 文字內容`（每行）
  - 解析後以 table 顯示，可個別編輯/刪除/新增行

### 3.3 基本參數
- Language 語言選擇（dropdown）：國語(zh) / 台語(nan) / 英文(en)
- Prompt language 提示音語言（dropdown）
- Model 選擇（dropdown）

---

## 4. View B — Advanced Settings Panel

右側 slide-in drawer，progressive disclosure 風格。

### A. Segmentation 分段設定
| 參數 | UI 元件 | 預設值 | 說明 |
|------|---------|--------|------|
| `segment_mode` | Radio group | `sentence` | `raw` / `sentence` / `clause` |
| `min_tokens` | Slider + input | `10` | 軟性最小 token 數（僅 sentence mode） |
| `max_tokens` | Slider + input | `40` | 硬性最大 token 數（僅 sentence mode） |

### B. Audio Generation 設定
| 參數 | UI 元件 | 預設值 | 說明 |
|------|---------|--------|------|
| `add_end_silence` | Toggle | `ON` | 加入結尾靜音 token |
| `max_parallel` | Number input | `5` | 最大平行請求數 |
| `max_retries` | Number input | `3` | 失敗重試次數 |
| `retry_base_delay` | Number input | `1.0` | 重試基礎延遲秒數 |

### C. Crossfade 設定
| 參數 | UI 元件 | 預設值 | 說明 |
|------|---------|--------|------|
| `crossfade_duration` | Slider + input | `0.05` | 0 ~ 0.2s |
| `crossfade_curve` | Dropdown | `hsin` | `tri` / `qsin` / `hsin` / `log` / `exp` |

### D. SRT 字幕
| 參數 | UI 元件 | 預設值 | 說明 |
|------|---------|--------|------|
| `output_srt` | Toggle | `ON` | 預設啟用 SRT 生成 |

---

## 5. View C — Main Workspace（核心操作介面）

### 5.1 Left Sidebar — Sentence List

```
+-------------------------------------------+
| #001                            [●狀態]   |
| 一九八二年，上人在佛七法會中開示...        |
| Segments: 3  |  Duration: 13.82s          |
+-------------------------------------------+
```

**狀態色彩編碼**：
| 狀態 | 色彩 | 符號 |
|------|------|------|
| `pending` | `#6B7280` 灰 | ● |
| `generating` | `#3B82F6` 藍（脈動動畫） | ◌ |
| `generated`（未審核） | `#F59E0B` 黃 | ● |
| `approved` | `#10B981` 綠 | ✓ |
| `rejected` | `#EF4444` 紅 | ✗ |
| `error` | `#EF4444` 紅 | ⚠ |

**互動**：
- 點擊切換至該句 waveform player
- 選中項以左側 accent border（`#8B5CF6`）標示
- 鍵盤 `↑`/`↓` 切換句子
- Right-click context menu：重新生成 / 標記通過 / 不通過
- Multi-select checkbox 用於批次操作

**頂部操作列**：
- `Generate All` 按鈕 | `Approve All Generated` 按鈕
- Filter dropdown：All / Pending / Generated / Approved / Rejected / Error
- 統計：`12/30 approved | 5 pending | 2 error`

**底部操作列**：
- `Download Approved` | `Download All`
- 下載格式：WAV only / WAV + SRT / ZIP archive

### 5.2 Right Main — Waveform Player + SRT Segments

```
+---------------------------------------------------------------+
|  Sentence #001: 一九八二年，上人在佛七法會中開示...             |
|  Status: generated    Duration: 13.82s                        |
+---------------------------------------------------------------+
|  [Waveform with SRT Segment Color Overlay]                    |
|  ┌─────────────────────────────────────────────────────────┐  |
|  │  ▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁          │  |
|  │  |-- Seg 1 --|--- Seg 2 ---|---- Seg 3 --------|       │  |
|  │  |  Purple   |    Blue     |      Green         |       │  |
|  └─────────────────────────────────────────────────────────┘  |
|  00:00                                            00:13.82    |
|  [<<] [|<] [ ▶ Play ] [>|] [>>]    [1x ▼] [🔊 ━━━━]        |
+---------------------------------------------------------------+
|  Segment Cards:                                               |
|  +-----------------------------------------------------------+|
|  | Seg 1  00:00~04:21 | 一九八二年，上人在佛七... [🔄][✓]   ||
|  +-----------------------------------------------------------+|
|  | Seg 2  04:21~09:54 | 高愛師姊聽到矣。...      [🔄][✓]   ||
|  +-----------------------------------------------------------+|
|  | Seg 3  09:54~13:82 | 就要把家裡的人當作...    [🔄][✓]    ||
|  +-----------------------------------------------------------+|
|  [🔄 Regenerate Sentence] [✓ Approve] [✗ Reject]             |
+---------------------------------------------------------------+
```

---

## 6. Waveform + SRT Segment 互動設計（核心元件）

### 6.1 Waveform Rendering
- **Canvas-based bar waveform**（ElevenLabs style）
- Web Audio API 解碼音訊 → 降採樣 → RMS amplitude → bar 繪製
- Bar width: 2px, Gap: 1px, 中心向上下延伸
- 未播放：`#4B5563`，已播放：segment 對應色彩

### 6.2 SRT Segment Overlay
- 每個 segment 以半透明背景色區分（`opacity: 0.12`）
- Segment 色彩循環：
  - `#7C3AED` Purple → `#2563EB` Blue → `#059669` Green → `#D97706` Amber → `#DC2626` Red → `#0891B2` Cyan
- 分界線：1px dashed `#6B7280`，hover 時顯示時間 label

### 6.3 互動行為

| 動作 | Waveform 區域 | Segment Card |
|------|--------------|--------------|
| Hover | 背景 opacity → 0.25 + segment text tooltip | Card 高亮 |
| Click | 跳至 segment start time 播放 | 跳至 segment start time 播放 |
| Double-click | Loop 播放該 segment | Loop 播放該 segment |
| Right-click | Regenerate / Copy text | Regenerate / Copy text |

### 6.4 Playback Controls
- Play/Pause（`Space` 鍵）
- Previous/Next segment（`[` / `]` 鍵）
- Playback speed：0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x
- Volume slider
- Click waveform 任意位置 seeking
- Playhead：白色垂直線，`requestAnimationFrame` 平滑移動
- 播放中 segment 對應的 Card 自動 scroll into view + 高亮

---

## 7. Feature 規格

### 7.1 Segment-Level Regeneration
- 點擊 Segment Card `🔄` → 僅重新呼叫該 segment 的 TTS API
- 完成後自動 crossfade 重新拼接整句 + 重算 SRT 時間戳
- 舊版本保留供對比

### 7.2 Sentence-Level Regeneration
- 點擊 `Regenerate Sentence` → 全部 segments 重新生成
- 保存舊版本至 history

### 7.3 Review & Approval
- 三種狀態：`pending` → `approved` / `rejected`
- Reject 可附加備註
- 快捷鍵：`A` = approve, `R` = reject, `↓` = 下一句
- Batch approve：Filter → Select All → Approve All

### 7.4 Batch Export
- 匯出 `approved` 句子
- 格式選項：Individual WAVs / Concatenated WAV / WAV + SRT / ZIP
- ZIP 內含 `manifest.jsonl`

### 7.5 Generation History / Versioning
- 每個 sentence 維護 `versions[]` 陣列
- 可切換聆聽不同版本，選擇特定版本為最終結果

---

## 8. User Flow（Happy Path）

```
[新建專案] → [上傳 Prompt Voice + 輸入 Prompt Text]
    → [輸入文字 or 上傳 Kaldi 文本檔]
    → [預覽分段結果 + 調整參數]
    → [Generate All]
    → [逐句播放審核]
        → 品質 OK → Approve
        → 品質不佳 → Regenerate Segment/Sentence → 再聽
    → [Download Approved（WAV + SRT + ZIP）]
```

---

## 9. API Integration — 完全前端化實作方案

> **策略**：所有 Python 函式完全 port 到 TypeScript，不另架後端。
> ffmpeg 依賴的 2 個函式使用 ffmpeg.wasm 在瀏覽器執行。
> Python 程式碼於 TS 版驗證通過後刪除。

### 9.1 Backend API Endpoints（已實作，前端直接呼叫）

| UI 操作 | Endpoint | Method | Response |
|---------|----------|--------|----------|
| 上傳 Prompt Voice | `POST /transcriptions:presign` → `POST /asset/` | POST | assetKey |
| 生成 Segment 語音 | `POST /speeches:zero-shot` | POST | Binary WAV |
| 登入取 Token（prod） | `POST /auth/v2/fedgpt/login` | POST | token |

### 9.2 函式移植總覽（Python → TypeScript）

| 函式 | 來源 | TS 實作方式 | TS 檔案位置 |
|------|------|-----------|------------|
| `preprocess_text()` | preprocessing.py | 純 regex → 直接 port | `src/utils/preprocessing.ts` |
| `strip_punctuation()` | preprocessing.py | 純 regex → 直接 port | `src/utils/preprocessing.ts` |
| `count_tokens()` | preprocessing.py | 純 regex → 直接 port | `src/utils/preprocessing.ts` |
| `force_split_by_char()` | preprocessing.py | 純邏輯 → 直接 port | `src/utils/preprocessing.ts` |
| `ensure_max_tokens()` | preprocessing.py | 純邏輯 → 直接 port | `src/utils/preprocessing.ts` |
| `balance_segments()` | preprocessing.py | 貪心演算法 → 直接 port | `src/utils/preprocessing.ts` |
| `split_sentences()` | preprocessing.py | regex + 邏輯 → 直接 port | `src/utils/preprocessing.ts` |
| `generate_utt_id()` | preprocessing.py | 字串格式化 → 直接 port | `src/utils/preprocessing.ts` |
| `format_srt_time()` | main.py | 時間運算 → 直接 port | `src/utils/srt.ts` |
| `generate_srt()` | main.py | 純格式化 → 直接 port | `src/utils/srt.ts` |
| `get_wav_duration()` | main.py | Web Audio API `AudioBuffer.duration` | `src/utils/audio.ts` |
| `send_zero_shot_request()` | client.py | `fetch()` → 直接 port | `src/services/tts-client.ts` |
| `_get_auth_headers()` | client.py | `fetch()` → 直接 port | `src/services/auth.ts` |
| `upload_prompt_voice()` | client.py | `fetch()` + `FormData` → 直接 port | `src/services/tts-client.ts` |
| `pad_audio_with_silence()` | client.py | `@ffmpeg/ffmpeg` ffmpeg.wasm | `src/services/ffmpeg-service.ts` |
| `concat_wavs_with_crossfade()` | main.py | `@ffmpeg/ffmpeg` ffmpeg.wasm | `src/services/ffmpeg-service.ts` |

### 9.3 Config 管理（統一環境參數）

Python 版將 9 個環境變數散落在 `client.py` 頂層（`os.getenv` 直接取），TS 版統一為 config 模組。

**`src/config/index.ts`**：
```typescript
interface TtsConfig {
  env: 'dev' | 'stg2' | 'prod';
  apiKey: string;
  zeroShotApiUrl: string;
  presignUrl: string;
  uploadUrl: string;
  modelId: string;
  authKey: string;
  authSecret: string;
}
```

**Config 來源優先順序**：
1. Runtime 傳入（UI Settings panel 修改時）
2. `.env` / `.env.local`（Vite `import.meta.env.VITE_*`）
3. 預設值（與 Python 版一致）

**Python env vars → TS config 對照**：
| Python `os.getenv()` | TS config field | `.env` key | 預設值 |
|----------------------|-----------------|------------|--------|
| `ENV` | `env` | `VITE_ENV` | `'dev'` |
| `API_KEY` | `apiKey` | `VITE_API_KEY` | `'fedgpt-api-key'` |
| `API_URL` | `zeroShotApiUrl` | `VITE_ZERO_SHOT_API_URL` | `'https://ent.fedgpt.cc/api/asura/v1/speeches:zero-shot'` |
| `PRESIGN_URL` | `presignUrl` | `VITE_PRESIGN_URL` | `'https://ent.fedgpt.cc/api/asura/v1/transcriptions:presign'` |
| `UPLOAD_URL` | `uploadUrl` | `VITE_UPLOAD_URL` | `'https://ent.fedgpt.cc/asset/'` |
| `MODEL_ID` | `modelId` | `VITE_MODEL_ID` | `'MasterZhengyanKaishi'` |
| `AUTH_KEY` | `authKey` | `VITE_AUTH_KEY` | `'fedgpt'` |
| `AUTH_SECRET` | `authSecret` | `VITE_AUTH_SECRET` | `''` |

### 9.4 API 呼叫前 Text Tag 處理

前端在呼叫 `/speeches:zero-shot` 前需執行的 tag prepend 邏輯：
```
若 language=nan:    text = "<|nan|>" + text
若 add_end_silence: text = text + "<|sil_200ms|>"
若 prompt_language: promptText = "<|nan|>" + promptText
```

### 9.5 ffmpeg.wasm 整合

| 函式 | Python 版做法 | ffmpeg.wasm 實作 |
|------|-------------|-----------------|
| `pad_audio_with_silence()` | subprocess → `adelay` + `apad` filter | 相同 filter chain，`@ffmpeg/ffmpeg` 在瀏覽器執行 |
| `concat_wavs_with_crossfade()` | subprocess → `acrossfade` filter chain | 相同 filter_complex 語法，直接復用 |

**注意事項**：
- `@ffmpeg/ffmpeg` v0.12+ bundle ~25MB，lazy load（用到時才載入）
- 需要 `SharedArrayBuffer`（設定 COOP/COEP headers）
- 每次處理完清理虛擬檔案系統以釋放記憶體

### 9.6 前端 TS 目錄結構

```
src/
├── config/
│   ├── index.ts              # TtsConfig interface + getConfig()
│   └── schema.ts             # Zod schema 驗證（optional）
├── services/
│   ├── tts-client.ts         # sendZeroShotRequest, presign, uploadPromptVoice
│   ├── auth.ts               # getAuthHeaders, loginForToken, token cache
│   ├── ffmpeg-service.ts     # padAudioWithSilence, concatWavsWithCrossfade
│   └── batch-generator.ts    # generateWithRetry, generateBatch
├── utils/
│   ├── preprocessing.ts      # 全部 8 個 preprocessing 函式
│   ├── srt.ts                # formatSrtTime, generateSrt
│   └── audio.ts              # getWavDuration
├── __tests__/
│   ├── preprocessing.test.ts
│   ├── tts-client.test.ts
│   ├── srt.test.ts
│   ├── ffmpeg-service.test.ts
│   └── batch-generator.test.ts
└── .env.example
```

### 9.7 風險分析

| 風險 | 等級 | 說明 | 緩解措施 |
|------|------|------|----------|
| CLI 工具消失 | ⚠️ 中 | main.py / batch_generate.py 刪除後無 CLI | 分階段遷移，TS 驗證通過後才刪 Python |
| `run_daai_experiment.py` 壞掉 | ⚠️ 低 | 依賴 client.py | 確認是否仍在使用，若是則同步更新 |
| TS Regex 行為差異 | ⚠️ 低 | `\s` 匹配範圍略不同 | 每個函式寫 unit test 比對 Python vs TS |
| ffmpeg.wasm COOP/COEP | ⚠️ 中 | 跨域資源可能被阻擋 | 確認 API server 回傳 CORP header 或用 `credentialless` 模式 |
| 瀏覽器記憶體 | ⚠️ 低 | 大量 WAV 處理時記憶體高 | 即時清理 + 限制批次數量 |

### 9.8 遷移策略（分三階段）

```
Phase 1: Port + 共存
  → 完成所有 TS port + unit test
  → 用相同測試案例驗證 parity
  → Python 程式碼不動

Phase 2: 驗證 + 切換
  → Web 前端功能完整，E2E 驗證通過
  → 確認所有場景覆蓋

Phase 3: 清理
  → 刪除 Python 程式碼（preprocessing.py, client.py, main.py, batch_generate.py）
  → 更新 README
```

### 9.9 Feature Branch 規劃（使用 Git Worktree 平行開發）

**Branch 依賴關係**（1~5 互不依賴，可完全平行）：
```
develop (base)
  ├── feature/text-preprocessing-ts         ← 獨立
  ├── feature/api-client-ts                 ← 獨立
  ├── feature/srt-generation-ts             ← 獨立
  ├── feature/audio-processing-ffmpeg-wasm  ← 獨立
  ├── feature/retry-parallel-ts             ← 獨立
  └── feature/cleanup-legacy-python         ← 依賴 1~5 全部完成
```

**Worktree 建立命令**：
```bash
mkdir -p ../tts-worktrees
git worktree add ../tts-worktrees/preprocessing  -b feature/text-preprocessing-ts        develop
git worktree add ../tts-worktrees/api-client      -b feature/api-client-ts                develop
git worktree add ../tts-worktrees/srt             -b feature/srt-generation-ts             develop
git worktree add ../tts-worktrees/ffmpeg-wasm     -b feature/audio-processing-ffmpeg-wasm  develop
git worktree add ../tts-worktrees/retry-parallel  -b feature/retry-parallel-ts             develop
```

| Branch | 難度 | 範圍 | 輸出檔案 |
|--------|------|------|----------|
| `feature/text-preprocessing-ts` | ⭐ Easy | Port preprocessing.py 全部 8 函式 + unit test | `src/utils/preprocessing.ts`, `src/__tests__/preprocessing.test.ts` |
| `feature/api-client-ts` | ⭐ Easy | Port API client + auth + config 管理 | `src/config/`, `src/services/tts-client.ts`, `src/services/auth.ts`, `.env.example` |
| `feature/srt-generation-ts` | ⭐ Easy | Port SRT 生成 + WAV duration | `src/utils/srt.ts`, `src/utils/audio.ts` |
| `feature/audio-processing-ffmpeg-wasm` | ⭐⭐ Medium | ffmpeg.wasm crossfade + silence padding | `src/services/ffmpeg-service.ts` |
| `feature/retry-parallel-ts` | ⭐ Easy | Retry + 平行執行邏輯 | `src/services/batch-generator.ts` |
| `feature/cleanup-legacy-python` | ⭐ Easy | 刪除 Python 舊程式碼 + 更新 README | 刪除多個 .py 檔案 |

**Worktree 清理**（全部 merge 後）：
```bash
git worktree remove ../tts-worktrees/preprocessing
git worktree remove ../tts-worktrees/api-client
git worktree remove ../tts-worktrees/srt
git worktree remove ../tts-worktrees/ffmpeg-wasm
git worktree remove ../tts-worktrees/retry-parallel
```

---

## 10. Design Tokens

### Color（Dark Theme）
| Token | Value | 用途 |
|-------|-------|------|
| `--bg-primary` | `#111827` | 主背景 |
| `--bg-secondary` | `#1F2937` | 卡片/面板 |
| `--bg-tertiary` | `#374151` | Hover |
| `--text-primary` | `#F9FAFB` | 主文字 |
| `--text-secondary` | `#9CA3AF` | 次文字 |
| `--accent-primary` | `#8B5CF6` | 強調色 |

### Typography
- Font: `Inter`, `Noto Sans TC`, `system-ui`
- Body: 14px, Heading: 18-24px, Monospace: `JetBrains Mono` 13px

### Spacing
- 4px base unit（4, 8, 12, 16, 24, 32, 48）

---

## 11. Acceptance Criteria

### Voice Clone Setup
- [ ] AC-01: Drag & drop 上傳 WAV/MP3，成功後波形預覽 + 可播放
- [ ] AC-02: Prompt text 必填 validation
- [ ] AC-03: 上傳 loading + progress 顯示
- [ ] AC-04: 上傳失敗顯示 error + retry
- [ ] AC-05: Silence padding 可選設定 0~1.0s

### Text Input
- [ ] AC-06: 直接輸入 textarea + 即時字數/token 統計
- [ ] AC-07: Kaldi 格式上傳解析 + table 顯示
- [ ] AC-08: Table 可編輯/刪除/新增行
- [ ] AC-09: Tab 切換保留各 tab 狀態

### Segmentation Preview
- [ ] AC-10: 調整參數後即時更新分段預覽
- [ ] AC-11: 每 segment 以色彩 tag 顯示 + token 數
- [ ] AC-12: 分段結果與 Python backend 一致

### Generation
- [ ] AC-13: Generate All 逐步生成所有 segments
- [ ] AC-14: Global + per-sentence progress 顯示
- [ ] AC-15: 每 segment 完成即時更新狀態
- [ ] AC-16: 失敗自動重試（3 次，exponential backoff）
- [ ] AC-17: 最終失敗顯示 error 狀態

### Waveform + SRT
- [ ] AC-18: Canvas-based bar waveform
- [ ] AC-19: Segment 不同背景色區分
- [ ] AC-20: 點擊 segment 區域跳至該段播放
- [ ] AC-21: Hover segment → opacity 提升 + tooltip
- [ ] AC-22: Playhead 平滑移動
- [ ] AC-23: 播放控制：Play/Pause、前後 segment、速度、音量
- [ ] AC-24: 鍵盤快捷鍵：Space, `[`, `]`
- [ ] AC-25: Segment Cards 與 waveform 同步高亮
- [ ] AC-26: 點擊 Card 跳至對應時間點

### Regeneration
- [ ] AC-27: Segment 級別重新生成
- [ ] AC-28: 重新生成後自動 crossfade + 重算 SRT
- [ ] AC-29: Sentence 級別重新生成
- [ ] AC-30: 重新生成前保存舊版本

### Review & Export
- [ ] AC-31: Approve / Reject 標記
- [ ] AC-32: Reject 可附備註
- [ ] AC-33: Sidebar 狀態色彩即時更新
- [ ] AC-34: 快捷鍵 A/R/↑/↓
- [ ] AC-35: Filter 篩選
- [ ] AC-36: Download Approved
- [ ] AC-37: 格式選擇：WAV / WAV+SRT / ZIP
- [ ] AC-38: ZIP 含 manifest.jsonl

### General
- [ ] AC-39: Dark theme 整體一致
- [ ] AC-40: Responsive layout，sidebar 可收合
- [ ] AC-41: 所有操作有 loading/error/success 回饋
- [ ] AC-42: SRT 預設啟用

---

## Appendix A: Kaldi Format

```
# 每行格式：utt_id<空白>text_content
19981202_nan 他說，每一台有人去倒垃圾時，就有幾萬人、幾千人馬上圍過來。
shang4ren2_02 年輕人，一對夫妻說，我們下定決定。
```

## Appendix B: SRT Format

```srt
1
00:00:00,000 --> 00:00:10,099
逮」就是很快速的意思；「大辯」就是無礙辯才。

2
00:00:10,099 --> 00:00:37,799
弘揚佛法，要有無礙的辯才...
```

## Appendix C: Backend API Payload

```json
{
  "input": {
    "text": "<|nan|>這是要合成的文字<|sil_200ms|>",
    "type": "text",
    "promptVoiceUrl": "",
    "promptVoiceAssetKey": "asset-key-from-upload",
    "promptText": "<|nan|>他說，每一台有人去倒垃圾時..."
  },
  "modelConfig": { "model": "MasterZhengyanKaishi" },
  "audioConfig": { "encoding": "LINEAR16" }
}
```
