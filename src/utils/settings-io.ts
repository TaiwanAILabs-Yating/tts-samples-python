import type { ProjectConfig } from "../stores/project-store";

interface SettingsExport {
  version: number;
  exportedAt: string;
  promptVoice: string | null;
  promptVoiceFileName: string;
  promptVoiceText: string;
  language: string;
  promptLanguage: string;
  modelId: string;
  segmentMode: string;
  minTokens: number;
  maxTokens: number;
  addEndSilence: boolean;
  concurrency: number;
  maxRetries: number;
  retryBaseDelay: number;
  crossfadeDuration: number;
  fadeCurve: string;
  startSilence: number;
  endSilence: number;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip "data:...;base64," prefix
      resolve(dataUrl.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType = "audio/wav"): Blob {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    buffer[i] = bytes.charCodeAt(i);
  }
  return new Blob([buffer], { type: mimeType });
}

export async function exportSettings(config: ProjectConfig): Promise<void> {
  let promptVoice: string | null = null;
  if (config.promptVoiceFile) {
    promptVoice = await blobToBase64(config.promptVoiceFile);
  }

  const data: SettingsExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    promptVoice,
    promptVoiceFileName: config.promptVoiceFileName ?? "",
    promptVoiceText: config.promptVoiceText,
    language: config.language,
    promptLanguage: config.promptLanguage,
    modelId: config.modelId,
    segmentMode: config.segmentMode,
    minTokens: config.minTokens,
    maxTokens: config.maxTokens,
    addEndSilence: config.addEndSilence,
    concurrency: config.concurrency,
    maxRetries: config.maxRetries,
    retryBaseDelay: config.retryBaseDelay,
    crossfadeDuration: config.crossfadeDuration,
    fadeCurve: config.fadeCurve,
    startSilence: config.startSilence,
    endSilence: config.endSilence,
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `tts-settings-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSettings(file: File): Promise<Partial<ProjectConfig>> {
  const text = await file.text();
  const data: SettingsExport = JSON.parse(text);

  if (!data.version || data.version > 1) {
    throw new Error(`Unsupported settings version: ${data.version}`);
  }

  const result: Partial<ProjectConfig> = {
    promptVoiceText: data.promptVoiceText,
    language: data.language,
    promptLanguage: data.promptLanguage,
    modelId: data.modelId,
    promptVoiceFileName: data.promptVoiceFileName || undefined,
  };

  if (data.segmentMode != null) result.segmentMode = data.segmentMode as ProjectConfig["segmentMode"];
  if (data.minTokens != null) result.minTokens = data.minTokens;
  if (data.maxTokens != null) result.maxTokens = data.maxTokens;
  if (data.addEndSilence != null) result.addEndSilence = data.addEndSilence;
  if (data.concurrency != null) result.concurrency = data.concurrency;
  if (data.maxRetries != null) result.maxRetries = data.maxRetries;
  if (data.retryBaseDelay != null) result.retryBaseDelay = data.retryBaseDelay;
  if (data.crossfadeDuration != null) result.crossfadeDuration = data.crossfadeDuration;
  if (data.fadeCurve != null) result.fadeCurve = data.fadeCurve as ProjectConfig["fadeCurve"];
  if (data.startSilence != null) result.startSilence = data.startSilence;
  if (data.endSilence != null) result.endSilence = data.endSilence;

  if (data.promptVoice) {
    result.promptVoiceFile = base64ToBlob(data.promptVoice);
  }

  return result;
}
