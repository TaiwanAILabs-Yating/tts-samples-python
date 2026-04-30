# Direct Input 長文本資源 / Timeout 評估（5 萬字情境）

> 日期：2026-04-24
> Branch: `fix/direct-input-single-audio`
> 相關文件：[2026-04-23-direct-input-single-audio.md](./2026-04-23-direct-input-single-audio.md)

## 1. 背景

- 使用者確認 Direct Input **一定要支援 5 萬字**。
- 10 萬字實測已觀察到 concat 階段卡住：
  ```
  [orchestrator] Concatenating 1517 segments...
  [ffmpeg] Concatenating 1517 segments (crossfade=0.05s, curve=hsin)
  ```
- 本文件為**事前評估**，釐清在不改 concat 架構時 5 萬字會撞到哪些牆、需要哪些 mitigation。
- 不改程式碼，只記錄結論與改動建議。

## 2. 實測基準（Empirical Baseline）

10 萬字實測：

| 項目 | 值 |
|------|-----|
| 輸入字數 | 100,000 |
| 實際 segments | 1,517 |
| 總音長 | ~20,000 秒（約 5h 33min） |
| 切分比例 | 0.01517 segments/char |

TTS 輸出 WAV（用 `ffprobe` 實測 `outputs/*.wav`）：

| 欄位 | 值 |
|------|-----|
| Codec | `pcm_s16le` |
| Sample rate | 24,000 Hz |
| Channels | 1 (mono) |
| Bits per sample | 16 |
| **Bitrate** | **48,000 bytes/sec = 48 KB/s** |

Pipeline 預設（`src/stores/project-store.ts:134-140`）：

| 參數 | 值 |
|------|-----|
| `concurrency` | 5 |
| `maxRetries` | 3 |
| `crossfadeDuration` | 0.05s |
| `fadeCurve` | hsin |
| `startSilence` / `endSilence` | 0.3s（僅 prompt voice padding，不影響 segment 音長） |

Timeout 常數：

| 常數 | 值 | 位置 |
|------|-----|------|
| `LOAD_TIMEOUT_MS` | 60,000 ms | `src/services/ffmpeg-service.ts:11` |
| `EXEC_TIMEOUT_MS` | **30,000 ms** | `src/services/ffmpeg-service.ts:12` |
| fetch timeout | 無 `AbortController`，依瀏覽器預設 | `src/services/tts-client.ts:72` |

## 3. 5 萬字場景推估（線性外推）

| 項目 | 10w 實測 | **5w 推估** |
|------|---------|-----------|
| Segments | 1,517 | **~758** |
| 總音長 | ~20,000s (~5h 33min) | **~10,000s (~2h 47min)** |
| 總音檔資料量 | ~938 MB | **~469 MB** |
| 平均 segment 大小 | ~632 KB | ~618 KB |

## 4. Memory 消耗分析

### Stage 1：Generation 結束、進入 concat 前

| 區塊 | 量 |
|------|-----|
| JS heap（758 個 `segment.audio`） | ~469 MB |
| React tree / Zustand state overhead | ~50-100 MB |
| **小計** | **~520-570 MB** |

### Stage 2：`concatWavsWithCrossfade` 寫入 MEMFS 完成

`src/services/ffmpeg-service.ts:188` 的 `audioBuffers[i].slice(0)` 會完整複製一份進 WASM MEMFS：

| 區塊 | 量 |
|------|-----|
| JS heap（segment.audio 還沒釋放） | ~469 MB |
| WASM linear memory（MEMFS 758 份複製） | ~469 MB |
| **小計** | **~940 MB** |

### Stage 3：`ffmpeg.exec` 執行中（理論峰值）

757 個串聯 `acrossfade` node、處理 ~2h47 音訊：

| 區塊 | 低估 | 高估 |
|------|------|------|
| JS heap | 469 MB | 469 MB |
| WASM MEMFS inputs | 469 MB | 469 MB |
| WASM filter graph 暫存 | 200 MB | 1 GB |
| WASM output 累積 | → 469 MB | → 469 MB |
| **總峰值** | **~1.6 GB** | **~2.4 GB** |

### Stage 4：`readFile` 完成後（`finally` 清空前短暫峰值）

| 區塊 | 量 |
|------|-----|
| JS heap（segments + 新的 concatenated ArrayBuffer） | ~940 MB |
| WASM（尚未清空） | ~940 MB |
| **峰值** | **~1.9 GB** |

### 詳細時間軸（5w 字 + concurrency 5）

上面 Stage 1-4 是濃縮峰值。下方走查實際時間軸與每段音檔在 memory 的位置變化。

#### Phase 1：生成階段（758 個 fetch 跑完）

**起點（剛點下「Create & Generate」）**：JS heap ~100 MB（基本盤 React + Zustand + voice prompt）；`splitSentences` 切出 758 個 `SegmentState` shell（只有 text、status，**沒 audio**）≈ 1 MB。

**並行 5 個 fetch 開跑**：`generateBatch` 開 5 個 worker 從 task queue 拿 segment 執行 `sendZeroShotRequest`。任何瞬間最多 5 個 in-flight fetch，每個短暫多一份 ResponseBody buffer + 解出的 ArrayBuffer，~1.2 MB × 5 ≈ **6 MB transient**。

**第 1 個 segment 回來**（`src/services/tts-orchestrator.ts:243-246`）：

`segment.audio = result.data` 把 ArrayBuffer (632 KB) 接到 orchestrator 本地 `segments[]` 第 0 個 element 的 `.audio` 欄位。接著 `callbacks?.onSegmentUpdate?.(0, {...segment})` 把 segment 物件 spread 後送進 Zustand store；shallow copy 後 segment 物件雖有兩個（orchestrator 與 store 各一），但 `audio` 是 ArrayBuffer **物件**，兩邊指向**同一塊 memory** → JS heap **只多 632 KB**（不是 1.26 MB）。

**第 100 段回來**：

| 區塊 | 量 |
|------|-----|
| 基本盤 | ~100 MB |
| 100 × 632 KB audio | ~63 MB |
| 5 in-flight transient | ~6 MB |
| **小計** | **~169 MB** |

**第 758 段回來（生成完）**：

| 區塊 | 量 |
|------|-----|
| 基本盤 | ~100 MB |
| 758 × 632 KB audio | ~469 MB |
| in-flight | 0（全部結束） |
| **小計** | **~569 MB** |

進入 concat 前：JS heap ~570 MB、WASM 0。

#### Phase 2：Concat 階段改前詳細走查

**Stage A：寫入 FFmpeg WASM MEMFS**（`src/services/ffmpeg-service.ts:182-190`）

758 次迴圈，每次：(1) `audioBuffers[i].slice(0)` 在 JS heap **暫生 632 KB 副本**；(2) `new Uint8Array(...)` 包成 view（不複製）；(3) `ffmpeg.writeFile` 透過 postMessage 進 Worker，寫入 WASM linear memory MEMFS。slice 副本下一輪 GC 可清，時機不定。

**寫到第 100 圈**：JS heap ~571 MB（含 1-3 個待 GC 副本），WASM MEMFS ~63 MB，系統 ~634 MB。

**寫完 758 圈**：JS heap ~570 MB，WASM MEMFS ~469 MB（**完整再一份**），**系統 ~1.04 GB**（資料同時存在 JS heap + WASM 兩處）。

**Stage B：建 filter_complex 字串**：757 段 × ~50 字元 ≈ 38 KB，可忽略。

**Stage C：`ffmpeg.exec` 開跑（峰值來源）**

Worker 內 decode 758 個 WAV → AVFrame；757 個 acrossfade node 串聯運作，每個 node 短暫 buffer 上一段尾 + 下一段頭；output 從 0 累積到 469 MB。

| 區塊 | 量 |
|------|-----|
| JS heap（不變） | ~570 MB |
| WASM MEMFS inputs | ~469 MB |
| WASM filter graph 中間 buffer | 200 MB - 1 GB |
| WASM output 累積中 | → ~469 MB |
| **系統峰值** | **~1.7 - 2.5 GB** |

⚠️ 這個 exec 預估 40-80 分鐘 → **30s timeout 直接踩，根本進不到 Stage D**。

**Stage D / E（理論上）**：若沒踩 timeout，readFile 把 469 MB 拉進 JS → 短暫 ~1.9 GB peak；finally cleanupFiles 釋放 WASM，JS heap 維持 ~1.04 GB。

## 5. Timeout / 資源上限踩點表

| 限制 | 值 | 5w 字情境 | 會不會踩 |
|------|-----|----------|---------|
| **`EXEC_TIMEOUT_MS`** | 30 秒 | 757-node cascade 處理 2h47 音訊；WASM 估 2-4× realtime → **40-80 分鐘** | **100% 會踩，差兩個數量級** |
| `LOAD_TIMEOUT_MS` | 60 秒 | 僅影響首次 WASM 載入 | 否 |
| WASM32 linear memory | 4 GB 硬頂 | 峰值 ~1.6-2.4 GB | 不直接爆，**但餘裕僅 1-2 倍，風險邊緣** |
| V8 `ArrayBuffer.byteLength` | ~2 GB (`2^31 − 2`) | 最大單一輸出 ~469 MB | 安全 |
| Chrome tab total memory | ~4 GB（平台異） | ~1.9 GB | 桌機安全、Safari iOS 吃緊 |
| fetch 瀏覽器預設 | Chrome ~300s / FF 90s | 單次 TTS 請求 | 正常不會；server 慢時無法早退 |
| TTS 生成總時間（非硬限制） | — | 758 seg / concurrency 5 × ~10s/seg ≈ **25-60 分鐘** | 不會錯誤，但 UX 差 |
| `acrossfade` cascade 穩定性 | 幾百 node 以上已知風險區 | 757 node | 未定義行為機率高 |

## 6. 結論

**不改 concat 策略時，5w 字必然失敗**。核心三個理由：

1. `EXEC_TIMEOUT_MS = 30s` 差兩個數量級，不是微調可解
2. WASM 4 GB 餘裕不夠，edge case 會爆
3. 即使硬撐成功，使用者要等 > 1 小時，體感同故障

## 7. 建議 Mitigation（按成本低→高）

### 必做（否則 5w 字不可行）

| # | 項目 | 改動位置 | 預估改動量 |
|---|------|---------|----------|
| 1 | 階層式分批 concat（K=50 一批、兩層合併） | `src/services/ffmpeg-service.ts` `concatWavsWithCrossfade` | ~50 行 |
| 2 | Concat 進度回報 callback | `src/services/tts-orchestrator.ts` `recombineOutputs` | <20 行 |

### 強烈建議

| # | 項目 | 改動位置 | 預估改動量 |
|---|------|---------|----------|
| 3 | `EXEC_TIMEOUT_MS` 改為動態預估（依 K 計算） | `src/services/ffmpeg-service.ts` | ~10 行 |
| 4 | TTS fetch 加 `AbortController`（60-90s/段，交給 retry） | `src/services/tts-client.ts` | ~10 行 |
| 5 | Direct Input 上限下修為 50,000 字 | `src/pages/SetupPage.tsx` + `src/components/setup/TextInputCard.tsx`；規格文件同步 | ~5 行 |

### 長期可選

- 改用 FFmpeg `concat` demuxer + 段邊界 fade（速度可快 5-10×）
- 搬 Web Worker / `@ffmpeg/ffmpeg` mt 版（需 COOP/COEP headers）
- 後端合併端點（前端只做逐段生成，合併交給後端）

## 8. 改後 Memory 詳細走查（套用 Mitigation #1 + #3）

### 8.1 Pass 1 / Pass 2 白話定義

- **Pass 1**：把 758 段每 50 段先黏成 1 個小中段 → 共做 16 次，得到 **16 個中段**
- **Pass 2**：把 **16 個中段再黏成最終的 1 個完整音檔**

（為什麼分兩層：FFmpeg 一次塞 758 段會超時 / 爆掉；分成 50 段一批就能秒做完。）

### 8.2 Pass 1 走查（16 批，每批 50 段）

**Batch 1（segments 0-49）**：

寫入 50 圈 `writeFile`：WASM MEMFS 50 × 632 KB ≈ **31 MB**；JS heap 維持 ~569 MB（segment.audio 還在）。

Exec（49-node acrossfade，處理 ~11 分鐘音訊）：WASM peak ~150 MB；exec 預估 3-5 秒（**遠低於 30s timeout**）。

readFile + finally cleanup：中段 ArrayBuffer ~31 MB 進 JS heap；WASM 釋放。

**Batch 1 結束狀態**：JS heap 569 + 31 = **~600 MB**，WASM 0。

**Batch 2 ~ Batch 16** 同模式，每批多 1 個 ~31 MB 中段 buffer。

**Batch 16 結束**：

| 區塊 | 量 |
|------|-----|
| 基本盤 + 758 segment.audio | ~570 MB |
| 16 個中段 buffer | 16 × 31 = 496 MB |
| **小計** | **~1.06 GB** |
| WASM | 0 |

Pass 1 期間任一瞬間最大值：~570 + 15 × 31 + WASM 150 = **~1.18 GB**。

### 8.3 Pass 2 走查（16 個中段最終合併）

寫入 16 個中段：WASM MEMFS ~496 MB；JS heap ~1.06 GB。

Exec（15-node acrossfade，處理 ~2h47 音訊）：WASM peak ~1.0 GB；exec 預估 1-3 分鐘 → **30s timeout 仍會踩**，需 Mitigation #3 動態 timeout 配合。

readFile + finally：

| 區塊 | 量 |
|------|-----|
| JS heap（segments + 中段 + 最終 output） | 570 + 496 + 469 = ~1.54 GB |
| WASM（input + output 尚未清空） | ~960 MB |
| **系統短暫峰值** | **~2.5 GB** |

finally cleanupFiles 後：JS heap ~1.54 GB（segments + 中段都還在）、WASM 0。

### 8.4 改前 vs 改後 系統 Memory 對照

| 時間點 | 改前 | 改後 (#1 #2 #3 #4) | 差異 |
|--------|------|------------------|------|
| 生成完成 | ~570 MB | ~570 MB | 一樣 |
| Concat 寫入完 | ~1.04 GB（一次寫滿） | ~600 MB（每批寫 31 MB） | **改後降 42%** |
| **Concat exec 峰值** | **1.7 - 2.5 GB**（單次撐爆） | **Pass 1: ~720 MB / Pass 2: ~2.0 GB** | Pass 1 **降 65%**、Pass 2 持平 |
| readFile 短暫峰值 | ~1.9 GB（其實 timeout 走不到） | ~2.5 GB | 改後反而高一點 |
| Stable 後 | ~1.04 GB | ~1.54 GB | 改後高 50%（多了中段 buffer） |

### 8.5 解讀

**好消息**：

- Pass 1 每批 exec ~150 MB WASM、3-5 秒跑完 → **完全不撞 timeout / 不 OOM**
- 16 批裡任一批失敗，只重跑該批，不是整個 5w 字重來

**不太好的消息**：

- 改後 Pass 2 + readFile 短暫峰值（~2.5 GB）**沒比改前低很多**
- 因「中段 buffer」累積，stable state 從 1.04 GB 升到 1.54 GB

**關鍵**：改前 1.7-2.5 GB 是「**會撞 timeout / OOM 直接死**」的峰值；改後 2.5 GB 是「**真的能跑完**」的瞬時峰值。risk 性質完全不同。

### 8.6 進階優化（評估後決定不採用）

若 Pass 1 每批結束後執行：

```ts
for (const seg of batchSegments) {
  seg.audio = undefined;
}
```

可把 Pass 2 readFile 短暫峰值從 2.5 GB 降到 ~1.4 GB、stable state 從 1.54 GB 降到 ~970 MB。

代價：使用者**不能在 Workspace 重看 / 重播 / 重生成單段音檔**（segment.audio 沒了）。已 approved 的可從 IndexedDB 復原；未 approved 的就無資料。

**目前決定不採用**，保留單段音檔可操作性優先。若實作後驗證 5w 字仍 OOM，可再考量「approved 的釋放、未 approved 的保留」折衷策略。

## 9. 關鍵檔案速查

| 檔案 | 用途 |
|------|------|
| `src/services/ffmpeg-service.ts` | `concatWavsWithCrossfade`、timeout 常數 |
| `src/services/tts-orchestrator.ts` | `recombineOutputs`、進度 callback |
| `src/services/tts-client.ts` | `fetch` 無 timeout |
| `src/pages/SetupPage.tsx` | `sentenceLengthValidation` 的 `directCap` |
| `src/components/setup/TextInputCard.tsx` | UI 錯誤文案與 `directCap` |
| [2026-04-23-direct-input-single-audio.md](./2026-04-23-direct-input-single-audio.md) | 規格文件（長度上限需同步下修） |

## 10. 備註

- 本文件只是**評估**，不代表立即開工；實作排程由 PM / 工程決定。
- 與 `2026-04-23-direct-input-single-audio.md` 的關係：該規格訂為「整段一音檔、200k 字上限」，本評估指出 200k 不可行；實作 mitigation 時要連同**下修上限至 50k**。
- 數字為線性外推，實際視 segment 切分規則與 TTS 伺服端速度可能有 ±30% 誤差。

## 11. Verification（後續實作 mitigation 時驗收）

1. **5w 字 E2E**：輸入 5 萬字、跑完 generate → concat → approved 整流程，確認不踩 timeout、不 OOM
2. **Task Manager 監測**：Chrome `Shift+Esc` 觀察 tab memory peak，應 < 1.5 GB
3. **Console 乾淨**：無 `FFmpeg concat timed out after ...`、無 `RuntimeError: memory access out of bounds`
4. **進度可見**：concat 階段有段 progress update（非黑箱等待）
5. **邊界測試**：49,999 / 50,000 / 50,001 字（超過要擋下）
6. **低階裝置**：8 GB RAM 筆電或中階手機（Safari iOS 最嚴苛）
7. **退化測試**：1,000 / 10,000 字短文本仍正常、沒被分批邏輯拖慢

---

## 12. Phase 2 實作完成（2026-04-30）— Render Storm 修復

### 12.1 真因
按 Phase 1 mitigation 改完之後實測 1485 segments：concat **能跑完**，但 hover 頁面後 tab memory 從 7.7 GB 飆到 10.2 GB 並 crash。診斷後確認**根因不是 memory leak，是 render storm + GC pressure**：

- WaveformPlayer canvas 60 fps 重繪 + `getBarColor` 每幀 2000 bars × 1485 segments 線性搜尋 = 1.78 億 ops/秒
- `activeSegmentIndex` 每幀變動 → WorkspacePage rerender → SegmentCards rerender（無 memo） → 1485 個 card 同時重建 className / style
- 1485 個 DOM element CSS transition 排隊 → V8 GC 撐不住 → Edge tab killer

### 12.2 已實作改動
| # | 改動 | 解的問題 |
|---|------|---------|
| A2 | `SegmentCardItem` 抽出 + `React.memo`、callbacks 用 `useCallback` 穩定 | 阻止 1485 卡 rerender 雪崩 |
| A3 | 階層式 concat 後 `terminateFFmpeg()` | 釋放 ~3 GB WASM linear memory |
| A4 | Pass 2 後 `intermediates.length = 0` + 清 `batches[i]` | 釋放 ~930 MB JS heap |
| B1 | `generateAll` 加 `skipConcat?: boolean`、新 `concatOnly` export | N>50 時跳過 auto concat |
| B2 | WorkspacePage N>50 不掛 player（`return null`） | 消除 canvas redraw / `activeSegmentIndex` 來源 |
| B3 | `useGeneration.handleConcatOnly` + `WorkspacePage.handleApprove` 改 async（`WorkspaceHeader` 加 `onApprove` prop） | Approve 觸發 concat |
| B4 | Concat 進度 overlay（fixed inset 0、進度條） | 使用者按 Approve 不會以為當機 |
| 解耦 | `canRegenerate = !isGenerating`（不含 isConcatting） | 防 concat 開始瞬間 1485 卡 rerender 重設 disabled |

### 12.3 實測結果
- ✅ 1485 segments hover 不再 crash
- ✅ Approve 後 concat 進度 overlay 正常顯示
- ✅ Memory peak 大幅下降
- ❌ 但發現新需求（見 Phase 3）：使用者希望 N>50 時**完全不顯示 player**，且 concat 觸發點改用既有 Approve 按鈕

---

## 13. Phase 3 — Direct Input 多句切分（資料模型重設計）

### 13.1 動機
Phase 1+2 都在補「1 sentence × N segments」資料模型在 N 大時的下游問題：
- 階層式 concat 補 N>50 的 timeout / OOM
- 隱藏 player 補 1485 個 SegmentCard 的 render storm
- skipConcat / Approve 觸發 concat 補長時間 concat 體驗

Phase 3 從**根本改變資料模型**：Direct Input 從「1 sentence × N segments」變「⌈N/50⌉ sentences × ≤50 segments each」。每個 sentence 都能單批 concat，所有大 N 觸發條件全部失效。

### 13.2 多句切分規則（演算法）
```ts
// 1. 用既有 splitSentences 把 text 切成所有 segments
const allSegments = splitSentences(rawText, segmentMode, minTokens, maxTokens);

// 2. 每 MAX_SEGMENTS_PER_SENTENCE (=50) 個 segments 拼成一個 sentence
const sentences: string[][] = [];
for (let i = 0; i < allSegments.length; i += MAX_SEGMENTS_PER_SENTENCE) {
  sentences.push(allSegments.slice(i, i + MAX_SEGMENTS_PER_SENTENCE));
}
// 第 i 句的 text = sentences[i].join("")
```

關鍵點：**不二次 splitSentences**（直接用段陣列建 SentenceState；避免 `balanceSegments` 第二次 run 改變段落邊界）。

### 13.3 切分結果對照
| 字數 | 預估 segments | 切出的 sentences |
|------|-------------|---------------|
| 1,000 | ~15 | 1 |
| 5,000 | ~80 | 2 (50 + 30) |
| 50,000 | ~1,485 | ~30 (29 × 50 + 35) |

### 13.4 對 Phase 1+2 的影響
| 機制 | 新模型下狀態 | 為什麼保留 |
|------|------------|----------|
| 階層式 concat（N>50 分批） | Defensive — Direct Input 永遠 ≤50 不觸發 | Upload 異常情境（單行極長文本）仍可能觸發 |
| `skipConcat` option | Defensive — 罕觸發 | 同上 |
| N>50 隱藏 player | Defensive — Direct Input 永遠 ≤50 不觸發 | 同上 |
| Approve 觸發 concat | Defensive — 罕觸發 | 同上 |
| `terminateFFmpeg` after hierarchical | Defensive — 罕觸發 | 同上 |
| `MAX_SEGMENTS_PER_SENTENCE = CONCAT_BATCH_SIZE` | 單一常數來源 | 兩者邏輯上同一個值；ffmpeg-service 從 preprocessing import |

### 13.5 ZIP `Concat all sentences` checkbox 預設值
| 模式 | 預設 | 理由 |
|------|------|------|
| Direct Input | ✅ ON | 多句切分後使用者通常要單一最終音檔 |
| Upload | ❌ OFF | 使用者多半要保留分段檔 |

### 13.6 Player 顯示規則（簡化版）
**單一規則**：當前選中 sentence 的 segment 數 > `MAX_SEGMENTS_FOR_PLAYER` (=10) → 不顯示 WaveformPlayer。

跟 inputMode 無關、跟其他 sentences 無關，邏輯極簡。

| 情境 | 該 sentence segment 數 | 顯示 player？ |
|------|---------------------|------------|
| 短文 Direct（1 sentence × ~5 segs） | 5 | ✅ |
| 長文 Direct（30 sentences × ~50 segs） | 50 | ❌ |
| Upload 短句（每句 ~3 segs） | 3 | ✅ |
| Upload 異常長句（>10 segs） | >10 | ❌ |

> 為什麼閾值是 10 而不是 50（= MAX_SEGMENTS_PER_SENTENCE）：WaveformPlayer canvas 60fps 重繪 + 每 bar O(N) `getBarColor` 線性搜尋，即使 50 segments 也會吃 CPU 影響流暢度；10 是經驗上「波形仍可用、畫面流暢」的安全值。

### 13.7 改動檔案總覽
| 檔案 | 改動 |
|------|------|
| `src/utils/preprocessing.ts` | 新增 `MAX_SEGMENTS_PER_SENTENCE = 50`、`splitDirectInputIntoSentences` helper |
| `src/services/ffmpeg-service.ts` | `CONCAT_BATCH_SIZE` 改 import 自 preprocessing（單一常數來源） |
| `src/pages/WorkspacePage.tsx` | useEffect 多句切分；player 條件渲染加 defensive Direct Input 規則 |
| `src/pages/SetupPage.tsx` | `directSegmentGroups` useMemo + `sentenceTexts` 用其產出；`previewSegments` / `handleCreate` 共用同一份切分結果 |
| `src/components/workspace/SentenceSidebar.tsx` | `concatAll` 預設 `inputMode === "direct"` |
| `src/components/workspace/WorkspaceHeader.tsx` | `onApprove?` prop（Phase 2 串入；handleApprove 走 concat-then-approve 流程） |

### 13.8 與既有規格文件的關係
- `2026-04-23-direct-input-single-audio.md` 規定 **Direct Input 整段視為 1 sentence**。Phase 3 將其升級為「整段 → 多句（每句 ≤50 segments）」。**舊規格中的「1 sentence」**應理解為**單一概念上的最終音檔**（透過 ZIP concatAll 完成），而非資料模型上的 sentence。
- 該規格的「長度上限 50,000 字」由 Phase 1 #5 落實，仍有效。
- 切分行為的更新請以本文件 §13 為準。
