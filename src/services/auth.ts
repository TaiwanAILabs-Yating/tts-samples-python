import type { TtsConfig } from "../config/index";

/** Cached token for prod environment. */
let cachedToken: string | null = null;

/**
 * Extract base URL (scheme + host) from a full URL.
 */
function getBaseUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Login to prod environment and obtain X-Access-Token.
 * Uses a simple cache to avoid duplicate logins.
 */
async function loginForToken(
  baseUrl: string,
  config: TtsConfig
): Promise<string> {
  if (cachedToken !== null) {
    return cachedToken;
  }

  const loginUrl = `${baseUrl}/api/auth/v2/fedgpt/login`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authKey: config.authKey,
      authSecret: config.authSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Login failed with status ${response.status}: ${text}`
    );
  }

  const data = await response.json();
  const token = data.token;
  if (!token) {
    throw new Error(
      `No token in login response: ${JSON.stringify(data)}`
    );
  }

  cachedToken = token;
  return token;
}

/**
 * Get appropriate auth headers based on environment.
 * - dev/stg2: X-API-Key header
 * - prod: X-Access-Token from login API
 */
export async function getAuthHeaders(
  apiUrl: string,
  config: TtsConfig
): Promise<Record<string, string>> {
  if (config.env === "prod") {
    const baseUrl = getBaseUrl(apiUrl);
    const token = await loginForToken(baseUrl, config);
    return { "X-Access-Token": token };
  }
  return { "X-API-Key": config.apiKey };
}

/**
 * Clear the cached auth token.
 */
export function clearTokenCache(): void {
  cachedToken = null;
}
