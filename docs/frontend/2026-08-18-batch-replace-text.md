# 批次取代字詞（Batch Find & Replace）

> 日期：2026-08-18
> Branch: `feat/batch-replace-text`
> 設計稿：`tts_api.pen` → `Batch Replace Dialog`、`TTS Workspace - Batch Replace (Open)`

## 需求

同一個常見字詞（例如 `你` → `汝`）在多個 sentence / segment 中重複出現時，
以往只能一張一張 segment card 手動改。此功能提供跨句子的批次取代。

**範圍限制**：只更動 `segment.text`。Tailo / word segmentation 狀態
（`wordSegmentation`）完全不碰，行為與手動編輯 segment 文字一致。

## 入口

Sentence Sidebar header，`Regenerate All` / `Approve All` 右側的 icon 按鈕
（lucide `replace`）。生成中（`isGenerating`）時 disabled。

## Dialog 行為

| 區塊 | 行為 |
|------|------|
| 尋找 / 取代為 | 字面比對（literal，區分大小寫，無 regex）。輸入即時搜尋所有 segment。 |
| 範圍 | 全部句子（預設）/ 目前句子 |
| 預覽列表 | 每個命中的 segment 一列：`#句子 · Seg N`（同一 segment 多處會標 `· N 處`）、取代前（紅底標原字）/ 取代後（紫底標新字）。Checkbox 預設全選，可逐項排除；header 有全選 / 全不選。 |
| 警示 | 幾個 segment 需重新生成、幾個 approved 句子會退回未審核；若有尚未生成過的句子，提示只會更新文字。 |
| 取消 | 關閉，不做任何事（Esc / 點遮罩同） |
| 僅取代文字（N） | 只改文字，不觸發生成 |
| 取代並重新生成（M） | 改文字後，對受影響且**已生成過**的 segment 依序 regenerate。M 只計算可 regenerate 的數量。 |

`find` 為空、`find === replace`、或沒有勾選任何列時，兩顆確認按鈕 disabled。

## 資料流

```
BatchReplaceDialog
  └─ findReplaceMatches(sentences, find, replace, scope)   ← utils/batch-replace.ts
  └─ summarizeSelection(...)                                ← 統計 / 警示文字
  └─ onApply({ edits, regenerate })
        │
        ▼
WorkspacePage.handleBatchReplaceApply
  ├─ projectStore.applyBatchReplace(edits)
  │     - segment.text ← 新文字（只動 text）
  │     - sentence.text ← segments.map(text).join("")（重建）
  │     - sentence.status: approved → generated（其他狀態不變）
  └─ regenerate ? useGeneration.handleRegenerateSegments(targets)
        - 依序呼叫 regenerateOneSegment（與單顆 Regen 按鈕共用同一段邏輯）
        - 沒有 promptVoiceAssetKey（從未生成）的句子略過
```

## 檔案

| 檔案 | 變更 |
|------|------|
| `src/utils/batch-replace.ts` | 新增。純函式：`countOccurrences`、`replaceAllLiteral`、`splitByTerm`、`findReplaceMatches`、`summarizeSelection`、`toSegmentEdits`、`matchKey` |
| `src/stores/project-store.ts` | 新增 `applyBatchReplace(edits)` |
| `src/hooks/useGeneration.ts` | 抽出 `regenerateOneSegment`；新增 `handleRegenerateSegments(targets)` |
| `src/components/workspace/BatchReplaceDialog.tsx` | 新增 |
| `src/components/workspace/SentenceSidebar.tsx` | header 新增入口按鈕，新 prop `onOpenBatchReplace` |
| `src/pages/WorkspacePage.tsx` | 掛載 dialog、`handleBatchReplaceApply` |
| `src/__tests__/batch-replace.test.ts` | 純函式測試 |
| `src/__tests__/project-store-batch-replace.test.ts` | store action 測試 |

## 已知取捨

- `sentence.text` 以 segments 重建，與 Workspace 建立句子時的方式一致
  （`segs.join("")`）。手動編輯單一 segment 目前不會同步 `sentence.text`，
  此功能會；若之後要統一，可讓 `updateSegmentText` 也重建。
- 「取代並重新生成」是逐 segment 依序 regenerate，每顆 regen 完若該句已有
  concatenatedAudio 會重新 concat 一次；批次量大時較慢，v1 先求正確。
- 不在本版：儲存常用取代規則、regex / 全字匹配。
