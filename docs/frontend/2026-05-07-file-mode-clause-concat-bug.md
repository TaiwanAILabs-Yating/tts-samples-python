# Bug：Upload File + Clause 模式生成後 Segments 被 concat

> 日期：2026-05-07
> Branch: `fix/upload-clause-segment-mismatch`（建議）

## 症狀

當 `TextInputCard` 切到 **Upload File** 模式 + Generation Mode 設為 **clause**：

- ✅ 點 **Preview Segments** 顯示正確：文本依 clause 分隔符（`，、；。`）切成多個短片段
- ❌ 點 **Generate** 之後，Workspace 的 `SegmentCards` 顯示的 segment 數量比 Preview 少、文字被 concat 在一起

Preview 與 Generate 應該對同一份輸入、同一份 config 產出相同的 segment 切分。

## 重現步驟

1. 切到 **Upload File** 分頁
2. 上傳 [data/daai/text/德行品第一（clause刪減）.txt](../../data/daai/text/德行品第一（clause刪減）.txt)
   - 單行 568 字、無換行（`with no line terminators`）
   - 內含大量 clause 分隔符
3. Generation Params → Mode 設為 **clause**
4. 點 **Preview Segments** → 多個 clause 片段 ✅
5. 建立專案 → 進入 Workspace（`autoGenerate` 觸發）
6. 觀察 `SegmentCards` → ❌ segments 變少、文字被 concat

---

## 為什麼 `tts-orchestrator` 會重切？

**核心原因：是從 Python CLI 移植過來的設計遺留，沒被同步到「前端已先切過」的新流程。**

[src/services/tts-orchestrator.ts:166-184](../../src/services/tts-orchestrator.ts#L166)：

```ts
/**
 * Full pipeline: text → segments → TTS → concat.
 * Equivalent to Python main.py:main() Steps 1-5.
 */
export async function generateAll(config, callbacks) {
  // Step 1: Preprocess text
  const cleanedText = preprocessText(config.text);
  // Step 2: Split into segments
  const texts = splitSentences(cleanedText, config.segmentMode ?? "sentence", ...);
  // Step 3: Pad prompt voice ...
  // Step 4: Upload prompt voice ...
  // Step 5: Generate audio ...
}
```

`generateAll` 的設計是「丟一段 raw text，吐出 audio」——對應 Python `main.py` 的 batch CLI 用法（用 `python main.py file.txt` 就跑完整條 pipeline）。

但 **Web UI 的流程已經把 splitting 抽到前端了**：

| 階段 | 程式 | 行為 |
|------|------|------|
| 預覽 | [SetupPage.tsx:85-92](../../src/pages/SetupPage.tsx#L85) | 對 `rawText.split("\n")` 的每一行呼叫 `splitSentences()` |
| 建立專案 | [SetupPage.tsx:94-115](../../src/pages/SetupPage.tsx#L94) | 同上，把切好的 segments 寫進 `sentence.pipeline.segments` |
| Workspace fallback | [WorkspacePage.tsx:98-129](../../src/pages/WorkspacePage.tsx#L98) | 若進到 workspace 但 `sentences.length === 0`（如 reload），再切一次 |
| 顯示 | [SegmentCards.tsx:120](../../src/components/workspace/SegmentCards.tsx#L120) | 直接讀 `sentence.pipeline.segments` |

前端已經有完整的 splitting → 預覽 → 編輯 → 顯示流程；但 `useGeneration` 仍呼叫 `generateAll(sentence.text)`，丟整段原文進去，讓 orchestrator **再切一次**。

只有一個 caller：[useGeneration.ts:94](../../src/hooks/useGeneration.ts#L94)。沒有任何呼叫端依賴 orchestrator 的 splitting 行為（Python 的 `batch_generate.py` 走的是 Python `main.split_sentences`，跟 TS orchestrator 無關）。

> 結論：**orchestrator 重切是「移植舊架構時沒有改、又沒人發現它跟前端切的結果可能不一致」**。它在語意上是冗餘的，能拿掉。

---

## 其他被同一根因影響的場景（之前沒列）

dual-splitting 不只造成這次的 clause concat 問題；它還埋了一些其他坑：

### 1. 使用者在 Workspace 編輯 segment 文字 → 點 Generate（不是 Regenerate）→ 編輯被吃掉

[SegmentCards.tsx:289-292](../../src/components/workspace/SegmentCards.tsx#L289) 的 `EditableText` 讓使用者點 segment 文字直接修改，store 透過 `updateSegmentText` 更新 `segment.text`。

但 `useGeneration.handleGenerateAll` 把 `sentence.text`（**整段未切的原文**）丟進 `generateAll`，orchestrator 重切後產出的 segments 直接覆蓋 `pipeline.segments` ([useGeneration.ts:117-121](../../src/hooks/useGeneration.ts#L117))。**使用者剛剛編輯過的 segment 文字就消失了。**

`regenerateSentence` / `regenerateSegment` 倒是用 `state.segments` 直接走 ([tts-orchestrator.ts:354](../../src/services/tts-orchestrator.ts#L354), [283](../../src/services/tts-orchestrator.ts#L283))，所以「Regenerate」這條路是安全的。但「初次 Generate」這條不是。

### 2. 使用者在建立專案後改 segmentMode / minTokens / maxTokens → 點 Generate

- SegmentCards 顯示的還是建立時用舊 config 切好的 segments
- Generate 時 orchestrator 用**現在的** config 重切 → 新舊 segments 數量／文字突然對不上
- 視覺上像「Generate 把 segments 全部換掉了」

[WorkspacePage.tsx:98-129](../../src/pages/WorkspacePage.tsx#L98) 那條 fallback useEffect 雖然 deps 有 `config.segmentMode`，但條件是 `sentences.length === 0`，所以不會重建已經存在的 sentences。

### 3. 載入 saved project 時的 config 落差

- 舊 project 用 sentence mode 建立、segments 已存（透過 `partialize` 寫到 localStorage）
- 切到該 project，config 也跟著載入
- 使用者改 mode 為 clause、按 Generate
- orchestrator 用 clause 重切、覆蓋 → 跟 SegmentCards 之前顯示的 sentence-mode segments 完全不同

### 4. Tailo 斷詞狀態被清掉

[SegmentCards.tsx:296-303](../../src/components/workspace/SegmentCards.tsx#L296) 開啟 Tailo 後，segment 上會掛 `wordSegmentation`（對應 chips 與選中的台羅拼音）。

使用者可能：先按 Tailo、調整 chips、再按 Generate。orchestrator 重切產生**新的** segments（不帶 wordSegmentation），覆蓋掉之前的 → Tailo 狀態與選擇全部丟失。

### 5. 多行 / 中英混合 / 含 `\d+→` 前綴的輸入

- [`preprocessText`](../../src/utils/preprocessing.ts#L22-L35) 把多行用 **空白** join：對單行檔影響有限，但對多行檔會把行界線模糊掉
- `preprocessText` 還會 strip `^\s*\d+→` 前綴：使用者貼 Read-tool 風格輸出（例如從 Claude Code 複製過來）時，preview 沒做這個 strip、generate 卻做了，兩條路徑切出來的字數不一樣
- [`splitSentences` 內部又有一層 `[一-鿿][\s]+[一-鿿]` 替換成 `\n`](../../src/utils/preprocessing.ts#L230)：對 Chinese-space-Chinese 有效，但對 Chinese-space-English（`hello`）就保留空白 → 切分結果可能跨行 merge

### 6. clause mode 沒被測試覆蓋

`src/__tests__/preprocessing.test.ts` 完全沒有 `SEGMENT_MODE_CLAUSE` 的 case；唯一相關的是 `ensureMaxTokens` 測試（line 67 附近），但它測的不是 `splitSentences(..., "clause", ...)` 的整體行為。clause mode 邏輯目前沒有 regression net。

---

## 關於這份反覆無法定位的觀察

光從靜態 trace（讀 code）來看，**對本次 reproduction 這個單行檔來說**，preview 與 generate 走 `splitSentences` 應該得到同一個結果（preprocessText 對單行 + 無 `\d+→` 前綴是 no-op；mode、minTokens、maxTokens 都從同一個 store 讀）。要真正定位「為什麼這次 generate 會 concat」，需要 runtime log：

1. 在 [tts-orchestrator.ts:172-182](../../src/services/tts-orchestrator.ts#L172) 加 log，印出：
   - `config.text.length`
   - `config.segmentMode`、`config.minTokens`、`config.maxTokens`
   - `cleanedText.length`（preprocessText 輸出）
   - `texts.length`、`texts.slice(0, 3)`（前三段切分結果）
2. 在 [SetupPage.tsx:90](../../src/pages/SetupPage.tsx#L90) 加同樣的 log
3. 比對兩份 log，看是哪個欄位不一致

最有可能的嫌疑：**`config.segmentMode` 在 generate 路徑變成 `undefined`**，於是 fallback 成 `"sentence"`，觸發 `balanceSegments` 把短 clause merge。但目前讀 code 沒看到合理的觸發點。

---

## 預計修復

### 方案 A（推薦）：移除 orchestrator 內部的 splitting，改吃 pre-split segments

**核心想法**：splitting 只在前端 SetupPage / WorkspacePage 一個地方做。orchestrator 的 input 改成「已經切好的 segment 文字陣列」，純粹負責呼叫 TTS API + concat audio。

| 檔案 | 修改 |
|------|------|
| [src/services/tts-orchestrator.ts](../../src/services/tts-orchestrator.ts) | `GenerateAllConfig` 移除 `text / segmentMode / minTokens / maxTokens`，改收 `segments: SegmentState[]`（或 `segmentTexts: string[]`）；移除 step 1 (`preprocessText`) 與 step 2 (`splitSentences` + `buildSegmentStates`)；直接拿傳入的 segments 跑 step 3-5 |
| [src/hooks/useGeneration.ts](../../src/hooks/useGeneration.ts) | `handleGenerateAll` 改傳 `sentence.pipeline.segments`（或 `.map(s => s.text)`）；不再傳 raw text |

**這個改法一次解決**：
- ✅ 本次 clause concat bug（單一 source of truth）
- ✅ 編輯 segment 文字後 Generate 不會被吃掉
- ✅ Tailo wordSegmentation 不會被覆蓋
- ✅ 改 segmentMode 後的行為一致（要重新切就在前端重新建 sentences，orchestrator 不參與）
- ✅ `preprocessText` 多行 join 副作用消失

**風險**：
- `GenerateAllConfig` 是 public-ish API，需要更新呼叫端與型別
- 既有測試 `src/__tests__/tts-orchestrator.test.ts` 要改
- `preprocessText` 變成只在前端 SetupPage / WorkspacePage 用（如果還需要）；可能可以一併簡化

### 方案 B（最小修改、不解決根因）

只把最容易 footgun 的兩處補強：

| 檔案 | 修改 |
|------|------|
| [tts-orchestrator.ts:53](../../src/services/tts-orchestrator.ts#L53) | `segmentMode?: SegmentMode` 改 required |
| [tts-orchestrator.ts:178](../../src/services/tts-orchestrator.ts#L178) | 移除 `?? "sentence"` fallback |
| [preprocessing.ts:34](../../src/utils/preprocessing.ts#L34) | `cleanedLines.join(" ")` 改成 `join("\n")` |

只能避免「fallback 預設成 sentence」與「多行 join 模糊行界」這兩個 footgun，**不解決**「編輯被吃掉」「Tailo 狀態被覆蓋」「config 變更後 segments 不一致」等其他衍生問題。

---

## Verification

修完後：

1. `npm run test`：擴充 [preprocessing.test.ts](../../src/__tests__/preprocessing.test.ts) 補上 clause mode 的 case（特別是「單行 + 多 clause delimiter」「多行混合中英」「`\d+→` 前綴」）
2. UI 手動：
   - 上傳 [data/daai/text/德行品第一（clause刪減）.txt](../../data/daai/text/德行品第一（clause刪減）.txt)、Mode = clause
   - Preview 與 Generate 後 SegmentCards 的 segment 數量、文字逐一比對 ✅
3. 編輯 segment 測試：
   - Generate 完成 → 編輯 segment 2 的文字 → 再點 Generate（or Regenerate）→ 編輯內容必須保留 ✅
4. config 變更測試：
   - 用 sentence 建專案 → 進 workspace → 改 mode 到 clause → SegmentCards 該如何反應？（需要決定 UX：自動重切還是要使用者重新建立專案？）
5. Tailo 測試：
   - 對某 segment 開 Tailo、選拼音 → 點 Generate → wordSegmentation 與選擇必須保留 ✅
