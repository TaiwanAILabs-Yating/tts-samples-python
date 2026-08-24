# Segment 合併前後靜音濾除（silenceremove）— 規劃

> 日期：2026-08-24
> Branch: `feat/segment-silence-remove`
> 狀態：已 review 定案（見文末決議），實作中

## 需求

TTS 生成的 segment 音檔頭尾常帶有長短不一的靜音，acrossfade 合併後會出現
不自然的停頓。需求：合併時除了 acrossfade 之外，先對每個 segment 的
**前後靜音**做濾除（FFmpeg `silenceremove` filter）。

## 方案

### 核心：併入同一次 concat 的 filter_complex（零額外 FFmpeg pass）

在 `concatBatch()` 組 filter_complex 時，先對每個輸入接一段 `silenceremove`，
再進 acrossfade 串鏈：

```
[0]silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1:detection=rms,
   areverse,silenceremove=...(同上),areverse[s0];
[1]silenceremove=...,areverse,silenceremove=...,areverse[s1];
[s0][s1]acrossfade=d=0.05:c1=hsin:c2=hsin[a0];
[a0][s2]acrossfade=...
```

- 頭部：`start_periods=1` 跳過開頭靜音，`start_silence` 保留一小段
- 尾部：`areverse` + 頭部修剪 + `areverse`（反轉後修頭 = 修尾）
- **切勿使用正值 `stop_periods`**：其語意是「偵測到第一段靜音就停止複製」
  （`stop_duration` 預設 0），任何句中停頓都會讓後面整段被截斷 —
  v1 曾因此造成合併後 segment 消失，已修正並加測試防回歸
- `detection=rms`：對 TTS 底噪較穩定

**只套用在「原始 segment」層級**：
- N ≤ 50 的單次 concat：全部輸入套用
- N > 50 的階層合併：只有 Pass 1（原始 segments）套用；Pass 2 的輸入是
  已修剪過的中繼檔，再修剪會有吃掉小聲語音的風險，不套用

### 不採用的替代方案

生成完成後對每個 segment 音檔獨立跑一次 silenceremove（修剪後存回
store）。優點是單段試聽/下載也一致，缺點是每個 segment 多一次 FFmpeg
exec、且會改動 history 與 duration 顯示。目前需求明確是「合併時」，
先不做；若之後想要單段也修剪再升級。

## 設定

UI 只曝露開關；門檻與保留長度為程式常數，不進 ProjectConfig：

| 項目 | 形式 | 值 |
|------|------|-----|
| 啟用開關 | `ProjectConfig.trimSilence: boolean` | 預設 **ON**（舊專案缺欄位時以 `?? true` 視為 ON） |
| 靜音門檻 | 常數 `TRIM_SILENCE_THRESHOLD_DB` | -50 dB |
| 保留靜音長度 | 常數 `TRIM_SILENCE_KEEP_SEC` | 0.1 s（> crossfade 預設 0.05s，保證 acrossfade 有材料） |

三者皆記錄於匯出 ZIP 的 `metadata.json` → `config.advanced`。

## 套用範圍（三個 concat call site）

| Call site | 是否套用 | 理由 |
|-----------|----------|------|
| `recombineOutputs()`（生成後預覽、regen 後重新 concat、`concatOnly()` 下載） | ✅ | 主要需求 |
| SentenceSidebar 單句下載 concat | ✅ | 同上，輸入是 segments |
| SentenceSidebar `Concat all sentences`（全案合併） | ❌（已定案） | 輸入是 sentence 音檔，邊緣已修剪過；句與句之間的停頓要保留 |

## 實作工單

### 工單 1：filter 組字純函式 + 單元測試（TDD 起點）
- 從 `concatBatch()` 抽出 `buildConcatFilterComplex(n, opts)` 純函式
  - `opts: { crossfadeDuration, fadeCurve, trim?: { thresholdDb, keepSec } }`
  - 回傳 filter_complex 字串；`trim` 未給則行為與現狀完全相同
- 測試：2 輸入 / N 輸入、有無 trim、參數帶入正確性
- 涉及：`src/services/ffmpeg-service.ts`、`src/__tests__/ffmpeg-service.test.ts`

### 工單 2：concat pipeline 接線
- `concatWavsWithCrossfade()` 增加 options 參數（trim 設定）
- 直接路徑（N ≤ 50）與 Pass 1 傳入 trim；Pass 2 不傳
- **修剪一律套用在每個原始 segment，含只有一段的情況**（原規劃寫「單輸入
  不修剪」，但那會讓「1 段的句子不修剪、2 段的句子修剪」行為不一致，且
  `trimmedDuration` 與音檔對不上 → 改為一致套用；trim 關閉時單輸入仍直接
  回傳、不呼叫 FFmpeg）
- 涉及：`src/services/ffmpeg-service.ts`

### 工單 3：Config + UI（含 Drawer 三大區塊重組）
- `ProjectConfig` 新增三欄位 + `defaultConfig`
- `AdvancedSettingsDrawer` 重組為三大區塊（見 `tts_api.pen` 設計稿）：
  - **Service**：Max Parallel、Max Retries、Retry Base Delay
  - **Input — Prompt Voice**：Prompt Start / End Silence（padding 輸入 prompt 音檔）
  - **Output — Segment Audio**：Add End Silence Token + `CROSSFADE` 子區塊
    （Duration、Curve）+ `SILENCE REMOVAL` 子區塊（僅 toggle + 說明文字）
- 純 UI 重排，不改任何 config key 名稱與行為
- 涉及：`src/stores/project-store.ts`、`src/components/workspace/AdvancedSettingsDrawer.tsx`

### 工單 4：call site 接線 + 序列化
- `RegenerateConfig` / `GenerateAllConfig` / `useGeneration` / `SentenceSidebar`
  把 trim 設定傳進 concat
- `settings-io.ts` 匯出/匯入新欄位；`metadata.json` 的 `config.advanced` 補上
- 涉及：`src/services/tts-orchestrator.ts`、`src/hooks/useGeneration.ts`、
  `src/components/workspace/SentenceSidebar.tsx`、`src/utils/settings-io.ts`

### 工單 5：驗證
- `npm test`、`tsc`、`npm run build`
- Playwright：Advanced Settings 開關與數值持久化
- 實際音檔驗證（需 API 憑證環境）：合併前後長度差、接點聽感

## 風險與邊界

- **全靜音 segment**：silenceremove 後輸出可能只剩保留長度；若使用者把
  保留長度設 0，輸出可能為空 → acrossfade 失敗。UI 以 min 提示緩解；
  concat 失敗時錯誤會落在既有的 per-sentence error 處理
- **時長顯示分兩種語意，不要混用**：
  - **單一 segment 的長度**（segment card、單段下載）＝原始音檔長度 `duration`
  - **合併後音檔的時間軸**（WaveformPlayer、句子 duration badge、sidebar 清單、
    `metadata.json` 的 `sentences[].duration` 與 `segments[].start/end`）
    ＝`utils/segment-timeline.ts` 的 `computeMergedTimeline()`，會吃
    `trimmedDuration` 並扣除每個接點的 crossfade 重疊
  - `SegmentState.trimmedDuration` 是**純量測值**（產生音檔時就以 JS RMS 掃描
    估算），與 trimSilence 設定無關；要不要採用由讀取端依當前設定決定，
    因此切換設定不需重新生成，也不受 concat 走哪條路徑影響
  - JS 估算與 FFmpeg 實際輸出 parity 驗證一致（單段 2.500/2.600s；
    三段合併估 7.400s vs 實測 7.399s）
- ffmpeg.wasm core 0.12.6（FFmpeg 5.x）支援 `silenceremove` 的
  start/stop 參數組，無版本問題

## Review 決議（2026-08-24）

1. `trimSilence` 預設 **ON**
2. `Concat all sentences`（全案合併）**不修剪**
3. 門檻 / 保留長度 **不曝露 UI**，寫死 -50dB / 0.1s，但需記錄在
   `metadata.json`
