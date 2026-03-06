# tts-samples-python

AILabs 基於 zero-shot 語音合成的批次文字轉語音工具，支援將長文本自動分句並生成連續的語音輸出。

## 功能特點

- 自動文本預處理與分句
- Zero-shot 語音合成（基於提示音檔clone聲音）
- 批次生成多個句子的語音
- 自動串接所有語音片段為單一音檔
- 智能跳過已存在的音檔（避免重複生成）
- 支援多語言（國語、台語、英文）
- 可選擇分句模式（句號分句或逗號分句）
- 支援結尾靜音標記（防止語音提前結束）
- 支援提示音檔靜音填充（改善語音品質）
- 支援音訊片段交叉淡化（消除接合處的爆音/雜訊）
- 支援平行請求（加速批次生成）
- 自動重試機制（指數退避策略）

## 系統需求

- Python 3.x
- FFmpeg（用於音檔串接）

## 安裝

```bash
# 確保已安裝 FFmpeg
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg
```

## 使用方法

### 基本用法

```bash
python3 main.py \
    --input-text "<您的輸入文本>" \
    --prompt-voice-path /path/to/your/audio/file.wav \
    --prompt-voice-text "<提示音檔的文字內容>" \
    --audio-basename "<音檔基礎名稱>" \
    --language nan \
    --output-dir output \
    --output-wav output.wav
```

### 參數說明

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `--input-text` | string | 是 | 要轉換成語音的文本內容 |
| `--prompt-voice-path` | string | 是 | 提示音檔的路徑（用於聲音clone） |
| `--prompt-voice-text` | string | 是 | 提示音檔所對應的文字內容 |
| `--audio-basename` | string | 是 | 生成音檔的基礎名稱（用於 utterance ID） |
| `--language` | string | 是 | 語言代碼：`zh`（國語）、`nan`（台語）、`en`（英文） |
| `--output-dir` | string | 是 | 輸出目錄路徑（存放分句音檔） |
| `--output-wav` | string | 是 | 最終串接後的音檔路徑 |
| `--prompt-language` | string | 否 | 提示音檔的語言標記，會在 prompt text 前加上 `<\|{lang}\|>` |
| `--segment-mode` | string | 否 | 分段模式：`raw`（不分段）、`sentence`（句號分段，預設）、`clause`（含逗號分段） |
| `--add-end-silence` | flag | 否 | 在每句結尾加入 `<\|sil_200ms\|>` 靜音標記，防止語音提前結束 |
| `--prompt-start-silence` | float | 否 | 在提示音檔開頭填充的靜音秒數（預設：0.0） |
| `--prompt-end-silence` | float | 否 | 在提示音檔結尾填充的靜音秒數（預設：0.0） |
| `--crossfade-duration` | float | 否 | 音訊片段間的交叉淡化時長（秒），0 表示禁用（預設：0.05） |
| `--crossfade-curve` | string | 否 | 交叉淡化曲線類型：`tri`（線性）、`qsin`、`hsin`（預設）、`log`、`exp` |

## SRT 字幕生成

| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `--output-srt` | string | 無 | 輸出 SRT 字幕檔案路徑 |

### SRT 輸出格式
- 時間戳格式：`HH:MM:SS,mmm`
- 根據實際音訊長度自動計算時間
- UTF-8 編碼

### 輸出範例
```srt
1
00:00:00,000 --> 00:00:02,345
第一個句子

2
00:00:02,345 --> 00:00:05,678
第二個句子
```
## Token-Based 分段參數

> **注意**：此參數僅在 `--segment-mode sentence` 時生效。

| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `--min-tokens` | int | `10` | 軟性最小 token 數，用於合併過短的段落 |
| `--max-tokens` | int | `40` | 硬性最大 token 數，確保每段不超過此限制 |

### Token 計算規則
- 中文字符：1 token
- 英文單詞：1.5 tokens

### 分段演算法
1. 按標點符號分割
2. 若段落 > max_tokens，嘗試按子句分割
3. 若仍超過，按字符強制分割
4. 貪心合併相鄰段落（若合併後 <= max_tokens）
5. 處理過短的尾段（< min_tokens 則與前段合併）

## 平行請求與重試機制

| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `--max-parallel` | int | `1` | 最大平行請求數（預設為循序執行） |
| `--max-retries` | int | `3` | 失敗請求的最大重試次數 |
| `--retry-base-delay` | float | `1.0` | 指數退避的基礎延遲秒數 |

### 重試策略
- 使用指數退避（Exponential Backoff）避免過度請求
- 延遲計算：`base_delay * 2^(attempt-1)`
- 預設延遲序列：1s → 2s → 4s

### 平行執行說明
- 使用 `ThreadPoolExecutor` 實作平行請求
- 結果會按原始句子順序排列，確保音檔串接順序正確
- 設定 `--max-parallel 1` 等同於循序執行

## 使用範例

```bash
python3 main.py \
    --input-text "<您的輸入文本>" \
    --prompt-voice-path /path/to/your/audio/file.wav \
    --prompt-voice-text "<提示音檔的文字內容>" \
    --audio-basename "<音檔基礎名稱>" \
    --language nan \
    --output-dir output \
    --output-wav output.wav \
    --segment-mode sentence \
    --max-tokens 40 \
    --min-tokens 10 \
    --prompt-language nan \
    --add-end-silence \
    --prompt-start-silence 0.3 \
    --prompt-end-silence 0.3 \
    --crossfade-duration 0.05 \
    --crossfade-curve hsin \
    --max-parallel 5
```

## 工作流程

程式會按照以下步驟執行：

1. **文本預處理**：清理和標準化輸入文本
2. **句子分割**：根據 `--segment-mode` 設定將長文本切分成多個句子
3. **上傳提示音檔**：將提示音檔上傳至 TTS 服務（可選擇填充靜音）
4. **批次生成語音**：為每個句子生成對應的語音檔案
   - 每個句子會生成一個獨立的 WAV 檔案
   - 檔名格式：`{audio-basename}_{索引}.wav`
   - 如果檔案已存在，會自動跳過
5. **串接音檔**：使用 FFmpeg 將所有音檔串接成單一檔案

## 輸出說明

### 輸出目錄結構

```
output/
├── {audio-basename}_000.wav    # 第一句的語音
├── {audio-basename}_001.wav    # 第二句的語音
├── {audio-basename}_002.wav    # 第三句的語音
└── ...
output.wav                       # 最終串接的完整音檔
```

### 控制台輸出

程式執行時會顯示以下資訊：

- `[INFO]`：一般資訊
- `[STEP X]`：執行步驟
- `[GEN]`：正在生成語音
- `[OK]`：成功生成
- `[SKIP]`：跳過已存在的檔案
- `[RETRY]`：正在重試失敗的請求
- `[ERROR]`：生成失敗
- `[SUMMARY]`：生成摘要統計

## 注意事項

- **提示音檔要求**：
  - 提示音檔應該是清晰的語音錄音
  - 建議長度：3-10 秒
  - 格式：WAV 檔案
  - 提示音檔的聲音特徵會被用於生成目標語音

- **語言設定**：
  - 確保 `--language` 參數與您的輸入文本語言一致
  - 提示音檔的語言建議與目標語言相同

- **音檔管理**：
  - 程式會自動跳過已存在的音檔，如需重新生成請先刪除對應檔案
  - 使用 `run.sh` 腳本會先清除 `output` 目錄和 `output.wav`

- **錯誤處理**：
  - 如果某個句子生成失敗，程式會繼續處理其他句子
  - 最終只會串接成功生成的音檔
  - 查看控制台的 `[SUMMARY]` 部分了解成功/失敗的統計

- **分句模式選擇**：
  - `raw` 模式：不進行分段，直接使用原始文本
  - `sentence` 模式：按句號（。.？！?!）分段，並使用 token-based 演算法合併過短段落、分割過長段落
  - `clause` 模式：額外在逗號（，,、；;）處分段，適合需要更細緻控制的場景

- **語音品質調整**：
  - 若語音結尾有被截斷的情況，可使用 `--add-end-silence` 加入結尾靜音標記
  - 若提示音檔開頭或結尾太過突兀，可使用 `--prompt-start-silence` 和 `--prompt-end-silence` 填充靜音

- **交叉淡化設定**：
  - 預設啟用交叉淡化（0.05 秒），可有效消除音訊片段接合處的爆音和雜訊
  - 可用曲線類型：
    - `tri`：線性淡入淡出
    - `qsin`：四分之一正弦曲線
    - `hsin`：半正弦曲線（預設，聽感最自然）
    - `log`：對數曲線
    - `exp`：指數曲線
  - 建議時長範圍：0.03-0.1 秒，太短可能無法消除雜訊，太長可能導致音訊模糊

- **平行請求設定**：
  - 建議根據 API 服務的限制調整 `--max-parallel` 數值
  - 過高的平行數可能導致請求被限流或拒絕
  - 重試機制會自動處理暫時性的網路錯誤或服務不可用

- **SRT 字幕輸出**：
  - 使用 `--output-srt` 參數可同時生成 SRT 字幕檔案
  - 時間戳根據實際音訊長度自動計算，與音檔同步

## 相關檔案（Python CLI）

- `main.py`：主程式
- `client.py`：TTS API 客戶端
- `preprocessing.py`：文本預處理與分句模組
- `run.sh`：執行腳本範例

---

## Web UI（前端介面）

瀏覽器端的 TTS 語音合成工具，提供完整的語音生成、審核、匯出流程。所有音訊處理（串接、交叉淡化）皆在瀏覽器內完成，無需後端 FFmpeg。

### 功能總覽

- 拖放上傳 prompt voice，即時試聽
- 文字直接輸入或上傳 `.txt` 檔案（支援 Kaldi 格式）
- 分段預覽：生成前可預覽文字如何切分為 segments
- 平行語音生成，含自動重試（指數退避）
- 波形視覺化播放器，支援 segment 色彩標記、zoom、速度調整
- 逐句審核（Approve / Reject）+ Notes 筆記
- 單句下載 WAV 或批次匯出 ZIP（含 metadata.json）
- 鍵盤快捷鍵加速審核流程
- 音訊交叉淡化串接（FFmpeg.wasm，瀏覽器端）
- SRT 字幕自動生成

### 技術棧

| 類別 | 技術 | 版本 |
|------|------|------|
| Framework | React | 19 |
| Language | TypeScript | 5.x |
| Build | Vite | 7.3 |
| Styling | Tailwind CSS | 4.x |
| State | Zustand | 5.x |
| Routing | React Router DOM | 7.x |
| Audio | FFmpeg.wasm | 0.12 |
| Testing | Vitest | 3.x |

### 環境變數

在專案根目錄建立 `.env` 檔案：

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `VITE_ENV` | 環境（dev / stg2 / prod） | `dev` |
| `VITE_ZERO_SHOT_API_URL` | TTS API endpoint | `http://localhost:8000/api/v1/zero-shot` |
| `VITE_PRESIGN_URL` | S3 presign endpoint | - |
| `VITE_UPLOAD_URL` | Asset upload endpoint | - |
| `VITE_API_KEY` | API key（dev / stg2 環境） | - |
| `VITE_AUTH_KEY` | Auth key（prod 環境） | - |
| `VITE_AUTH_SECRET` | Auth secret（prod 環境） | - |
| `VITE_MODEL_ID` | 預設模型 ID（可由 UI 下拉選單覆蓋） | `MasterZhengyanKaishi` |


### 快速啟動

```bash
# 安裝依賴（postinstall 會自動複製 FFmpeg WASM 到 public/ffmpeg/）
npm install

# 開發伺服器（含 FFmpeg.wasm 所需的 CORS headers）
npm run dev
```

啟動後在瀏覽器輸入 `http://localhost:5173` 即可進入 UI 操作頁面。

> **首次使用者**：只需要 `npm install` 即可，postinstall script 會自動從 `node_modules/@ffmpeg/core` 複製 WASM 檔案到 `public/ffmpeg/`。無需手動操作。

### 使用流程

#### Step 1：Setup Page — 建立專案

1. **上傳 Prompt Voice**
   - 拖放或點擊上傳 WAV / MP3 音檔（建議 3-10 秒）
   - 可即時試聽已上傳的音檔
   - 選擇 Prompt 語言（國語 / 台語 / 英文）
   - 輸入 Prompt 音檔對應的文字內容

2. **輸入文字**（兩種模式）

   **直接輸入模式：**
   - 在文字框直接輸入或貼上文字
   - 即時顯示字數與估算 token 數
   - 適合單句或短文測試

   **上傳檔案模式：**
   - 拖放或選擇 `.txt` 檔案
   - 支援兩種格式：
     - **純文字格式**：每個非空行視為一個獨立句子
     - **Kaldi 格式**：每行 `utterance_id 文字內容`（系統自動偵測，>80% 行符合 `^\S+\s+.+` 即判定為 Kaldi 格式）
   - 上傳後顯示檔名、行數、檔案大小

3. **設定參數**
   - 目標語言：國語 / 台語 / 英文
   - 模型選擇
   - 分段模式：Raw（不分段）/ Sentence（句號分段）/ Clause（逗號分段）
   - Token 範圍：Min / Max Token 滑桿

4. **Preview Segments**（預覽分段）→ 確認分段結果後：
   - 點擊「**Create & Generate**」：新增專案並立即開始生成音檔
   - 點擊「**Create Only**」：僅新增專案，不自動生成

#### Step 2：Workspace Page — 生成與審核

1. **生成語音**
   - 「Regenerate All」一次重新生成所有句子
   - 或逐句使用「Regenerate Sentence」重新生成
   - 平行執行（可設定並行數），失敗自動重試

2. **波形播放器**
   - 色彩標記各 segment 區段
   - 支援 zoom（0.5x - 4x）、播放速度（0.5x - 2x）、音量控制
   - 點擊波形跳轉至指定位置

3. **Segment 編輯**
   - 點擊 segment 文字進入編輯模式
   - 修改後可單獨重新生成該 segment
   - 或「Regenerate Sentence」重新生成整句

4. **審核**
   - 每句可 Approve（通過）或 Reject（退回）
   - 下方 Notes 欄位可記錄觀察（發音問題、斷句不佳等）
   - 「Approve All」可批次通過所有已生成的句子

#### Step 3：匯出

- **單句下載**：Approve 後點擊 Download 按鈕，下載該句 WAV 音檔
- **批次匯出 ZIP**（兩種模式）：
  - **Audio + Metadata**（預設）：所有 Approved 句子的 WAV + `metadata.json`（含生成參數、審核狀態、Notes 等）
  - **Audio Only**：僅匯出 WAV 檔案，不含 metadata

### 鍵盤快捷鍵

在 Workspace 頁面中（不在文字輸入框時）：

| 按鍵 | 功能 |
|------|------|
| `Space` | 播放 / 暫停 |
| `[` | 上一個 segment |
| `]` | 下一個 segment |
| `↑` | 上一句 |
| `↓` | 下一句 |
| `A` | Approve 當前句子 |
| `R` | Reject 當前句子 |

### 進階設定

點擊齒輪圖示開啟設定面板：

| 區塊 | 設定項 |
|------|--------|
| 音訊生成 | 結尾靜音 token、平行 workers（1-20）、最大重試次數（0-10）、重試延遲（0.1-5s） |
| 靜音填充 | 開頭靜音（0-1s）、結尾靜音（0-1s） |
| 交叉淡化 | 時長（0-0.2s）、曲線類型（tri / qsin / hsin / log / exp） |
| SRT 字幕 | 啟用 / 停用 SRT 生成 |

### 問題回報流程

當遇到語音品質問題（發音錯誤、斷句不佳、語調異常等）時：

1. **在 Workspace 中標記問題**
   - 對有問題的句子點擊 Reject
   - 在句子下方的 Notes 欄位詳細描述問題（例如：「第 2 個 segment 發音不自然」「斷句位置不對」）

2. **匯出含 Metadata 的 ZIP**
   - 在 Sidebar 底部點擊「Download Approved」旁的下拉選單
   - 選擇「**Audio + Metadata**」模式匯出
   - ZIP 內的 `metadata.json` 包含：
     - 完整的生成參數（語言、模型、分段模式等）
     - 每句的 status（approved / rejected）
     - 每句的 Notes 內容
     - Segment 數量與音訊時長

3. **回報問題**
   - **請將整包 ZIP 傳回給我們**（包含音檔 + metadata.json）
   - metadata.json 中的參數快照讓我們可以完整重現您的生成情境
   - Notes 中的描述幫助我們定位具體問題

### Web UI 注意事項

- **資料持久化限制**：
  - 所有生成的音檔與專案資料僅存在瀏覽器記憶體中（Zustand store，無 persist）
  - **重新整理頁面後將全部消失**，包含所有專案、設定、已生成的音檔
  - 切換專案時，當前專案會暫存在記憶體中（同一 session 內可切換回來），但不會跨頁面重整保留
  - 重要的音檔請務必在重整前先下載匯出

- **Segment 重生限制**：
  - 同一時間只能重新生成一個 segment
  - 重生期間，其他 segment 的 Regen 按鈕及 Regenerate Sentence 按鈕將暫時禁用
  - 重生完成後自動恢復所有按鈕

### 前端專案結構

```
src/
├── main.tsx                 # 應用入口（BrowserRouter）
├── App.tsx                  # 路由定義
├── index.css                # 全域主題變數（Tailwind CSS）
│
├── pages/
│   ├── SetupPage.tsx        # 專案建立頁面
│   └── WorkspacePage.tsx    # 語音生成 & 審核工作區
│
├── components/
│   ├── TopNav.tsx           # 共用導航列
│   ├── setup/               # Setup 頁面元件
│   └── workspace/           # Workspace 頁面元件
│
├── hooks/
│   ├── useGeneration.ts     # TTS 生成調度
│   ├── useAudioPlayer.ts    # Web Audio API 播放控制
│   └── useKeyboardShortcuts.ts  # 鍵盤快捷鍵
│
├── services/
│   ├── tts-orchestrator.ts  # 完整 pipeline 串接
│   ├── tts-client.ts        # TTS API HTTP 客戶端
│   ├── batch-generator.ts   # 重試 + 平行執行
│   ├── ffmpeg-service.ts    # FFmpeg.wasm 音訊處理
│   └── auth.ts              # API 認證
│
├── stores/
│   └── project-store.ts     # Zustand 全域狀態
│
├── utils/
│   ├── preprocessing.ts     # 文字分段 & token 計算
│   ├── audio.ts             # WAV 解析
│   └── srt.ts               # SRT 字幕生成
│
└── config/
    └── index.ts             # 環境變數設定
```

詳細的前端文件請參考 `docs/frontend/` 目錄。
