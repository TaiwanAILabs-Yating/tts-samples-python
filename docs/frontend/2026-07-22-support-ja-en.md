# 支援日文 (ja)、英文 (en)

> 日期：2026-07-22

## 需求

新增兩個語言選項：
- `ja`（日文）
- `en`（英文）

兩者的 model 都**暫時共用** `MasterZhengyanKaishiZh`（尚無專屬 model）。
文字語言標籤 `<|...|>` 仍使用實際選取的語言（`<|ja|>` / `<|en|>`），不改成 zh。

---

## 已實作

### `src/services/tts-client.ts`

`resolveModelId(modelId, language)` 新增映射：

| modelId | language | 實際送出 model |
|---------|----------|---------------|
| MasterZhengyanKaishi | zh | MasterZhengyanKaishiZh |
| MasterZhengyanKaishi | nan | MasterZhengyanKaishiNan |
| MasterZhengyanKaishi | ja | MasterZhengyanKaishiZh（暫時） |
| MasterZhengyanKaishi | en | MasterZhengyanKaishiZh（暫時） |
| 其他 model | 任何 | 不變 |

文字/prompt 前的語言標籤沿用既有邏輯（`<|${language}|>`），故 ja/en 會送出 `<|ja|>` / `<|en|>`，不因 model 共用而改變。

### `src/components/setup/GenerationParams.tsx`

Language 下拉新增 `<option value="ja">日文 (ja)</option>`、`<option value="en">英文 (en)</option>`。

### `src/components/setup/VoiceSetup.tsx`

Prompt Language 下拉新增相同兩個選項。

---

## 備註

待 ja/en 專屬 model 上線後，只需更新 `resolveModelId` 的映射即可。
