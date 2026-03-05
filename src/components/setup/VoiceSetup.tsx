import { useRef, useState, useCallback, useEffect } from "react";
import { useProjectStore } from "../../stores/project-store.ts";

export function VoiceSetup() {
  const config = useProjectStore((s) => s.config);
  const updateConfig = useProjectStore((s) => s.updateConfig);
  const projectName = useProjectStore((s) => s.projectName);
  const setProjectName = useProjectStore((s) => s.setProjectName);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Create object URL when file changes
  useEffect(() => {
    if (config.promptVoiceFile) {
      const url = URL.createObjectURL(config.promptVoiceFile);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setAudioUrl(null);
    setAudioDuration(null);
    setIsPlaying(false);
  }, [config.promptVoiceFile]);

  const handleAudioLoaded = useCallback(() => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleAudioEnded = useCallback(() => setIsPlaying(false), []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}s`;
  };

  const handleFile = useCallback(
    (file: File) => {
      updateConfig({
        promptVoiceFile: file,
        promptVoiceFileName: file.name,
      });
    },
    [updateConfig],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.type.includes("audio") || /\.(wav|mp3)$/i.test(file.name))) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  return (
    <section className="flex flex-col gap-6 flex-1">
      {/* Title */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text-primary">
          Voice Clone Setup
        </h1>
        <p className="text-sm text-text-secondary">
          Upload a reference voice and configure prompt settings
        </p>
      </div>

      {/* Project Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-primary">
          Project Name <span className="text-status-error">*</span>
        </label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Enter project name..."
          className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2.5 placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
        />
      </div>

      {/* Upload Area Card */}
      <div className="bg-bg-secondary rounded-lg border border-border-secondary p-6 flex flex-col gap-4">
        <label className="text-sm font-medium text-text-primary">
          Prompt Voice Audio <span className="text-status-error">*</span>
        </label>

        {/* Drop Zone */}
        <div
          className={`flex flex-col items-center justify-center gap-2 h-[120px] rounded-lg border border-dashed transition-colors cursor-pointer ${
            isDragging
              ? "border-accent-primary bg-accent-primary/10"
              : "border-border-input hover:border-text-muted"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            className="w-8 h-8 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
            <path d="M12 12v9" />
            <path d="m16 16-4-4-4 4" />
          </svg>
          <span className="text-sm text-text-secondary">
            Drag & drop WAV or MP3 file here
          </span>
          <span className="text-xs text-accent-primary">or click to browse</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.mp3,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>

        {/* Wave Preview (shown when file is selected) */}
        {config.promptVoiceFileName && (
          <div className="flex items-center gap-3 bg-bg-primary rounded-md px-3 py-2 h-12">
            {audioUrl && (
              <audio
                ref={audioRef}
                src={audioUrl}
                onLoadedMetadata={handleAudioLoaded}
                onEnded={handleAudioEnded}
              />
            )}
            <button
              onClick={togglePlay}
              className="w-7 h-7 rounded-full bg-accent-primary flex items-center justify-center shrink-0 hover:bg-accent-hover transition-colors"
            >
              {isPlaying ? (
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="w-3 h-3 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
            <span className="text-xs font-mono text-text-primary truncate">
              {config.promptVoiceFileName}
            </span>
            <span className="text-xs font-mono text-text-muted ml-auto shrink-0">
              {audioDuration != null ? formatDuration(audioDuration) : "--:--"}
            </span>
          </div>
        )}

        {/* Prompt Language */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">
            Prompt Language <span className="text-status-error">*</span>
          </label>
          <select
            value={config.promptLanguage}
            onChange={(e) => updateConfig({ promptLanguage: e.target.value })}
            className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2.5 appearance-none cursor-pointer focus:outline-none focus:border-accent-primary"
          >
            <option value="zh">國語 (zh)</option>
            <option value="nan">臺語 (nan)</option>
            <option value="en">English (en)</option>
          </select>
        </div>
      </div>

      {/* Prompt Text */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-medium text-text-primary">
            Prompt Text <span className="text-status-error">*</span>
          </label>
          <span className="text-[11px] text-status-error">Required</span>
        </div>
        <textarea
          value={config.promptVoiceText}
          onChange={(e) => updateConfig({ promptVoiceText: e.target.value })}
          placeholder="Enter the transcript of the prompt voice audio..."
          className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2.5 h-20 resize-none placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
        />
      </div>

    </section>
  );
}
