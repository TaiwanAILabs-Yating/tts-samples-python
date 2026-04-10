# tts-samples-python

AILabs 基於 zero-shot 語音合成的文字轉語音工具。提供 **Web UI 前端介面**（推薦）進行語音生成、審核與匯出，所有音訊處理皆在瀏覽器內完成。另保留 Python CLI 供批次腳本使用。

---

## Web UI（前端介面）

瀏覽器端的 TTS 語音合成工具，提供完整的語音生成、審核、匯出流程。

### 功能總覽

#### 語音生成
- 基於 prompt 音檔的 zero-shot 聲音 clone
- 平行語音生成，含自動重試（指數退避策略）
- 生成過程中可即時試聽已完成的 Segment，無須等待全案完成
- 支援多語言：國語、台語、英文

#### 波形播放器
- 波形視覺化顯示，segment 色彩標記
- 支援 zoom（0.5x - 4x）、播放速度（0.5x - 2x）、音量控制
- 點擊波形跳轉至指定位置

#### 下載與匯出
- Segment 獨立下載：每個片段可獨立下載 WAV，提升後製剪輯彈性
- 單句下載：Approve 後下載該句完整 WAV
- 批次匯出 ZIP：所有 Approved 句子的 WAV + `metadata.json`（含生成參數、審核狀態、Notes）
- SRT 字幕自動生成

#### 文字輸入
- 直接輸入或上傳 `.txt` 檔案，換行即分句（兩種模式行為一致）
- 分段預覽：生成前可預覽文字如何切分為 segments
- 字數驗證：單句上限 1,000 字、總數上限 200 句，超出時即時提示

#### 專案管理
- 本地自動存檔：設定參數（語言、模型、分段模式等）存 localStorage；Approved 句子的音檔存 IndexedDB，頁面重整後自動還原。未 Approve 的音檔不會持久化，重整後遺失
- 設定匯出/匯入：將全部設定（含 prompt 音檔，以 base64 嵌入）匯出為 JSON 檔案，可跨裝置、跨 session 攜帶與還原
- 多專案管理：可在不同專案間切換，各自獨立的設定與生成結果

#### 審核流程
- 逐句 Approve / Reject + Notes 筆記
- 生成進行中自動鎖定重新生成與審核操作，避免衝突
- 鍵盤快捷鍵加速審核

#### 台語斷詞與台羅拼音
- 自動斷詞：逆向最長詞匹配（backward maximum match）搭配 ~40 萬詞台語詞典
- 英文/拉丁字母（含帶聲調台羅拼音、數字）保持完整 word 單位，不會被逐字切斷
- 台羅標注：每個詞顯示標準台羅拼音（Tâi-lô，含變音符號），支援多音字候選
- 拼音替換：點擊詞可切換為台羅拼音，重新生成時 TTS API 會收到替換後的文字
- 自訂斷句：底部輸入框可手動調整斷詞結果（空格分隔）

#### 音訊處理
- 交叉淡化串接（FFmpeg.wasm，瀏覽器端），消除接合處的爆音/雜訊
- 支援多種淡化曲線：tri / qsin / hsin / log / exp
- 可調整開頭/結尾靜音填充

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

2. **輸入文字**（兩種模式，行為一致：換行即分句）

   **直接輸入模式：**
   - 在文字框直接輸入或貼上文字，每行視為一句
   - 即時顯示字數與估算 token 數
   - 超過 1,000 字/句或 200 句時會顯示警告

   **上傳檔案模式：**
   - 拖放或選擇 `.txt` 檔案
   - 每個非空行視為一個獨立句子
   - 上傳後顯示檔名、行數、檔案大小

3. **設定參數**
   - 目標語言：國語 / 台語 / 英文
   - 模型選擇
   - 分段模式：Raw（不分段）/ Sentence（句號分段）/ Clause（逗號分段）
   - Token 範圍：Min / Max Token 滑桿

4. **匯出/匯入設定**
   - 「Export Settings」：將當前所有設定（含 prompt 音檔）匯出為 JSON 檔案
   - 「Import Settings」：從 JSON 檔案還原設定，匯入前會確認覆蓋

5. **Preview Segments**（預覽分段）→ 確認分段結果後：
   - 點擊「**Create & Generate**」：新增專案並立即開始生成音檔
   - 點擊「**Create Only**」：僅新增專案，不自動生成

#### Step 2：Workspace Page — 生成與審核

1. **生成語音**
   - 「Regenerate All」一次重新生成所有句子
   - 或逐句使用「Regenerate Sentence」重新生成
   - 平行執行（可設定並行數），失敗自動重試
   - 生成進行中，重新生成與審核按鈕自動鎖定

2. **波形播放器**
   - 色彩標記各 segment 區段
   - 支援 zoom（0.5x - 4x）、播放速度（0.5x - 2x）、音量控制
   - 點擊波形跳轉至指定位置

3. **Segment 操作**
   - 即時試聽：點擊 play 按鈕試聽單一 segment（生成完成即可聽）
   - 獨立下載：點擊 download 按鈕下載單一 segment 的 WAV
   - 文字編輯：點擊 segment 文字進入編輯模式
   - 單獨重生：修改後可單獨重新生成該 segment

4. **審核**
   - 每句可 Approve（通過）或 Reject（退回）
   - 下方 Notes 欄位可記錄觀察（發音問題、斷句不佳等）
   - 「Approve All」可批次通過所有已生成的句子

#### Step 3：匯出

- **Segment 下載**：點擊各 segment 旁的下載按鈕，取得單一片段 WAV
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

### 台語詞典預處理

如需更新詞典，執行以下指令重新產生 `public/lexicon-nan.json`：

```bash
npx tsx scripts/preprocess-lexicon.ts /path/to/lexicon.txt
```

輸入格式為 Kaldi decode lexicon（TSV：`詞\tIPA音標`），腳本會自動篩選台語條目並轉換為台羅拼音。

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

- **資料持久化**：
  - 設定參數（語言、模型、分段模式等）自動存入 localStorage，頁面重整後自動還原
  - Prompt 音檔存入 IndexedDB，頁面重整後自動還原
  - **只有 Approved 的句子**，其音檔會存入 IndexedDB 並在重整後保留
  - 未 Approve 的生成音檔僅存在記憶體中，頁面重整後遺失
  - 重要的音檔請在重整前先 Approve 或下載匯出
  - 可使用「Export Settings」將設定匯出為 JSON 檔案，跨裝置攜帶

- **Segment 重生限制**：
  - 同一時間只能重新生成一個 segment
  - 重生期間，其他 segment 的 Regen 按鈕及 Regenerate Sentence 按鈕將暫時禁用
  - 整批生成進行中，所有重新生成與審核操作將被鎖定
  - 完成後自動恢復所有按鈕

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
│   ├── useHydration.ts      # IndexedDB 資料還原（App 啟動時）
│   ├── useLexicon.ts        # 台語詞典自動載入 hook
│   └── useKeyboardShortcuts.ts  # 鍵盤快捷鍵
│
├── services/
│   ├── tts-orchestrator.ts  # 完整 pipeline 串接
│   ├── tts-client.ts        # TTS API HTTP 客戶端
│   ├── batch-generator.ts   # 重試 + 平行執行
│   ├── ffmpeg-service.ts    # FFmpeg.wasm 音訊處理
│   ├── lexicon-service.ts   # 台語詞典服務（斷詞、台羅、驗證）
│   └── auth.ts              # API 認證
│
├── stores/
│   ├── project-store.ts     # Zustand 全域狀態（含 persist）
│   ├── audio-storage.ts     # IndexedDB 音檔存取
│   └── lexicon-store.ts     # 台語詞典 store（延遲載入）
│
├── utils/
│   ├── preprocessing.ts     # 文字分段 & token 計算
│   ├── settings-io.ts       # 設定匯出/匯入（JSON + base64）
│   ├── ipa-to-tailo.ts      # IPA 音標 → 台羅拼音轉換
│   ├── audio.ts             # WAV 解析
│   └── srt.ts               # SRT 字幕生成
│
└── config/
    └── index.ts             # 環境變數設定
```

詳細的前端文件請參考 `docs/frontend/` 目錄。

---

## Python CLI（不推薦）

> ⚠️ **建議使用 Web UI**。Python CLI 為早期開發工具，功能較有限且不再積極維護。

### 系統需求

- Python 3.x
- FFmpeg（用於音檔串接）

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg
```

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
| `--prompt-language` | string | 否 | 提示音檔的語言標記 |
| `--segment-mode` | string | 否 | 分段模式：`raw` / `sentence`（預設）/ `clause` |
| `--add-end-silence` | flag | 否 | 在每句結尾加入靜音標記 |
| `--prompt-start-silence` | float | 否 | 提示音檔開頭靜音秒數（預設：0.0） |
| `--prompt-end-silence` | float | 否 | 提示音檔結尾靜音秒數（預設：0.0） |
| `--crossfade-duration` | float | 否 | 交叉淡化時長（預設：0.05） |
| `--crossfade-curve` | string | 否 | 淡化曲線：`tri` / `qsin` / `hsin`（預設）/ `log` / `exp` |
| `--min-tokens` | int | 否 | 最小 token 數（預設：10） |
| `--max-tokens` | int | 否 | 最大 token 數（預設：40） |
| `--max-parallel` | int | 否 | 最大平行請求數（預設：1） |
| `--max-retries` | int | 否 | 最大重試次數（預設：3） |
| `--retry-base-delay` | float | 否 | 重試基礎延遲（預設：1.0） |
| `--output-srt` | string | 否 | 輸出 SRT 字幕檔案路徑 |

### 完整範例

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

### 相關檔案

- `main.py`：主程式
- `client.py`：TTS API 客戶端
- `preprocessing.py`：文本預處理與分句模組
- `run.sh`：執行腳本範例
