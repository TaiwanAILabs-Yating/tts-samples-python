# 自動抓取 TTS Model 清單呈現在 Generation Parameters

> 日期：2026-07-23
> 分支：`feat/auto-fetch-models`（基於 develop）

## 背景 / 問題

Generation Parameters 的 Model 欄位目前是一個 combobox：自由輸入的 `<input>` 加上一個**寫死**的下拉清單。

```ts
// src/components/setup/GenerationParams.tsx:5
const MODEL_PRESETS = ["MasterZhengyanKaishi", "MasterZhengyanFoJing"];
```

寫死清單容易與後端實際可用的 model 脫節。希望改成自動從後端 `models:search` 抓取「啟用中的 TTS model」呈現在下拉裡。

## 目標

- Model 下拉的選項來源，從寫死的 `MODEL_PRESETS` 改為呼叫 `models:search` 動態取得。
- 篩選條件：`type=tts`、`status=on`、`state=published`。
- 抓到的清單中，Kaishi 的 `Zh` / `Nan` 變體**折疊**回抽象代號 `MasterZhengyanKaishi`，語言驅動 Zh/Nan 的既有機制（`resolveModelId`）維持不變。
- 保留 combobox 的自由輸入能力（可輸入清單外的 id）。

## 非目標（YAGNI）

- 不加手動 refresh 按鈕（僅在元件掛載時抓一次）。
- 不改動 `resolveModelId` 的既有語言映射邏輯。
- 不做 model 的收藏 / 排序 / 搜尋框等進階 UI。

---

## 架構與元件

### 1. Service：`fetchTtsModels(config)`

新檔 `src/services/model-client.ts`。

- 由既有 config 推導 base URL（scheme + host，方式比照 [auth.ts](../../../src/services/auth.ts) 的 `getBaseUrl`），組出：
  `GET {baseUrl}/api/model/v2/models:search?state=published&status=on&type=tts`
- 認證重用 `getAuthHeaders(url, config)`（prod 走 login 換 `X-Access-Token`、dev/stg2 走 `X-API-Key`）。
- 解析回應 `items[]`，回傳 `items.map(i => i.id)` 型別為 `string[]`。
- 非 200 時 `throw`（與 `tts-client` 一致的錯誤處理風格）。

回應結構（實測 tcufedgpt 得到）：

```json
{ "items": [ { "id": "MasterZhengyanKaishiZh", "type": "tts", "status": "on", "state": "published", ... } ] }
```

只取用 `id` 欄位；其餘欄位目前不需要。

### 2. 折疊邏輯：`foldModelIds(ids)`

放在 [src/services/tts-client.ts](../../../src/services/tts-client.ts)，與 `resolveModelId` 互為反向操作、同處管理。

- 已知變體後綴常數 `MODEL_VARIANT_SUFFIXES = ["Zh", "Nan"]`（對齊 `resolveModelId` 產生的變體）。
- 對每個 id：若以 `MasterZhengyanKaishi` + 已知後綴 完全相符 → 收合為 base `MasterZhengyanKaishi`；否則原樣保留。
- 結果去重、維持原順序。

範例：

| 輸入（API items[].id） | 輸出（下拉選項） |
|------------------------|------------------|
| `MasterZhengyanKaishiZh` | `MasterZhengyanKaishi` |
| `MasterZhengyanKaishiNan` | （與上者去重，同一項） |
| `MasterZhengyanFoJing` | `MasterZhengyanFoJing` |
| `tts-general-1.3.3` | `tts-general-1.3.3` |

> 折疊只針對 `MasterZhengyanKaishi` 這個已知抽象（與 `resolveModelId` 對稱），不對任意 model 做通用後綴剝除，避免誤折不相關的 model。

### 3. Hook：`useModels()`

新檔 `src/hooks/useModels.ts`，仿既有 [useLexicon.ts](../../../src/hooks/useLexicon.ts) 的形態。

- 內部狀態：`models: string[]`、`loading: boolean`、`error: boolean`。
- 掛載時（`useEffect`）呼叫 `fetchTtsModels(getConfig())` → `foldModelIds(...)` → 設進 `models`。
- 成功：`models` = 折疊後清單，`loading=false`，`error=false`。
- 失敗：`error=true`、`loading=false`，`models` 退回既有 `MODEL_PRESETS` 作為後備。
- 回傳 `{ models, loading, error }`。

### 4. UI：`GenerationParams`

- 以 `useModels()` 取得下拉選項來源，取代寫死的 `MODEL_PRESETS.map(...)`。
- 下拉狀態呈現：
  - `loading` → 下拉內顯示一列「Loading models…」。
  - `error` → 下拉頂部顯示一行小提示（如「無法載入 model 清單，使用預設」），清單退回 `MODEL_PRESETS`。
  - 成功 → 列出折疊後的 model id。
- **保留**現有自由輸入 `<input>`（可輸入清單外 id）與點擊外部關閉的行為，不變動。

---

## 資料流

```
掛載 GenerationParams
  → useModels()
    → fetchTtsModels(getConfig())
        → getAuthHeaders() 取得認證 header
        → GET .../models:search?state=published&status=on&type=tts
        → items[].id  (string[])
    → foldModelIds(ids)   // Zh/Nan → MasterZhengyanKaishi
  → 下拉呈現折疊後清單
使用者選取 base id（或自由輸入）→ config.modelId
送 TTS 請求時 → resolveModelId(config.modelId, language) 換回實際變體
```

## 錯誤處理

| 情境 | 行為 |
|------|------|
| fetch 網路失敗 / 逾時 | `error=true`，退回 `MODEL_PRESETS`，顯示小提示；自由輸入照常 |
| 非 200（權限不足 / 404） | 同上 |
| 回應 JSON 無 `items` | 視為空清單 → 退回 `MODEL_PRESETS` |
| dev 環境無此 endpoint | 由上述任一分支覆蓋，不影響既有操作 |

失敗一律「不擋住使用者」：自由輸入 + 預設清單保底。

## 測試

- `fetchTtsModels`（mock `fetch`）：
  - 正常：驗證 request URL 含 `models:search` 與 query（`state=published&status=on&type=tts`）、帶正確 auth header；回傳解析後的 id 陣列。
  - 非 200：`rejects`。
- `foldModelIds`（純函式單元測試）：
  - `Zh`/`Nan` 折疊成 `MasterZhengyanKaishi` 並去重。
  - 非變體 id（`MasterZhengyanFoJing`、`tts-general-1.3.3`）原樣保留。
  - 空陣列 → 空陣列。
- （選配）`useModels` / `GenerationParams`：成功列出清單、失敗退回預設。若既有測試基建不含 React 元件測試則略過，以前二者為主。

## 對既有程式的影響

- `resolveModelId`：不變。
- `MODEL_PRESETS`：保留作為後備清單（不再是唯一來源）。
- 不新增環境變數（base URL 由既有 config 推導）。
