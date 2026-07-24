# 日/韓/英納入長度平衡（token 計數與不切斷英文單字）

> 日期：2026-07-24
> 分支：`feat/length-balance-ja-ko-en`（基於 develop）

## 背景 / 問題

TTS 的長度控制（`maxTokens` 硬切、`minTokens` 軟合併）完全依賴 `countTokens`，而它只計中文漢字（`一-鿿`，1 token）與英文單字（`floor(字數×1.5)`）：

- **日文假名**（平假名 `぀-ゟ`、片假名 `゠-ヿ`）與 **韓文諺文**（`가-힯`）一律算 **0 token** → 假名/諺文多的文本 token 近 0，永遠不會被 `maxTokens` 切分、也不觸發 `minTokens` 合併，等於沒有長度保證。
- 強制分段 `forceSplitByChar` 逐字切，會把**英文單字切在中間**。

新增的 ja/en/ko（Beta）因此缺乏與 zh/nan 同等的長度平衡。

兩份實作互為鏡像，需同步修改：
- 前端：`src/utils/preprocessing.ts`（Web UI）
- 批次：`preprocessing.py`（CLI：`main.py` / `batch_generate.py`）

## 目標

1. `countTokens` / `count_tokens`：日文漢字、平假名、片假名、韓文諺文都算 **1 token/字**（與中文一致）。
2. 強制分段不切斷英文單字；單一英文單字超過 `maxTokens` 時，**允許該段超限**（不硬切）。
3. 修正貪婪合併對英文（非可加權重）的計數一致性。
4. TS 與 Python 兩邊行為一致。

## 非目標（YAGNI）

- 不改英文權重（維持 `floor(字數×1.5)`）。
- 不把數字（`0-9`）納入計數（維持 0，另議）。
- 不新增 `language` 參數 / 不做語言感知：一律依**實際字元**（Unicode 範圍）判斷，混合語言自然正確。
- 不改分段標點集合（日文 `。！？、`、韓文 `.!?,` 已在既有 delimiter 內）。
- 不改半形片假名、CJK 擴充區等罕見範圍。

---

## 設計

### 改動 1：token 計數納入假名與諺文

> 下方 regex 以字元範圍呈現；**實作時一律用 `\u` escape**（`一-鿿぀-ヿ가-힯`）以對齊既有 `一-鿿` 風格。`぀-ヿ` = 平假名+片假名、`가-힯` = 諺文音節。

**TS** `countTokens`（`src/utils/preprocessing.ts:35-39`）：

```ts
export function countTokens(text: string): number {
  const cjkChars = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return cjkChars + Math.floor(englishWords * 1.5);
}
```

**Python** `count_tokens`（`preprocessing.py:45-53`）：

```python
def count_tokens(text: str) -> int:
    cjk_chars = len(re.findall(r"[一-鿿぀-ヿ가-힯]", text))
    english_words = len(re.findall(r"[a-zA-Z]+", text))
    return cjk_chars + int(english_words * 1.5)
```

- `぀-ヿ` 涵蓋平假名 + 片假名（含長音符 `ー`）；`가-힯` 涵蓋諺文音節。
- 中文/英文既有行為不變。

### 改動 2：強制分段不切斷英文單字

把逐字迭代改為以「原子」為單位：**一串連續英文字母 `[a-zA-Z]+` 為一個原子；其餘每字一個原子**。貪婪打包，且當 `current` 為空時無條件納入下一個原子（確保超長單字自成一段、允許超限）。

**TS** `forceSplitByChar`（`src/utils/preprocessing.ts:45-66`，保留函式名與 export）：

```ts
export function forceSplitByChar(text: string, maxTokens: number): string[] {
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
  if (current) result.push(current);
  return result;
}
```

**Python** `force_split_by_char`（`preprocessing.py:56-78`）：

```python
def force_split_by_char(text: str, max_tokens: int) -> List[str]:
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

- CJK/假名/諺文仍逐字（每字一個原子），行為不變。
- 保留函式名（雖語意上已非「純逐字」），避免呼叫端與測試大量改名；更新 docstring 說明新行為。

### 改動 3：貪婪合併計數一致性

`balanceSegments` / `balance_segments` 的 Step 2 目前**累加**每片 token（`currentTokens += pieceTokens`）。英文 `floor(字數×1.5)` 不可加（`floor(1.5)+floor(1.5)=2 ≠ floor(3)=3`），會低估英文長度使段落偷偷變長。改為每次以合併後字串重新計數（與 `ensureMaxTokens` 一致）。

**TS**（`src/utils/preprocessing.ts:152-165`）：

```ts
for (const piece of atomic) {
  if (current === "" || countTokens(current + piece) <= maxTokens) {
    current += piece;
  } else {
    result.push(current);
    current = piece;
  }
}
```

**Python**（`preprocessing.py:167-183`）對應改為 `count_tokens(current + piece)`，移除 `current_tokens` 累加變數。

- 對 CJK（可加）無行為改變；只修正英文情境。
- `current === ""` 保證即使單片 > maxTokens（`ensureMaxTokens` 對超長單字的產物）仍不會空推。

---

## 資料流（不變）

`splitSentences` → 依 mode 切 → `sentence` 模式呼叫 `balanceSegments` → `ensureMaxTokens`（clause 切 + `forceSplitByChar`）→ 貪婪合併 → 短尾合併。本次只改「怎麼算 token」與「forceSplit 的原子邊界」，整體流程與 API 簽名不變。

## 影響範圍

| 檔案 | 改動 |
|------|------|
| `src/utils/preprocessing.ts` | countTokens、forceSplitByChar、balanceSegments 貪婪合併 |
| `preprocessing.py` | 對稱的 count_tokens、force_split_by_char、balance_segments |
| `src/__tests__/preprocessing.test.ts` | 新增日/韓計數、英文不破詞、超長單字、合併一致性測試 |
| `test_preprocessing.py` | 對稱新增 |

既有測試（TS 50、Python 既有）中，斷言英文/中文 token 數的案例應維持通過；若有斷言「假名=0」之類的舊行為，需更新為新行為（預期無此類）。

## 測試計畫

**countTokens / count_tokens**
- `こんにちは` → 5；`カタカナ` → 4；`안녕하세요` → 5；`東京タワー` → 5（2 漢字 + 3 片假名）。
- 既有：`你好` → 2、`hello` → 1、`hello world` → 3、`你好world` → 3 維持不變。

**forceSplitByChar / force_split_by_char**
- 英文長句在 maxTokens 下，**任一輸出段落不得包含被切斷的單字**（每個 `[a-zA-Z]+` run 完整存在於某一段）。
- 單一超長單字（如 40+ 字母）於小 maxTokens 下 → 自成一段且**允許超過 maxTokens**（不硬切）。
- 純 CJK/假名字串 → 仍每段 ≤ maxTokens。

**balanceSegments / splitSentences**
- 日文/韓文長文（純假名/諺文）在 `sentence` 模式下會被 `maxTokens` 切分（不再整段爆長）。
- 含英文的段落合併後，`countTokens(該段) ≤ maxTokens`（驗證改動 3）。

**回歸**：TS `npx vitest run`、Python `pytest test_preprocessing.py` 全綠。
