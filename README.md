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
| `--segment-mode` | string | 否 | 分句模式：`sentence`（句號分句，預設）或 `clause`（含逗號分句） |
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

## 使用範例

### 範例 1：生成台語語音

```bash
python3 main.py \
    --input-text "這是一段台語測試文本。今仔日天氣真好。" \
    --prompt-voice-path ./samples/voice.wav \
    --prompt-voice-text "我是一個提示音檔的範例內容。" \
    --audio-basename "taiwanese_test" \
    --language nan \
    --output-dir output \
    --output-wav output.wav
```

### 範例 2：生成國語語音

```bash
python3 main.py \
    --input-text "這是一段國語測試文本。今天天氣很好。" \
    --prompt-voice-path ./samples/voice.wav \
    --prompt-voice-text "我是一個提示音檔的範例內容。" \
    --audio-basename "mandarin_test" \
    --language zh \
    --output-dir output \
    --output-wav output.wav
```

### 範例 3：使用逗號分句模式

當文本包含較長的句子，希望在逗號處也進行分割時：

```bash
python3 main.py \
    --input-text "這是一段很長的句子，包含多個子句，需要在逗號處分割。" \
    --prompt-voice-path ./samples/voice.wav \
    --prompt-voice-text "我是一個提示音檔的範例內容。" \
    --audio-basename "clause_test" \
    --language zh \
    --segment-mode clause \
    --output-dir output \
    --output-wav output.wav
```

### 範例 4：使用進階選項

結合多種進階選項以改善語音品質：

```bash
python3 main.py \
    --input-text "這是一段測試文本。" \
    --prompt-voice-path ./samples/voice.wav \
    --prompt-voice-text "我是一個提示音檔的範例內容。" \
    --audio-basename "advanced_test" \
    --language nan \
    --prompt-language nan \
    --add-end-silence \
    --prompt-start-silence 0.3 \
    --prompt-end-silence 0.3 \
    --segment-mode clause \
    --output-dir output \
    --output-wav output.wav
```

此範例說明：
- `--prompt-language nan`：為提示文字加上台語標記
- `--add-end-silence`：防止語音提前結束
- `--prompt-start-silence 0.3`：在提示音檔開頭加入 0.3 秒靜音
- `--prompt-end-silence 0.3`：在提示音檔結尾加入 0.3 秒靜音

### 範例 5：使用交叉淡化減少音訊雜訊

當音訊片段接合處有明顯的爆音或不連續感時：

```bash
python3 main.py \
    --input-text "這是一段測試文本。包含多個句子。每句會獨立生成。" \
    --prompt-voice-path ./samples/voice.wav \
    --prompt-voice-text "我是一個提示音檔的範例內容。" \
    --audio-basename "crossfade_test" \
    --language zh \
    --crossfade-duration 0.05 \
    --crossfade-curve hsin \
    --output-dir output \
    --output-wav output.wav
```

此範例說明：
- `--crossfade-duration 0.05`：設定 50 毫秒的交叉淡化時長（建議範圍：0.03-0.1 秒）
- `--crossfade-curve hsin`：使用半正弦曲線進行淡入淡出，聽感較為自然
- 若要禁用交叉淡化，可設定 `--crossfade-duration 0`

### 使用 run.sh 腳本

您也可以編輯 `run.sh` 腳本來設定參數，然後執行：

```bash
bash run.sh
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
- `[ERROR]`：生成失敗
- `[SUMMARY]`：生成摘要統計

## 注意事項

1. **提示音檔要求**：
   - 提示音檔應該是清晰的語音錄音
   - 建議長度：3-10 秒
   - 格式：WAV 檔案
   - 提示音檔的聲音特徵會被用於生成目標語音

2. **語言設定**：
   - 確保 `--language` 參數與您的輸入文本語言一致
   - 提示音檔的語言建議與目標語言相同

3. **音檔管理**：
   - 程式會自動跳過已存在的音檔，如需重新生成請先刪除對應檔案
   - 使用 `run.sh` 腳本會先清除 `output` 目錄和 `output.wav`

4. **錯誤處理**：
   - 如果某個句子生成失敗，程式會繼續處理其他句子
   - 最終只會串接成功生成的音檔
   - 查看控制台的 `[SUMMARY]` 部分了解成功/失敗的統計

5. **分句模式選擇**：
   - `sentence` 模式：在句號（。.？！?!）處分句，適合一般文本
   - `clause` 模式：額外在逗號（，,、；;）處分句，適合長句或需要更細緻控制的場景

6. **語音品質調整**：
   - 若語音結尾有被截斷的情況，可使用 `--add-end-silence` 加入結尾靜音標記
   - 若提示音檔開頭或結尾太過突兀，可使用 `--prompt-start-silence` 和 `--prompt-end-silence` 填充靜音

7. **交叉淡化設定**：
   - 預設啟用交叉淡化（0.05 秒），可有效消除音訊片段接合處的爆音和雜訊
   - 可用曲線類型：
     - `tri`：線性淡入淡出
     - `qsin`：四分之一正弦曲線
     - `hsin`：半正弦曲線（預設，聽感最自然）
     - `log`：對數曲線
     - `exp`：指數曲線
   - 建議時長範圍：0.03-0.1 秒，太短可能無法消除雜訊，太長可能導致音訊模糊

## 相關檔案

- `main.py`：主程式
- `client.py`：TTS API 客戶端
- `preprocessing.py`：文本預處理與分句模組
- `run.sh`：執行腳本範例
