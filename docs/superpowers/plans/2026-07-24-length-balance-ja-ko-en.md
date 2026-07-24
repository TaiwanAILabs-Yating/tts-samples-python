# 日/韓/英長度平衡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓日文（漢字/假名）、韓文（諺文）與英文都納入 TTS 長度平衡：token 計數涵蓋假名與諺文、強制分段以 word-atom 明確保證不切斷英文單字、修正合併時英文權重的計數一致性。

**Architecture:** 修改兩份互為鏡像的分段實作（前端 TS `src/utils/preprocessing.ts`、批次 Python `preprocessing.py`）中的三個函式：`countTokens`/`count_tokens`、`forceSplitByChar`/`force_split_by_char`、`balanceSegments`/`balance_segments`。API 簽名與整體流程不變。

**Tech Stack:** TypeScript + Vitest（node 環境）；Python 3.10 + pytest 8.4.2。

## Global Constraints

- CJK 字元類別擴充為 `一-鿿぀-ヿ가-힯`（漢字 + 平假名 + 片假名 + 諺文音節），每字 1 token。regex **一律用 `\u` escape**。
- 英文權重維持 `floor(字數 × 1.5)`；數字仍算 0；不新增 `language` 參數（依實際字元）。
- `forceSplitByChar` 原子規則：`[a-zA-Z]+` 整包，其餘每字一個原子；`current` 為空時無條件納入下一原子（防禦性允許超限）。保留函式名與 export。
- `balanceSegments` 貪婪合併改用 `countTokens(current + piece)` 重新計數，移除 token 累加變數。
- TS 與 Python 兩邊行為與測試對稱。
- 既有測試需維持通過（CJK 情境不受改動 3 影響，因其可加）。

---

### Task 1: TypeScript（`src/utils/preprocessing.ts`）

**Files:**
- Modify: `src/utils/preprocessing.ts`（`countTokens` :35、`forceSplitByChar` :45、`balanceSegments` Step 2 :148-169）
- Test: `src/__tests__/preprocessing.test.ts`

**Interfaces:**
- Consumes: 無（純函式）
- Produces（簽名不變）：`countTokens(text: string): number`、`forceSplitByChar(text: string, maxTokens: number): string[]`、`balanceSegments(segments: string[], minTokens?: number, maxTokens?: number): string[]`

- [ ] **Step 1: 寫失敗測試**

在 `src/__tests__/preprocessing.test.ts` 末端（最後一個 top-level `});` 之後）新增。若檔案頂部 import 尚未含 `forceSplitByChar` / `splitSentences`，一併補上（已有則略）。

```ts
describe("countTokens - CJK kana/hangul", () => {
  it("counts hiragana as 1 token each", () => {
    expect(countTokens("こんにちは")).toBe(5);
  });
  it("counts katakana (incl. long mark) as 1 token each", () => {
    expect(countTokens("カタカナ")).toBe(4);
    expect(countTokens("東京タワー")).toBe(5); // 2 kanji + タ ワ ー
  });
  it("counts hangul syllables as 1 token each", () => {
    expect(countTokens("안녕하세요")).toBe(5);
  });
  it("keeps existing Chinese/English behavior", () => {
    expect(countTokens("你好")).toBe(2);
    expect(countTokens("hello")).toBe(1);
    expect(countTokens("hello world")).toBe(3);
    expect(countTokens("你好world")).toBe(3);
  });
});

describe("forceSplitByChar - word safety", () => {
  it("never splits an English word across segments", () => {
    const text = "the quick brown fox jumps over";
    const out = forceSplitByChar(text, 3);
    for (const w of ["the", "quick", "brown", "fox", "jumps", "over"]) {
      expect(out.some((s) => s.includes(w))).toBe(true);
    }
    expect(out.join("")).toBe(text);
  });
  it("keeps a run of Latin letters whole even adjacent to CJK", () => {
    const out = forceSplitByChar("你好helloworld你好", 3);
    expect(out.some((s) => s.includes("helloworld"))).toBe(true);
    expect(out.join("")).toBe("你好helloworld你好");
  });
  it("still bounds pure CJK/kana segments by maxTokens", () => {
    const out = forceSplitByChar("あいうえおかきくけこ", 3);
    expect(out.every((s) => countTokens(s) <= 3)).toBe(true);
  });
});

describe("splitSentences - ja/ko length balance", () => {
  it("splits long kana text by maxTokens in sentence mode", () => {
    const segs = splitSentences("あ".repeat(100), "sentence", 10, 40);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => countTokens(s) <= 40)).toBe(true);
  });
  it("splits long hangul text by maxTokens in sentence mode", () => {
    const segs = splitSentences("가".repeat(100), "sentence", 10, 40);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => countTokens(s) <= 40)).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/__tests__/preprocessing.test.ts -t "CJK kana/hangul"`
Expected: FAIL（`countTokens("こんにちは")` 目前回 0，不等於 5）。

- [ ] **Step 3: 實作三處改動**

3a. `countTokens`（約 :35-39）改為：

```ts
export function countTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return cjkChars + Math.floor(englishWords * 1.5);
}
```
同時更新其上方 docstring：新增「日文漢字/假名、韓文諺文：各 1 token」。

3b. `forceSplitByChar`（約 :45-66）改為：

```ts
export function forceSplitByChar(
  text: string,
  maxTokens: number
): string[] {
  // Atoms: a run of Latin letters stays whole; every other char is its own atom.
  const atoms = text.match(/[a-zA-Z]+|[\s\S]/g) || [];
  const result: string[] = [];
  let current = "";
  for (const atom of atoms) {
    if (current === "" || countTokens(current + atom) <= maxTokens) {
      current += atom;
    } else {
      result.push(current);
      current = atom;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
}
```
更新其 docstring：說明英文單字不被切斷；單一原子超過 maxTokens 時自成一段（防禦性）。

3c. `balanceSegments` Step 2 貪婪合併（約 :148-169），把累加式改為重算式：

```ts
  // Step 2: Greedy merge - only combine if won't exceed maxTokens
  const result: string[] = [];
  let current = "";

  for (const piece of atomic) {
    if (current === "" || countTokens(current + piece) <= maxTokens) {
      current += piece;
    } else {
      result.push(current);
      current = piece;
    }
  }

  if (current) {
    result.push(current);
  }
```
（移除原 `currentTokens` / `pieceTokens` 變數。Step 1、Step 3 不動。）

- [ ] **Step 4: 執行新測試確認通過**

Run: `npx vitest run src/__tests__/preprocessing.test.ts -t "CJK kana/hangul"` 及 `-t "word safety"` 及 `-t "length balance"`
Expected: PASS。

- [ ] **Step 5: 全檔回歸**

Run: `npx vitest run src/__tests__/preprocessing.test.ts`
Expected: 全數 PASS（既有 CJK/English 案例不受影響）。若有既有案例斷言舊「假名=0」行為而失敗，更新為新行為（預期無此類）。

- [ ] **Step 6: 型別檢查 + 全測試**

Run: `npx tsc -b` → exit 0；`npx vitest run` → 全綠。

- [ ] **Step 7: Commit**

```bash
git add src/utils/preprocessing.ts src/__tests__/preprocessing.test.ts
git commit -m "feat: 前端 token 計數納入日/韓、強制分段不切斷英文單字"
```

---

### Task 2: Python 鏡像（`preprocessing.py`）

**Files:**
- Modify: `preprocessing.py`（`count_tokens` :45、`force_split_by_char` :56、`balance_segments` Step 2 :167-183）
- Test: `test_preprocessing.py`

**Interfaces:**
- Consumes: 無
- Produces（簽名不變）：`count_tokens(text) -> int`、`force_split_by_char(text, max_tokens) -> List[str]`、`balance_segments(segments, min_tokens=10, max_tokens=40) -> List[str]`

- [ ] **Step 1: 寫失敗測試**

在 `test_preprocessing.py` 末端新增（沿用檔案既有 pytest 風格，plain assert；確認頂部已 import `count_tokens, force_split_by_char, balance_segments, split_sentences`，缺者補上）：

```python
def test_count_tokens_hiragana():
    assert count_tokens("こんにちは") == 5


def test_count_tokens_katakana():
    assert count_tokens("カタカナ") == 4
    assert count_tokens("東京タワー") == 5  # 2 kanji + タ ワ ー


def test_count_tokens_hangul():
    assert count_tokens("안녕하세요") == 5


def test_count_tokens_existing_behavior():
    assert count_tokens("你好") == 2
    assert count_tokens("hello") == 1
    assert count_tokens("hello world") == 3
    assert count_tokens("你好world") == 3


def test_force_split_keeps_english_words_whole():
    text = "the quick brown fox jumps over"
    out = force_split_by_char(text, 3)
    for w in ["the", "quick", "brown", "fox", "jumps", "over"]:
        assert any(w in seg for seg in out)
    assert "".join(out) == text


def test_force_split_keeps_latin_run_whole_next_to_cjk():
    out = force_split_by_char("你好helloworld你好", 3)
    assert any("helloworld" in seg for seg in out)
    assert "".join(out) == "你好helloworld你好"


def test_force_split_bounds_pure_kana():
    out = force_split_by_char("あいうえおかきくけこ", 3)
    assert all(count_tokens(seg) <= 3 for seg in out)


def test_split_sentences_balances_long_kana():
    segs = split_sentences("あ" * 100, "sentence", 10, 40)
    assert len(segs) > 1
    assert all(count_tokens(s) <= 40 for s in segs)


def test_split_sentences_balances_long_hangul():
    segs = split_sentences("가" * 100, "sentence", 10, 40)
    assert len(segs) > 1
    assert all(count_tokens(s) <= 40 for s in segs)
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `python3 -m pytest test_preprocessing.py -q -k "hiragana or hangul or english_words_whole"`
Expected: FAIL（`count_tokens("こんにちは")` 目前回 0）。

- [ ] **Step 3: 實作三處改動（對稱 Task 1）**

3a. `count_tokens`（:45-53）：

```python
def count_tokens(text: str) -> int:
    """
    Count tokens in text.
    - Chinese / Japanese kanji & kana / Korean hangul: 1 token each
    - English word: 1.5 tokens (fixed average)
    """
    cjk_chars = len(re.findall(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", text))
    english_words = len(re.findall(r"[a-zA-Z]+", text))
    return cjk_chars + int(english_words * 1.5)
```

3b. `force_split_by_char`（:56-78）：

```python
def force_split_by_char(text: str, max_tokens: int) -> List[str]:
    """
    Split text into <= max_tokens pieces without breaking English words.
    A run of Latin letters is kept whole; every other char is its own atom.
    A single atom exceeding max_tokens becomes its own (over-limit) segment.
    """
    atoms = re.findall(r"[a-zA-Z]+|[\s\S]", text)
    result = []
    current = ""
    for atom in atoms:
        if current == "" or count_tokens(current + atom) <= max_tokens:
            current += atom
        else:
            result.append(current)
            current = atom
    if current:
        result.append(current)
    return result
```

3c. `balance_segments` Step 2（:167-183）：

```python
    # Step 2: Greedy merge - only combine if won't exceed max_tokens
    result = []
    current = ""

    for piece in atomic:
        if current == "" or count_tokens(current + piece) <= max_tokens:
            current += piece
        else:
            result.append(current)
            current = piece

    if current:
        result.append(current)
```
（移除 `current_tokens` / `piece_tokens`。Step 1、Step 3 不動。）

- [ ] **Step 4: 執行新測試確認通過**

Run: `python3 -m pytest test_preprocessing.py -q -k "hiragana or katakana or hangul or force_split or long_kana or long_hangul or existing_behavior"`
Expected: PASS。

- [ ] **Step 5: 全檔回歸**

Run: `python3 -m pytest test_preprocessing.py -q`
Expected: 全數 PASS。

- [ ] **Step 6: Commit**

```bash
git add preprocessing.py test_preprocessing.py
git commit -m "feat: Python 端 token 計數納入日/韓、強制分段不切斷英文單字"
```

---

## Self-Review

**Spec coverage:**
- 改動 1（假名/諺文計數）→ Task 1/2 Step 3a ✓
- 改動 2（word-atom 不切詞）→ Task 1/2 Step 3b ✓
- 改動 3（合併重算計數）→ Task 1/2 Step 3c ✓
- TS/Python 對稱 → Task 1、Task 2 ✓
- 測試涵蓋日/韓計數、英文不破詞、混合、CJK 邊界、sentence 模式長度切分 → 兩 task Step 1 ✓
- 不做語言感知 / 不改英文權重 / 數字仍 0 → 三處改動均未觸及 ✓

**Placeholder scan:** 無 TBD/TODO；每個 code step 皆有完整程式碼與確切命令。

**Type/naming consistency:** `countTokens`/`count_tokens`、`forceSplitByChar`/`force_split_by_char`、`balanceSegments`/`balance_segments` 簽名不變；兩 task 的 regex 範圍與原子規則一致；測試斷言數值（5/4/5/2/1/3/3）兩邊相同。
