# 斷詞服務 + 台羅拼音轉換

> 日期：2026-03-27

## 功能概述

新增前端詞典服務，提供三個 API：

1. **segmentWords** — 中文句子斷詞（逆向最長詞匹配）
2. **toTailo** — 詞序列轉台羅拼音
3. **validateWords** — 詞序列詞彙檢查

僅在語言設定為台語 (`nan`) 時啟用。

---

## 架構

```
lexicon.txt (原始 IPA 詞典)
        │
        ▼  scripts/preprocess-lexicon.ts
public/lexicon-nan.json (word → tailo[] JSON, ~14MB)
        │
        ▼  fetch (lazy load)
LexiconService (src/services/lexicon-service.ts)
        │
        ├── segmentWords(sentence) → string[]
        ├── toTailo(words) → WordToken[]
        └── validateWords(words) → ValidationResult[]
        │
        ▼
useLexiconStore (Zustand store)
        │
        ▼
useLexicon() hook (auto-load when language=nan)
```

---

## API 介面

### 型別定義

```typescript
interface WordToken {
  word: string;
  tailoList: string[];  // 所有候選發音，OOV 時為空陣列
}

interface ValidationResult {
  word: string;
  inVocab: boolean;
}
```

### API 1: `segmentWords(sentence: string): string[]`

給一個中文句子，用逆向最長詞匹配切成詞序列。

```typescript
const words = service.segmentWords("你們想，大地污染是多麼的嚴重呢");
// → ["你們", "想", "，", "大地", "污染", "是", "多麼", "的", "嚴重", "呢"]
```

**演算法**：Backward Maximum Match
- 從句尾往句首掃描
- 每個位置嘗試最長匹配（最多 `maxLen` 字元）
- 標點符號獨立切出
- 無法匹配時取單字後退（OOV fallback）

### API 2: `toTailo(words: string[]): WordToken[]`

給一組詞序列，查詢每個詞的所有台羅候選發音。一字多音的詞會回傳多筆發音。

```typescript
const tokens = service.toTailo(["大地", "一", "嚴重"]);
// → [
//   { word: "大地", tailoList: ["tai7-tue7", "tai7-te7", "tua7-tue7"] },
//   { word: "一", tailoList: ["tsik8", "tsit8", "tsit8-phok4", "tsit8-e7", "it4", ...] },
//   { word: "嚴重", tailoList: ["giam5-tiong7", ...] }
// ]
```

### API 3: `validateWords(words: string[]): ValidationResult[]`

給一組詞序列（空格分隔），檢查每個詞是否在詞典中。

```typescript
const results = service.validateWords(["大地", "xyz", "污染"]);
// → [
//   { word: "大地", inVocab: true },
//   { word: "xyz", inVocab: false },
//   { word: "污染", inVocab: true }
// ]
```

---

## 使用方式

### 在 React 元件中使用

```typescript
import { useLexicon } from "../hooks/useLexicon";

function MyComponent() {
  const { service, isLoading, error, isAvailable } = useLexicon();

  if (!isAvailable) return null;      // 非台語，不顯示
  if (isLoading) return <Spinner />;
  if (error) return <Error msg={error} />;
  if (!service) return null;

  const words = service.segmentWords("你們想，大地污染");
  const tokens = service.toTailo(words);
  // ...
}
```

### 在非 React 環境中使用

```typescript
import { useLexiconStore } from "../stores/lexicon-store";

// 載入
await useLexiconStore.getState().loadLexicon();

// 使用
const words = useLexiconStore.getState().segmentWords("大地污染");
const tokens = useLexiconStore.getState().toTailo(words);
```

---

## 詞典預處理

### 來源

原始詞典：`lexicon.txt`（Kaldi decode lexicon 格式）
- 格式：TSV `詞\tIPA音標`
- 台語條目以 `19xx` 聲調碼辨識

### 執行

```bash
npx tsx scripts/preprocess-lexicon.ts /path/to/lexicon.txt
```

### 輸出

`public/lexicon-nan.json` — JSON 格式 `Record<string, string[]>`（保留所有發音）

```json
{
  "一": ["tsik8", "tsit8", "tsit8-phok4", "tsit8-e7", "it4", "it4-soh8", "it8", "i1", "io1"],
  "外制": ["gua7-tse3"],
  "大地": ["tai7-tue7", "tai7-te7", "tua7-tue7"]
}
```

統計：403,923 個不重複詞，563,806 筆不重複發音，檔案大小 ~14MB（gzip 後 ~3-4MB）。

---

## 新增檔案

| 檔案 | 說明 |
|------|------|
| `src/utils/ipa-to-tailo.ts` | IPA → 台羅轉換（從 Python 移植） |
| `scripts/preprocess-lexicon.ts` | 詞典預處理腳本 |
| `public/lexicon-nan.json` | 預處理後的詞典資料（自動生成） |
| `src/services/lexicon-service.ts` | 詞典服務：3 個 API |
| `src/stores/lexicon-store.ts` | Zustand store |
| `src/hooks/useLexicon.ts` | React hook（自動載入） |
