# 英文/拉丁字母斷詞保持完整 word

> 日期：2026-04-10
> Branch: `fix/english-word-segmentation`

## 問題

目前 segment level 的斷詞使用逆向最長匹配（backward maximum match），詞庫只有台語漢字。當輸入包含英文/拉丁字母時，因為不在詞庫中（OOV），會被逐字元切斷。

**輸入**：`ká-sú我們大家行菩薩道asus，就要把家裡的人當作我們要關懷的人。`

**目前結果**（char by char）：
```
k á - s ú 我們 大 家行 菩薩 道 a s u s ， 就要 把 家裡的 人 當作 我們 要 關懷 的 人
```

**期望結果**（英文保持 word 單位）：
```
ká-sú 我們 大 家行 菩薩 道 asus ， 就要 把 家裡的 人 當作 我們 要 關懷 的 人
```

## 涉及角色

- **後端**：修改斷詞邏輯
- 前端：不涉及（UI 不需變更）
- 設計：不涉及

## 現狀分析

**核心演算法**：`src/services/lexicon-service.ts` `segmentWords()` (line 92-135)

```
逆向最長匹配流程：
1. 從句尾往句首掃描
2. 每個位置：
   - 空白 → 跳過
   - 標點 → 獨立 token
   - 嘗試最長匹配（maxLen 到 1）→ 匹配到詞庫則切出
   - 都沒匹配 → 單字元 fallback（OOV）← 英文在這裡被逐字切斷
```

**根因**：演算法沒有「拉丁字母」的概念，英文字母不是標點、不在詞庫中，就會走 OOV 單字元 fallback。

## 預計修改

| 檔案 | 修改 |
|------|------|
| `src/services/lexicon-service.ts` | `segmentWords()` 內新增拉丁字母序列處理 |

## 修改方案

在 `segmentWords()` 的 while 迴圈中，標點判斷之後、最長匹配之前，新增一段：如果當前字元是拉丁字母（含帶聲調的組合字元，如 á、ú），往前收集連續的拉丁字母序列作為一個完整 token。

```typescript
// Latin letter sequence → single token
if (isLatinLetter(ch)) {
  let start = i - 1;
  while (start > 0 && isLatinLetter(text[start - 1])) {
    start--;
  }
  tokens.push(text.slice(start, i));
  i = start;
  continue;
}
```

需要新增 `isLatinLetter(ch)` helper：
- ASCII letters: A-Z, a-z (U+0041-005A, U+0061-007A)
- 帶聲調的拉丁字母：à á â ã ä å ē é ì í ō ó ú ü 等（U+00C0-024F Latin Extended）
- 數字 0-9 也應包含（避免 "MP3" 被切成 "M P 3"）
- 連字號 `-` 在拉丁字母之間時應包含（如 `ká-sú` 應為一個 token）

## 備註

- 此修改不影響中文斷詞邏輯（拉丁字母判斷在最長匹配之前，不會干擾漢字匹配）
- 標點判斷在更前面，所以獨立的 `-` `，` 等不會被誤判
- 連字號的處理需注意：只在兩側都是拉丁字母時才視為 word 的一部分
