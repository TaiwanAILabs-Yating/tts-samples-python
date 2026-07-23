# 自動抓取 TTS Model 清單 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generation Parameters 的 Model 下拉改為自動從後端 `models:search` 抓取啟用中的 TTS model 清單，取代寫死的 `MODEL_PRESETS`。

**Architecture:** 新增純函式 `foldModelIds`（把 `...Zh`/`...Nan` 折疊回 `MasterZhengyanKaishi`，與 `resolveModelId` 對稱）、service `fetchTtsModels`（打 `models:search`、重用既有 auth）、hook `useModels`（掛載時抓、失敗退回預設）；`GenerationParams` 消費 hook 呈現下拉。

**Tech Stack:** TypeScript、React 19、Vitest（node 環境 + `fetch` mock）、Zustand（既有 store，不改動）。

## Global Constraints

- 折疊只針對已知抽象 `MasterZhengyanKaishi` + 後綴 `Zh`/`Nan`，不對任意 model 通用剝後綴。
- 不新增環境變數；models endpoint 的 base URL 由既有 `TtsConfig.zeroShotApiUrl` 推導（scheme + host）。
- `resolveModelId` 既有語言映射不得變動。
- 認證一律重用 `getAuthHeaders(url, config)`（prod：`X-Access-Token`；dev/stg2：`X-API-Key`）。
- 失敗不得擋住使用者：退回 `MODEL_PRESETS` 並保留自由輸入。
- 測試環境為 node（無 jsdom / testing-library）；hook 與 UI 不寫單元測試，只測純函式與 service。
- Model endpoint query 固定為 `state=published&status=on&type=tts`。

---

### Task 1: `foldModelIds` 純函式

**Files:**
- Modify: `src/services/tts-client.ts`（在 `resolveModelId` 下方新增 export）
- Test: `src/__tests__/tts-client.test.ts`（新增 describe 區塊）

**Interfaces:**
- Consumes: 無
- Produces: `export function foldModelIds(ids: string[]): string[]`

- [ ] **Step 1: 寫失敗測試**

在 `src/__tests__/tts-client.test.ts` 頂部 import 補上 `foldModelIds`：

```ts
import {
  sendZeroShotRequest,
  presign,
  uploadPromptVoice,
  foldModelIds,
} from "../services/tts-client";
```

在檔案末端（最後一個 `});` 之後）新增：

```ts
describe("foldModelIds", () => {
  it("folds Zh/Nan variants into MasterZhengyanKaishi and dedupes", () => {
    const input = [
      "MasterZhengyanKaishiZh",
      "MasterZhengyanKaishiNan",
      "MasterZhengyanFoJing",
      "tts-general-1.3.3",
    ];
    expect(foldModelIds(input)).toEqual([
      "MasterZhengyanKaishi",
      "MasterZhengyanFoJing",
      "tts-general-1.3.3",
    ]);
  });

  it("keeps non-variant ids unchanged", () => {
    expect(foldModelIds(["tts-general-1.3.3", "MasterZhengyanFoJing"])).toEqual([
      "tts-general-1.3.3",
      "MasterZhengyanFoJing",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(foldModelIds([])).toEqual([]);
  });

  it("folds a single variant with no sibling", () => {
    expect(foldModelIds(["MasterZhengyanKaishiZh"])).toEqual([
      "MasterZhengyanKaishi",
    ]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/__tests__/tts-client.test.ts -t foldModelIds`
Expected: FAIL —「foldModelIds is not a function」或 import 解析錯誤。

- [ ] **Step 3: 實作**

在 `src/services/tts-client.ts` 的 `resolveModelId` 函式之後新增：

```ts
/** Model IDs that resolveModelId splits MasterZhengyanKaishi into. */
const MODEL_VARIANT_SUFFIXES = ["Zh", "Nan"] as const;
const FOLDABLE_BASE = "MasterZhengyanKaishi";

/**
 * Inverse of resolveModelId for display: fold MasterZhengyanKaishi{Zh,Nan}
 * variants back into the abstract "MasterZhengyanKaishi" option, deduped and
 * order-preserving. Other model IDs pass through unchanged.
 */
export function foldModelIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const folded = MODEL_VARIANT_SUFFIXES.some(
      (suffix) => id === `${FOLDABLE_BASE}${suffix}`
    )
      ? FOLDABLE_BASE
      : id;
    if (!seen.has(folded)) {
      seen.add(folded);
      out.push(folded);
    }
  }
  return out;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/__tests__/tts-client.test.ts -t foldModelIds`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/services/tts-client.ts src/__tests__/tts-client.test.ts
git commit -m "feat: 新增 foldModelIds 折疊 Zh/Nan 變體為 MasterZhengyanKaishi"
```

---

### Task 2: `fetchTtsModels` service

**Files:**
- Create: `src/services/model-client.ts`
- Test: `src/__tests__/model-client.test.ts`

**Interfaces:**
- Consumes: `getAuthHeaders(url, config)` from `./auth`；`TtsConfig` from `../config/index`
- Produces: `export async function fetchTtsModels(config: TtsConfig): Promise<string[]>`

- [ ] **Step 1: 寫失敗測試**

建立 `src/__tests__/model-client.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConfig } from "../config/index";
import { clearTokenCache } from "../services/auth";
import { fetchTtsModels } from "../services/model-client";

describe("fetchTtsModels", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("requests models:search with the tts filters and returns item ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { id: "MasterZhengyanKaishiZh", type: "tts", status: "on" },
            { id: "MasterZhengyanKaishiNan", type: "tts", status: "on" },
            { id: "tts-general-1.3.3", type: "tts", status: "on" },
          ],
        }),
        { status: 200 }
      )
    );

    const config = getConfig({ env: "dev" });
    const ids = await fetchTtsModels(config);

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("/api/model/v2/models:search");
    expect(url).toContain("state=published");
    expect(url).toContain("status=on");
    expect(url).toContain("type=tts");

    const headers = (vi.mocked(fetch).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeTruthy();

    expect(ids).toEqual([
      "MasterZhengyanKaishiZh",
      "MasterZhengyanKaishiNan",
      "tts-general-1.3.3",
    ]);
  });

  it("returns empty array when response has no items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const config = getConfig({ env: "dev" });
    expect(await fetchTtsModels(config)).toEqual([]);
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );
    const config = getConfig({ env: "dev" });
    await expect(fetchTtsModels(config)).rejects.toThrow(
      "Model list request failed with status 403"
    );
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/__tests__/model-client.test.ts`
Expected: FAIL —「Failed to resolve import "../services/model-client"」。

- [ ] **Step 3: 實作**

建立 `src/services/model-client.ts`：

```ts
import type { TtsConfig } from "../config/index";
import { getAuthHeaders } from "./auth";
import { logger } from "../utils/logger";

const MODELS_SEARCH_QUERY = "state=published&status=on&type=tts";

/** Extract base URL (scheme + host) from a full URL. */
function getBaseUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

interface ModelItem {
  id: string;
}

/**
 * Fetch published, enabled TTS model IDs from the model service.
 * Returns raw item IDs (variant folding is applied separately by the UI).
 */
export async function fetchTtsModels(config: TtsConfig): Promise<string[]> {
  const baseUrl = getBaseUrl(config.zeroShotApiUrl);
  const url = `${baseUrl}/api/model/v2/models:search?${MODELS_SEARCH_QUERY}`;
  const authHeaders = await getAuthHeaders(url, config);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...authHeaders,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.ttsClient.error(`Model list request failed: ${response.status} ${text}`);
    throw new Error(`Model list request failed with status ${response.status}: ${text}`);
  }

  const data = await response.json();
  const items: ModelItem[] = Array.isArray(data.items) ? data.items : [];
  return items.map((item) => item.id).filter(Boolean);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/__tests__/model-client.test.ts`
Expected: PASS（3 tests）。

若 `logger.ttsClient` 不存在，先確認 `src/utils/logger.ts` 的 API：Run `grep -n "ttsClient\|export" src/utils/logger.ts`，改用實際存在的 logger 命名空間。

- [ ] **Step 5: Commit**

```bash
git add src/services/model-client.ts src/__tests__/model-client.test.ts
git commit -m "feat: 新增 fetchTtsModels 服務打 models:search"
```

---

### Task 3: `useModels` hook + 接進 GenerationParams

**Files:**
- Create: `src/hooks/useModels.ts`
- Modify: `src/components/setup/GenerationParams.tsx`

**Interfaces:**
- Consumes: `fetchTtsModels` from `../services/model-client`；`foldModelIds` from `../services/tts-client`；`getConfig` from `../config/index`
- Produces: `export function useModels(): { models: string[]; loading: boolean; error: boolean }`

- [ ] **Step 1: 建立 hook**

建立 `src/hooks/useModels.ts`：

```ts
import { useEffect, useState } from "react";
import { getConfig } from "../config/index.ts";
import { fetchTtsModels } from "../services/model-client.ts";
import { foldModelIds } from "../services/tts-client.ts";
import { logger } from "../utils/logger.ts";

/** Fallback list used when the model service is unavailable. */
export const MODEL_PRESETS = ["MasterZhengyanKaishi", "MasterZhengyanFoJing"];

/**
 * Load the enabled TTS model list on mount. On failure, falls back to
 * MODEL_PRESETS so the Model selector always has options.
 */
export function useModels() {
  const [models, setModels] = useState<string[]>(MODEL_PRESETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = await fetchTtsModels(getConfig());
        const folded = foldModelIds(ids);
        if (!cancelled) {
          setModels(folded.length > 0 ? folded : MODEL_PRESETS);
          setError(false);
        }
      } catch (err) {
        logger.ttsClient.error(`Failed to load model list: ${err}`);
        if (!cancelled) {
          setModels(MODEL_PRESETS);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, error };
}
```

- [ ] **Step 2: 接進 GenerationParams**

在 `src/components/setup/GenerationParams.tsx`：

移除頂部寫死的常數（第 5 行）：

```ts
const MODEL_PRESETS = ["MasterZhengyanKaishi", "MasterZhengyanFoJing"];
```

在 import 區新增：

```ts
import { useModels } from "../../hooks/useModels.ts";
```

在元件內、`modelRef` 宣告附近新增：

```ts
  const { models, loading: modelsLoading, error: modelsError } = useModels();
```

把下拉清單區塊（`{modelOpen && ( ... )}` 內的 `<ul>`）改為：

```tsx
{modelOpen && (
  <ul className="absolute z-10 mt-1 w-full bg-bg-primary border border-border-input rounded-md shadow-lg max-h-48 overflow-auto">
    {modelsError && (
      <li className="px-3 py-2 text-xs text-status-error">
        無法載入 model 清單，使用預設
      </li>
    )}
    {modelsLoading ? (
      <li className="px-3 py-2 text-sm text-text-muted">Loading models…</li>
    ) : (
      models.map((id) => (
        <li
          key={id}
          onClick={() => {
            updateConfig({ modelId: id });
            setModelOpen(false);
          }}
          className={`px-3 py-2 text-sm font-mono cursor-pointer transition-colors ${
            config.modelId === id
              ? "bg-accent-primary/10 text-accent-primary"
              : "text-text-primary hover:bg-bg-tertiary"
          }`}
        >
          {id}
        </li>
      ))
    )}
  </ul>
)}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc -b`
Expected: exit 0（無錯誤；確認 `MODEL_PRESETS` 舊常數已無殘留引用）。

- [ ] **Step 4: 全測試回歸**

Run: `npx vitest run`
Expected: 全數 PASS（含 Task 1、Task 2 新增測試）。

- [ ] **Step 5: 手動驗證（build）**

Run: `npm run build`
Expected: build 成功。dev server 手動確認 Model 下拉展開時：dev 環境會 fetch 失敗 → 顯示「無法載入…」並列出預設；prod（tcufedgpt env）→ 列出 `MasterZhengyanKaishi`、`MasterZhengyanFoJing`、`tts-general-1.3.3`。

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useModels.ts src/components/setup/GenerationParams.tsx
git commit -m "feat: Generation Parameters model 下拉改為自動抓取清單"
```

---

## Self-Review

**Spec coverage:**
- 動態抓 `models:search`（type=tts/status=on/state=published）→ Task 2 ✓
- Zh/Nan 折疊回 MasterZhengyanKaishi → Task 1 ✓
- hook 掛載時抓、失敗退回 MODEL_PRESETS → Task 3 ✓
- 保留自由輸入 combobox → Task 3 只改 `<ul>` 選項來源，`<input>` 不動 ✓
- 重用 getAuthHeaders → Task 2 ✓
- 不新增 env 變數、base URL 由 zeroShotApiUrl 推導 → Task 2 ✓
- resolveModelId 不變 → 無任何 task 觸碰 ✓
- 測試聚焦 fetchTtsModels 與 foldModelIds → Task 1、2 ✓

**Placeholder scan:** 無 TBD/TODO；每個 code step 皆有完整程式碼。

**Type consistency:** `fetchTtsModels(config: TtsConfig): Promise<string[]>`、`foldModelIds(ids: string[]): string[]`、`useModels(): { models, loading, error }` 三者在各 task 間簽名一致；`MODEL_PRESETS` 由 Task 3 的 hook 提供，同時移除 GenerationParams 舊常數避免重名。
