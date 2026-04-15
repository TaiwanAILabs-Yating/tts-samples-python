import { useState, useRef, useEffect } from "react";
import { useProjectStore } from "../../stores/project-store.ts";
import type { SegmentMode } from "../../utils/preprocessing.ts";

const MODEL_PRESETS = ["MasterZhengyanKaishi", "MasterZhengyanFoJing"];

const SEGMENT_MODES: { value: SegmentMode; label: string; desc: string }[] = [
  { value: "raw", label: "Raw", desc: "No splitting" },
  { value: "sentence", label: "Sentence", desc: "Split on 。！？" },
  { value: "clause", label: "Clause", desc: "Split on all punctuation" },
];

export function GenerationParams() {
  const config = useProjectStore((s) => s.config);
  const updateConfig = useProjectStore((s) => s.updateConfig);

  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node))
        setModelOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-secondary p-6 flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-text-primary">
        Generation Parameters
      </h3>
      <div className="flex gap-4">
        {/* Language */}
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">
            Language <span className="text-status-error">*</span>
          </label>
          <select
            value={config.language}
            onChange={(e) => updateConfig({ language: e.target.value })}
            className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2.5 appearance-none cursor-pointer focus:outline-none focus:border-accent-primary"
          >
            <option value="zh">國語 (zh)</option>
            <option value="nan">臺語 (nan)</option>
          </select>
        </div>

        {/* Model */}
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">
            Model <span className="text-status-error">*</span>
          </label>
          <div ref={modelRef} className="relative">
            <div className="flex items-center bg-bg-primary rounded-md border border-border-input focus-within:border-accent-primary">
              <input
                value={config.modelId}
                onChange={(e) => updateConfig({ modelId: e.target.value })}
                onFocus={() => setModelOpen(true)}
                placeholder="Select or enter model ID"
                className="flex-1 bg-transparent text-text-primary text-sm font-mono px-3 py-2.5 focus:outline-none min-w-0"
              />
              <button
                type="button"
                onClick={() => setModelOpen((v) => !v)}
                className="px-2 py-2.5 text-text-muted hover:text-text-secondary"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
            {modelOpen && (
              <ul className="absolute z-10 mt-1 w-full bg-bg-primary border border-border-input rounded-md shadow-lg max-h-48 overflow-auto">
                {MODEL_PRESETS.map((id) => (
                  <li
                    key={id}
                    onClick={() => {
                      updateConfig({ modelId: id });
                      setModelOpen(false);
                    }}
                    className={`px-3 py-2 text-sm font-mono cursor-pointer transition-colors ${
                      config.modelId === id
                        ? "bg-accent-primary/10 text-accent-primary"
                        : "text-text-primary hover:bg-bg-tertiary"
                    }`}
                  >
                    {id}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Segmentation */}
      <div className="border-t border-border-secondary pt-4 flex flex-col gap-3">
        <h4 className="text-xs font-semibold text-text-primary tracking-wide uppercase">
          Segmentation
        </h4>
        <div>
          <label className="text-xs font-medium text-text-secondary mb-2 block">
            Segment Mode
          </label>
          <div className="flex gap-2">
            {SEGMENT_MODES.map((mode) => (
              <button
                key={mode.value}
                onClick={() => updateConfig({ segmentMode: mode.value })}
                className={`flex-1 flex flex-col items-center gap-0.5 text-[13px] font-medium py-2 rounded-md border text-center transition-colors ${
                  config.segmentMode === mode.value
                    ? "bg-accent-primary/10 border-accent-primary text-accent-primary"
                    : "border-border-secondary text-text-secondary hover:bg-bg-tertiary"
                }`}
              >
                {mode.label}
                <span className="text-[10px] font-normal opacity-70">{mode.desc}</span>
              </button>
            ))}
          </div>
        </div>
        {config.segmentMode !== "raw" && (
          <div className="flex gap-4">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">
                Min Tokens
              </label>
              <input
                type="number"
                value={config.minTokens}
                onChange={(e) => updateConfig({ minTokens: parseInt(e.target.value) || 1 })}
                min={1}
                max={100}
                className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2 focus:outline-none focus:border-accent-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">
                Max Tokens
              </label>
              <input
                type="number"
                value={config.maxTokens}
                onChange={(e) => updateConfig({ maxTokens: parseInt(e.target.value) || 1 })}
                min={1}
                max={200}
                className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2 focus:outline-none focus:border-accent-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
