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
