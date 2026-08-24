# Segment 合併前後靜音濾除（silenceremove）— 規劃

> 日期：2026-08-24
> Branch: `feat/segment-silence-remove`
> 狀態：規劃中，待 review 後實作

## 需求

TTS 生成的 segment 音檔頭尾常帶有長短不一的靜音，acrossfade 合併後會出現
不自然的停頓。需求：合併時除了 acrossfade 之外，先對每個 segment 的
**前後靜音**做濾除（FFmpeg `silenceremove` filter）。

## 方案

### 核心：併入同一次 concat 的 filter_complex（零額外 FFmpeg pass）

在 `concatBatch()` 組 filter_complex 時，先對每個輸入接一段 `silenceremove`，
再進 acrossfade 串鏈：

```
[0]silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1:
   stop_periods=1:stop_threshold=-50dB:stop_silence=0.1:detection=rms[s0];
[1]silenceremove=...[s1];
[s0][s1]acrossfade=d=0.05:c1=hsin:c2=hsin[a0];
[a0][s2]acrossfade=...
```

- `start_periods=1` / `stop_periods=1`：各修剪一次頭部 / 尾部靜音
- `start_silence` / `stop_silence`（= 保留靜音長度）：修剪後仍保留一小段，
  避免語音被切得太貼、也保證 acrossfade 有材料可疊
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

## 設定（Advanced Settings Drawer 新增「Silence Removal」區塊）

| 欄位 | ProjectConfig key | 預設 | 範圍 |
|------|-------------------|------|------|
| 啟用開關 | `trimSilence: boolean` | 待定（見開放問題 1） | — |
| 靜音門檻 | `trimSilenceThresholdDb: number` | -50 dB | -60 ～ -30 |
| 保留靜音長度 | `trimSilenceKeepSec: number` | 0.1 s | 0 ～ 0.3 |

保留長度 UI 提示：建議 ≥ crossfade duration（預設 0.05s），否則極端情況
（整段近乎靜音的 segment 被剪到比 crossfade 短）acrossfade 會失敗。

## 套用範圍（三個 concat call site）

| Call site | 是否套用 | 理由 |
|-----------|----------|------|
| `recombineOutputs()`（生成後預覽、regen 後重新 concat、`concatOnly()` 下載） | ✅ | 主要需求 |
| SentenceSidebar 單句下載 concat | ✅ | 同上，輸入是 segments |
| SentenceSidebar `Concat all sentences`（全案合併） | ❌（待定，見開放問題 2） | 輸入是 sentence 音檔，邊緣已修剪過；句與句之間的停頓通常要保留 |

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
- 單輸入 early-return（`length === 1`）維持不修剪（無 concat 即無套用）
- 涉及：`src/services/ffmpeg-service.ts`

### 工單 3：Config + UI
- `ProjectConfig` 新增三欄位 + `defaultConfig`
- `AdvancedSettingsDrawer` 新增 Silence Removal 區塊（toggle + 2 sliders）
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
- **時長顯示**：segment card 顯示的 duration 來自原始音檔，合併後總長會
  比 Σsegments 更短（本來 crossfade 就會重疊，此為既有行為的延伸）
- ffmpeg.wasm core 0.12.6（FFmpeg 5.x）支援 `silenceremove` 的
  start/stop 參數組，無版本問題

## 開放問題（待 review 決定）

1. `trimSilence` 預設要 ON 還是 OFF？
   - ON：新專案直接享受修剪；但改變既有專案 regen 後的合併行為
   - OFF：行為不變，需要的人自己開（建議：OFF，穩妥）
2. `Concat all sentences`（全案合併）要不要也修剪 sentence 邊界？
   （建議：不要，保留句間自然停頓）
3. 門檻與保留長度要不要曝露在 UI？還是先寫死 -50dB / 0.1s 只給開關？
   （建議：曝露，與現有 Crossfade 區塊的粒度一致）
