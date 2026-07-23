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
