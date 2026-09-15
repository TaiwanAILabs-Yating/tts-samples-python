# ffmpeg.wasm 執行約 148 次後崩潰（實例回收修正）

> 日期：2026-09-15
> Branch: `fix/ffmpeg-exec-limit`

## 問題

同一個 ffmpeg.wasm 實例執行 `exec()` 約 148 次後，第 149 次會丟出
`RuntimeError: memory access out of bounds`，之後該實例的每一次呼叫都失敗。

瀏覽器實測（headless Chromium）：

| 條件 | 崩潰點 |
|------|--------|
| 單一輸入 / 3 個 / 14 個輸入 | 第 149 次 |
| 7s 音檔 / 0.2s 音檔 | 第 149 次 |
| `areverse+afade` / 純 `anull` | 第 149 次 |
| `@ffmpeg/core` 0.12.6（目前）/ 0.12.10（最新） | 第 149 次 |
| 透過 App 的 `ffmpeg-service` 呼叫 | 第 147 次 |

與輸入大小、數量、filter、版本皆無關。terminate 後重新載入（約 65ms）即恢復。

App 整個 session 共用單一實例，原本只有在 >50 輸入的階層合併後才重建。
「Regenerate All」每句消耗 2 次（prompt 補靜音 + 自動合併），Upload 模式一次生成
約 74 句以上就會開始合併失敗；重新生成、下載也會持續累積。

## 修法（`src/services/ffmpeg-service.ts`）

- 所有 exec 經 `execCounted()` 計數；`MAX_EXECS_PER_INSTANCE = 100`（保留安全餘裕）
- 新增 `withFFmpeg(label, op)` 包住整個操作（寫入輸入 → exec → 讀出）：
  - 達到上限且**沒有其他操作進行中**時，先重建實例再執行（不會把進行中的操作的實例抽走）
  - 若仍崩潰（錯誤訊息符合 wasm crash），重建實例並**整個操作重試一次**（新實例檔案系統是空的，輸入會重新寫入）
  - 其他錯誤（逾時、參數錯誤等）照舊直接拋出，不重試
- `discardInstance()` 只在該實例仍是目前實例時才 terminate，避免誤殺已替換的新實例
- `padAudioWithSilence` 與 `concatBatch` 改走 `withFFmpeg`

## 驗證

- 單元測試 8 個：到達上限才重建、各類操作都計數、崩潰重試一次、只重試一次、一般錯誤不重試、進行中不重建
- 瀏覽器實測（真實 ffmpeg.wasm，經 App 模組）：400 次混合呼叫（單段修剪 / 兩段合併 / prompt 補靜音）
  **全部成功**，於第 100、200、300 次自動重建，最慢單次 145ms（含重建）
