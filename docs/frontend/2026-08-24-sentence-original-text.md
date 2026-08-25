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

## 補充修正（同日，`fix/setup-page-original-text`）

第一版只改了 `WorkspacePage` 的建立路徑，但**實際使用者流程走的是
`SetupPage.handleCreate`**（「Create & Generate」按鈕）：它自己也建一份
sentences 並寫進 store，`WorkspacePage` 的 effect 因為 `sentences.length !== 0`
就直接跳過。結果是修正完全沒生效，sidebar 與 metadata.json 依舊掉標點。

（第一版的 E2E 直接把 `sentences: []` 塞進 localStorage 再導向 `/workspace`，
只驗到 WorkspacePage 那條路徑，因此沒抓到 — 現已補上走真實 Setup 流程的
E2E 當回歸防護。）

修法：把重複的建立邏輯抽成 `utils/sentence-builder.ts` 的
`buildSentenceStates(groups, source)`，兩個入口共用，不會再各自漂移。
順帶讓 Setup 的「Preview Segments」也顯示原始標點，與實際建立結果一致。

## 檔案

- 新增 `src/utils/sentence-text.ts`（`findSegmentSpans` / `extractOriginalSentenceTexts` / `replaceInSentenceText`）+ `src/__tests__/sentence-text.test.ts`
- 新增 `src/utils/sentence-builder.ts`（`buildSentenceStates` — 兩個入口共用）+ `src/__tests__/sentence-builder.test.ts`
- `src/pages/SetupPage.tsx`：handleCreate 與 Preview 改用共用 builder
- `src/pages/WorkspacePage.tsx`：sentence 建立時帶入原始文字
- `src/stores/project-store.ts`：`applyBatchReplace` 改 span-based replace
- `src/components/workspace/BatchReplaceDialog.tsx`：apply payload 帶 find/replaceWith

## 限制

- 既有專案（localStorage 已存的 sentences）無法回溯原始標點，新建專案起生效。
  若需要回溯，可用持久化的 `rawText` + 各句 segments 跑
  `extractOriginalSentenceTexts()` 做一次性 backfill（尚未實作）
- metadata.json 不需改動（本來就取 `s.text`）
