import { useProjectStore } from "../../stores/project-store.ts";
import type { SegmentMode } from "../../utils/preprocessing.ts";

const SEGMENT_MODES: { value: SegmentMode; label: string; desc: string }[] = [
  { value: "raw", label: "Raw", desc: "No splitting" },
  { value: "sentence", label: "Sentence", desc: "Split on 。！？" },
  { value: "clause", label: "Clause", desc: "Split on all punctuation" },
];

export function GenerationParams() {
  const config = useProjectStore((s) => s.config);
  const updateConfig = useProjectStore((s) => s.updateConfig);

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
            <option value="en">English (en)</option>
          </select>
        </div>

        {/* Model */}
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary">
            Model <span className="text-status-error">*</span>
          </label>
          <input
            list="model-options"
            value={config.modelId}
            onChange={(e) => updateConfig({ modelId: e.target.value })}
            placeholder="Select or enter model ID"
            className="bg-bg-primary text-text-primary text-sm font-mono rounded-md border border-border-input px-3 py-2.5 focus:outline-none focus:border-accent-primary"
          />
          <datalist id="model-options">
            <option value="MasterZhengyanKaishi" />
            <option value="MasterZhengyanFoJing" />
          </datalist>
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
