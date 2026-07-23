export interface TtsConfig {
  env: "dev" | "stg2" | "prod";
  apiKey: string;
  zeroShotApiUrl: string;
  presignUrl: string;
  uploadUrl: string;
  modelId: string;
  authKey: string;
  authSecret: string;
}

const defaults: TtsConfig = {
  env: "dev",
  apiKey: "fedgpt-api-key",
  zeroShotApiUrl:
    "https://ent.fedgpt.cc/api/asura/v1/speeches:zero-shot",
  presignUrl:
    "https://ent.fedgpt.cc/api/asura/v1/transcriptions:presign",
  uploadUrl: "https://ent.fedgpt.cc/asset/",
  modelId: "MasterZhengyanKaishi",
  authKey: "fedgpt",
  authSecret: "",
};

/**
 * Build TtsConfig from Vite env vars with defaults.
 * Priority: runtime overrides > env vars > defaults.
 */
export function getConfig(
  overrides?: Partial<TtsConfig>
): TtsConfig {
  // In Vite environment, import.meta.env.VITE_* is available.
  // In non-Vite environments (test, Node), fall back to defaults.
  const envVars =
    typeof import.meta !== "undefined" &&
    import.meta.env
      ? import.meta.env
      : ({} as Record<string, string | undefined>);

  const fromEnv: Partial<TtsConfig> = {
    ...(envVars.VITE_ENV && {
      env: envVars.VITE_ENV as TtsConfig["env"],
    }),
    ...(envVars.VITE_API_KEY && { apiKey: envVars.VITE_API_KEY }),
    ...(envVars.VITE_ZERO_SHOT_API_URL && {
      zeroShotApiUrl: envVars.VITE_ZERO_SHOT_API_URL,
    }),
    ...(envVars.VITE_PRESIGN_URL && {
      presignUrl: envVars.VITE_PRESIGN_URL,
    }),
    ...(envVars.VITE_UPLOAD_URL && {
      uploadUrl: envVars.VITE_UPLOAD_URL,
    }),
    // modelId is not env-configurable: the UI (project store) always supplies
    // config.modelId and overrides the default, so a VITE_MODEL_ID here would
    // never be observed. Keep it out of fromEnv.
    ...(envVars.VITE_AUTH_KEY && { authKey: envVars.VITE_AUTH_KEY }),
    ...(envVars.VITE_AUTH_SECRET && {
      authSecret: envVars.VITE_AUTH_SECRET,
    }),
  };

  return { ...defaults, ...fromEnv, ...overrides };
}
