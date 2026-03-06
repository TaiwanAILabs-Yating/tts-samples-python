type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

function createLogger(module: string): Logger {
  const prefix = `[${module}]`;
  return {
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

export const logger = {
  ffmpeg: createLogger("ffmpeg"),
  orchestrator: createLogger("orchestrator"),
  ttsClient: createLogger("tts-client"),
  generation: createLogger("generation"),
};
