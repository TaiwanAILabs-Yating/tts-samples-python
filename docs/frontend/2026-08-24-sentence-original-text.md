# Sentence 顯示與 metadata.json 保留使用者原始文字（標點遺失修正）

> 日期：2026-08-24
> Branch: `fix/sentence-original-text`

## 問題

`splitSentences()` 會對每個 segment 做 `stripPunctuation()`（TTS 輸入需要），
而 WorkspacePage 建立 sentence 時用 `segs.join("")` 當 `sentence.text`。
造成：

- Workspace header / sidebar 顯示的句子沒有標點
- 匯出 ZIP 的 `metadata.json` 裡 `sentences[].text` 也是無標點版本
- 使用者指定的標點符號（，。！？「」…）全部遺失

## 修法

`sentence.text` 一律改存**使用者原始文字**；segments 維持 strip（TTS 輸入不變）。

| 模式 | 原始文字來源 |
|------|--------------|
| Upload File | 每行本身就是原文，直接使用 |
| Direct Input | `extractOriginalSentenceTexts()`：segment 是原文的有序字元子序列，用 ordered char-walk 找回每組 segments 在 rawText 的 span，切出原始片段（結尾標點歸前句、開頭引號歸後句；全部片段串回 = 原文） |

匹配失敗時 fallback 回舊行為（`segs.join("")`），不會壞。

## 連動修正：批次取代

`applyBatchReplace` 原本用 segments rebuild `sentence.text`，會再次毀掉標點。
改為 `replaceInSentenceText()`：只在**被勾選 segment 對應的 span** 內做
find→replace，標點與未勾選 segment 的文字不動。簽名改為
`applyBatchReplace(edits, find, replaceWith)`。

（segment 被手動編輯過、span 對不回來時，fallback 對整句 replaceAllLiteral。）

## 檔案

- 新增 `src/utils/sentence-text.ts`（`findSegmentSpans` / `extractOriginalSentenceTexts` / `replaceInSentenceText`）+ `src/__tests__/sentence-text.test.ts`
- `src/pages/WorkspacePage.tsx`：sentence 建立時帶入原始文字
- `src/stores/project-store.ts`：`applyBatchReplace` 改 span-based replace
- `src/components/workspace/BatchReplaceDialog.tsx`：apply payload 帶 find/replaceWith

## 限制

- 既有專案（localStorage 已存的 sentences）無法回溯原始標點，新建專案起生效
- metadata.json 不需改動（本來就取 `s.text`）
