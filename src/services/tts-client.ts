import type { TtsConfig } from "../config/index";
import { getAuthHeaders } from "./auth";

const END_SILENCE_TOKEN = "<|sil_200ms|>";

export interface ZeroShotRequest {
  text: string;
  promptVoiceText: string;
  promptVoiceAssetKey: string;
  promptVoiceUrl: string;
  language?: string;
  promptLanguage?: string;
  addEndSilence?: boolean;
}

/**
 * Send a zero-shot TTS request. Returns raw WAV binary as ArrayBuffer.
 */
export async function sendZeroShotRequest(
  req: ZeroShotRequest,
  config: TtsConfig
): Promise<ArrayBuffer> {
  const authHeaders = await getAuthHeaders(
    config.zeroShotApiUrl,
    config
  );

  let text = req.text;
  if (req.language) {
    text = `<|${req.language}|>${text}`;
  }
  if (req.addEndSilence) {
    text = `${text}${END_SILENCE_TOKEN}`;
  }

  let promptText = req.promptVoiceText;
  if (req.promptLanguage) {
    promptText = `<|${req.promptLanguage}|>${promptText}`;
  }

  const payload = {
    input: {
      text,
      type: "text",
      promptVoiceUrl: req.promptVoiceUrl,
      promptVoiceAssetKey: req.promptVoiceAssetKey,
      promptText,
    },
    modelConfig: {
      model: config.modelId,
    },
    audioConfig: {
      encoding: "LINEAR16",
    },
  };

  const response = await fetch(config.zeroShotApiUrl, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Request failed with status ${response.status}: ${text}`
    );
  }

  return response.arrayBuffer();
}

export interface PresignResult {
  assetKey: string;
  formData: Record<string, string>;
}

/**
 * Get a presigned upload URL for a file.
 */
export async function presign(
  contentType: string,
  config: TtsConfig
): Promise<PresignResult> {
  const authHeaders = await getAuthHeaders(
    config.presignUrl,
    config
  );

  const response = await fetch(config.presignUrl, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contentType }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Presign request failed with status ${response.status}: ${text}`
    );
  }

  const data = await response.json();
  return {
    assetKey: data.assetKey || "",
    formData: data.formData || {},
  };
}

/**
 * Upload a prompt voice file. Returns the asset key.
 *
 * Note: Silence padding (padAudioWithSilence) is handled separately
 * by the ffmpeg-service module. Pass an already-padded File/Blob if needed.
 */
export async function uploadPromptVoice(
  file: File | Blob,
  fileName: string,
  config: TtsConfig
): Promise<string> {
  const contentType = "audio/mpeg";
  const { assetKey, formData } = await presign(contentType, config);

  const form = new FormData();
  for (const [key, value] of Object.entries(formData)) {
    form.append(key, value);
  }
  form.append("file", file, fileName);

  const response = await fetch(config.uploadUrl, {
    method: "POST",
    body: form,
  });

  if (response.status !== 204) {
    const text = await response.text();
    throw new Error(
      `Upload failed with status ${response.status}: ${text}`
    );
  }

  return assetKey;
}
