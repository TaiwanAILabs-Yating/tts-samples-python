import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConfig, type TtsConfig } from "../config/index";
import { getAuthHeaders, clearTokenCache } from "../services/auth";
import {
  sendZeroShotRequest,
  presign,
  uploadPromptVoice,
} from "../services/tts-client";

// --- Config tests ---

describe("getConfig", () => {
  it("returns defaults when no overrides", () => {
    const config = getConfig();
    expect(config.env).toBe("dev");
    expect(config.apiKey).toBe("fedgpt-api-key");
    expect(config.zeroShotApiUrl).toContain("speeches:zero-shot");
    expect(config.presignUrl).toContain("transcriptions:presign");
    expect(config.uploadUrl).toContain("/asset/");
    expect(config.modelId).toBe("tts-general-1.2.2");
    expect(config.authKey).toBe("fedgpt");
    expect(config.authSecret).toBe("");
  });

  it("applies runtime overrides", () => {
    const config = getConfig({ env: "prod", modelId: "tts-custom-1.0" });
    expect(config.env).toBe("prod");
    expect(config.modelId).toBe("tts-custom-1.0");
    // Other defaults preserved
    expect(config.apiKey).toBe("fedgpt-api-key");
  });
});

// --- Auth tests ---

describe("getAuthHeaders", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("returns X-API-Key for dev environment", async () => {
    const config = getConfig({ env: "dev" });
    const headers = await getAuthHeaders(config.zeroShotApiUrl, config);
    expect(headers).toEqual({ "X-API-Key": "fedgpt-api-key" });
  });

  it("returns X-API-Key for stg2 environment", async () => {
    const config = getConfig({ env: "stg2" });
    const headers = await getAuthHeaders(config.zeroShotApiUrl, config);
    expect(headers).toEqual({ "X-API-Key": "fedgpt-api-key" });
  });

  it("calls login API for prod environment", async () => {
    const mockToken = "test-token-123";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ token: mockToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config = getConfig({
      env: "prod",
      authKey: "test-key",
      authSecret: "test-secret",
    });
    const headers = await getAuthHeaders(config.zeroShotApiUrl, config);

    expect(headers).toEqual({ "X-Access-Token": mockToken });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/v2/fedgpt/login"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("caches token for prod environment", async () => {
    const mockToken = "cached-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ token: mockToken }), { status: 200 })
    );

    const config = getConfig({ env: "prod" });

    // First call - fetches token
    await getAuthHeaders(config.zeroShotApiUrl, config);
    // Second call - should use cache
    const headers = await getAuthHeaders(config.zeroShotApiUrl, config);

    expect(headers).toEqual({ "X-Access-Token": mockToken });
    expect(fetch).toHaveBeenCalledTimes(1); // Only one login call
  });

  it("throws on login failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const config = getConfig({ env: "prod" });
    await expect(
      getAuthHeaders(config.zeroShotApiUrl, config)
    ).rejects.toThrow("Login failed with status 401");
  });
});

// --- TTS Client tests ---

describe("sendZeroShotRequest", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("sends correct payload structure", async () => {
    const wavData = new ArrayBuffer(100);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(wavData, { status: 200 })
    );

    const config = getConfig();
    await sendZeroShotRequest(
      {
        text: "你好世界",
        promptVoiceText: "參考文字",
        promptVoiceAssetKey: "asset-123",
        promptVoiceUrl: "",
      },
      config
    );

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("speeches:zero-shot");
    const body = JSON.parse(options!.body as string);
    expect(body.input.text).toBe("你好世界");
    expect(body.input.promptText).toBe("參考文字");
    expect(body.input.promptVoiceAssetKey).toBe("asset-123");
    expect(body.modelConfig.model).toBe("tts-general-1.2.2");
    expect(body.audioConfig.encoding).toBe("LINEAR16");
  });

  it("prepends language tag when specified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new ArrayBuffer(0), { status: 200 })
    );

    const config = getConfig();
    await sendZeroShotRequest(
      {
        text: "你好",
        promptVoiceText: "參考",
        promptVoiceAssetKey: "",
        promptVoiceUrl: "",
        language: "nan",
      },
      config
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string
    );
    expect(body.input.text).toBe("<|nan|>你好");
  });

  it("appends end silence token when specified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new ArrayBuffer(0), { status: 200 })
    );

    const config = getConfig();
    await sendZeroShotRequest(
      {
        text: "你好",
        promptVoiceText: "參考",
        promptVoiceAssetKey: "",
        promptVoiceUrl: "",
        addEndSilence: true,
      },
      config
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string
    );
    expect(body.input.text).toBe("你好<|sil_200ms|>");
  });

  it("prepends prompt language tag when specified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new ArrayBuffer(0), { status: 200 })
    );

    const config = getConfig();
    await sendZeroShotRequest(
      {
        text: "你好",
        promptVoiceText: "參考",
        promptVoiceAssetKey: "",
        promptVoiceUrl: "",
        promptLanguage: "nan",
      },
      config
    );

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string
    );
    expect(body.input.promptText).toBe("<|nan|>參考");
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    const config = getConfig();
    await expect(
      sendZeroShotRequest(
        {
          text: "test",
          promptVoiceText: "",
          promptVoiceAssetKey: "",
          promptVoiceUrl: "",
        },
        config
      )
    ).rejects.toThrow("Request failed with status 500");
  });
});

describe("presign", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("returns assetKey and formData", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          assetKey: "key-123",
          formData: { field1: "val1" },
        }),
        { status: 200 }
      )
    );

    const config = getConfig();
    const result = await presign("audio/mpeg", config);

    expect(result.assetKey).toBe("key-123");
    expect(result.formData).toEqual({ field1: "val1" });
  });

  it("throws on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 })
    );

    const config = getConfig();
    await expect(presign("audio/mpeg", config)).rejects.toThrow(
      "Presign request failed with status 400"
    );
  });
});

describe("uploadPromptVoice", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("uploads file with presigned form data", async () => {
    // First call: presign
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assetKey: "uploaded-key",
            formData: { policy: "abc", signature: "xyz" },
          }),
          { status: 200 }
        )
      )
      // Second call: upload
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const config = getConfig();
    const file = new Blob(["audio data"], { type: "audio/mpeg" });
    const assetKey = await uploadPromptVoice(
      file,
      "test.mp3",
      config
    );

    expect(assetKey).toBe("uploaded-key");
    expect(fetch).toHaveBeenCalledTimes(2);

    // Verify upload call used FormData
    const uploadCall = vi.mocked(fetch).mock.calls[1];
    expect(uploadCall[0]).toContain("/asset/");
    expect(uploadCall[1]!.body).toBeInstanceOf(FormData);
  });

  it("throws on non-204 upload response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ assetKey: "key", formData: {} }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 })
      );

    const config = getConfig();
    const file = new Blob(["data"]);
    await expect(
      uploadPromptVoice(file, "test.mp3", config)
    ).rejects.toThrow("Upload failed with status 403");
  });
});
