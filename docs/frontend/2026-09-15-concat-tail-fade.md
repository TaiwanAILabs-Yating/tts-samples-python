# 合併輸出結尾淡出（修正結尾爆音）

> 日期：2026-09-15
> Branch: `fix/concat-tail-fade`

## 問題

合併流程只有 `acrossfade`，它只處理 **segment 之間的接點**，不會碰整句的第一個與最後一個樣本。
TTS 輸出若在波形尚未歸零處截斷，播放停止的瞬間會形成階梯 → 結尾爆音。

- 多段：接點已由 acrossfade 修平，但**整句結尾**沒處理
- 單段：trimSilence 關閉時直接回傳原始 buffer（不經 FFmpeg）；開啟時只跑 silenceremove，
  若結尾是大音量截斷根本沒有靜音可剪 → 兩種情況結尾都沒處理

目前唯一處理結尾的是 TTS API 的 `<|sil_200ms|>` token（`addEndSilence`，所有語言都會加），
但它是否有效取決於各模型是否訓練過該 token（日 / 英 / 韓暫時共用中文模型），因此需要後處理兜底。

實測（原生 ffmpeg，模擬在波峰截斷，正常相鄰樣本差 ≈ 0.031）：

| 情境 | 結尾跳動 | 接點跳動 |
|------|---------|---------|
| 修正前（acrossfade） | 0.496 ✗ | 0.031 ✓ |
| 修正後（多段，trim 開 / 關） | 0.003 ✓ | 0.031 ✓ |
| 修正後（單段） | 0.003 ✓ | — |

## 修法

**只淡出整句的最後一個 segment 的結尾**（10ms，`TAIL_FADE_SEC`）。開頭不淡入：TTS 輸出通常
從靜音開始，且 trimSilence 開啟時開頭本就保留 0.1s 靜音。

淡出寫法是「在反轉狀態下淡入，再反轉回來」：

```
最後一段（trim 開）：silenceremove → areverse → silenceremove → afade=t=in:d=0.01 → areverse
最後一段（trim 關）：areverse → afade=t=in:d=0.01 → areverse
其餘各段：維持現狀
接著：acrossfade 串接
```

### 為什麼不用 `afade=t=out` 或對整句包 `areverse`

| 做法 | 問題 |
|------|------|
| `afade=t=out:st=…` | 需要事先知道合併後總長度，但要等 silenceremove + crossfade 跑完才知道 |
| 對整句輸出包 `areverse` | `areverse` 必須把整段音檔讀進記憶體。實測 10 分鐘音檔 11MB → 67MB，在 ffmpeg.wasm 中風險高 |
| **只反轉最後一段（採用）** | 不需長度；trim 開啟時直接搭現有修尾鏈的 `areverse`，零額外成本；trim 關閉時也只倒轉最後一段 |

## 套用範圍

| 位置 | 淡出 |
|------|------|
| `recombineOutputs()`（生成後預覽、regen 後重新 concat、`concatOnly()` 下載） | ✅ |
| SentenceSidebar 單句下載 concat | ✅ |
| 階層合併（超過 50 段） | ✅ 只在最後一批的最後一個輸入；Pass 2 不加（acrossfade 不碰外側結尾） |
| `Concat all sentences`（全案合併） | ❌ 各句結尾已淡出過 |
| Segment card 單段下載 | ❌ 維持原始 TTS 輸出（review 決議） |

- 單段句子**不再直接回傳原檔**，一定會跑一次 FFmpeg
- `afade` 不改變長度 → 時間軸、`metadata.json` 的 `start`/`end` 不受影響
- `metadata.json` → `config.advanced.tailFadeSec` 記錄淡出長度

## 檔案

- `src/services/ffmpeg-service.ts`：`TAIL_FADE_SEC`、`ConcatOptions.fadeOutTail`、builder `tailFade`
- `src/services/tts-orchestrator.ts`、`src/components/workspace/SentenceSidebar.tsx`：呼叫點開啟 `fadeOutTail`
- `src/__tests__/ffmpeg-service.test.ts`、`src/__tests__/tts-orchestrator.test.ts`
