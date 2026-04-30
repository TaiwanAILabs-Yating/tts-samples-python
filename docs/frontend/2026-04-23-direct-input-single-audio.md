# Direct Input 整段即一個音檔

> 日期：2026-04-23
> Branch: `fix/direct-input-single-audio`

## 需求

Direct Input（textarea 直接輸入）模式：**無論文本是否含換行，整段視為一個 sentence，最終只生成一個音檔**。

Upload File（`.txt` 檔案上傳）模式：維持原本「每行一句，各自生成一個音檔」行為不變。

兩種輸入方式的職責自此明確分離：

- **Direct Input**：單一長段文本合成（適合朗讀、長段旁白）
- **Upload File**：批次多句合成（適合樣本集、逐句測試）

## 涉及角色

- **前端**：修改 `sentenceTexts` 切分邏輯與 length / count 驗證在 direct mode 的套用方式
- **後端**：不涉及（前端聚合邏輯改變，TTS API 仍是 per-sentence 呼叫）
- **設計**：不涉及（Text Input 區 UI 不變，僅行為不同；可選配一行輔助說明文字）

## 現狀

`src/pages/SetupPage.tsx` line 36-40：

```typescript
// Build sentences from rawText: split by newline for both direct and upload modes
const sentenceTexts = useMemo(() => {
  const text = rawText.trim();
  if (!text) return [];
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}, [rawText]);
```

目前兩種 inputMode 共用同一切行邏輯，差別只在輸入方式。本需求要把 Direct 與 Upload 的切分行為拆開。

## 預計修改

| 檔案 | 修改 |
|------|------|
| `src/pages/SetupPage.tsx` | `sentenceTexts` useMemo 依 `inputMode` 分流：`direct` → `[rawText.trim()]`；`upload` → 維持切行。Length validation 在 direct mode 比對總長與 `MAX_DIRECT_CHARS` |
| `src/components/setup/TextInputCard.tsx` | Direct 分支 UI 可加一行提示：「整段文字將合成為單一音檔」（可選） |
| `src/utils/preprocessing.ts` | 新增 `MAX_DIRECT_CHARS = 50_000` 常數 |

## 修改內容

### sentenceTexts 切分

```typescript
const inputMode = useProjectStore((s) => s.inputMode);

const sentenceTexts = useMemo(() => {
  const text = rawText.trim();
  if (!text) return [];
  if (inputMode === "direct") return [text]; // 整段一句，保留內部 \n
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}, [rawText, inputMode]);
```

### Length 驗證

```typescript
import { MAX_CHARS_PER_LINE, MAX_DIRECT_CHARS } from "../utils/preprocessing.ts";

const sentenceLengthValidation = useMemo(() => {
  if (!rawText) return null;
  if (inputMode === "direct") {
    const length = rawText.trim().length;
    return {
      valid: length <= MAX_DIRECT_CHARS,
      violations:
        length <= MAX_DIRECT_CHARS ? [] : [{ line: 1, text: rawText, length }],
    };
  }
  return validateSentenceLengths(rawText, MAX_CHARS_PER_LINE);
}, [rawText, inputMode]);
```

> Direct mode 用獨立分支比對總長（不走 `validateSentenceLengths` 逐行檢查），錯誤文案：「整段文字超出字數上限（X/50000 字）」。

### Count 驗證

Direct mode 恆為 1 句，必然通過 `validateSentenceCount`；驗證邏輯可維持不變，不需依 mode 分流。

## 職責邊界總結

| 模式 | 輸入來源 | sentence 數 | 長度上限 | 用途 |
|------|---------|-------------|----------|------|
| Direct Input | textarea | 恆為 1 | 50,000 字（總長，依 [2026-04-24 評估](./2026-04-24-long-text-resource-evaluation.md) 下修） | 單一長段文本合成 |
| Upload File | `.txt` 檔案 | 每行一句，最多 200 句 | 每行 1,000 字 | 批次多句合成 |

## 備註

- 內部 TTS segment 切分（`splitSentences` by token，見 `preprocessing.ts`）仍在 sentence 內部自動把長文本切成多個 segment 送給 TTS API，本次修改不影響此層。
- 此次為前端聚合層行為調整，無 API 合約變動、無後端工單。
- 長度上限初版定為 200,000 字（= `MAX_SENTENCES × MAX_CHARS_PER_LINE`）；經 [2026-04-24 資源評估](./2026-04-24-long-text-resource-evaluation.md) 確認無法執行後下修為 `MAX_DIRECT_CHARS = 50,000`。
