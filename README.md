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

## 相關檔案

- `main.py`：主程式
- `client.py`：TTS API 客戶端
- `preprocessing.py`：文本預處理與分句模組
- `run.sh`：執行腳本範例
