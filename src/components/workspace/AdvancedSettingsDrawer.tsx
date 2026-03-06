import { useProjectStore } from "../../stores/project-store.ts";
import type { FadeCurve } from "../../services/ffmpeg-service.ts";

const FADE_CURVES: { value: FadeCurve; label: string }[] = [
  { value: "tri", label: "Triangular (tri)" },
  { value: "qsin", label: "Quarter Sine (qsin)" },
  { value: "hsin", label: "Half Sine (hsin)" },
  { value: "log", label: "Logarithmic (log)" },
  { value: "exp", label: "Exponential (exp)" },
];

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-accent-primary">{icon}</span>
      <span className="text-sm font-semibold text-text-primary">{label}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-bg-secondary" />;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <label className="text-xs font-medium text-text-secondary">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="w-full bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2 focus:outline-none focus:border-accent-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="text-xs text-text-muted shrink-0">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-text-primary">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
          checked ? "bg-accent-primary" : "bg-border-secondary"
        }`}
      >
        <div
          className={`w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  formatValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue?: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-secondary">{label}</label>
        <span className="text-xs font-mono text-text-primary">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent-primary"
      />
    </div>
  );
}

export function AdvancedSettingsDrawer() {
  const isOpen = useProjectStore((s) => s.isSettingsOpen);
  const setOpen = useProjectStore((s) => s.setSettingsOpen);
  const config = useProjectStore((s) => s.config);
  const updateConfig = useProjectStore((s) => s.updateConfig);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Dimmed overlay */}
      <div
        className="flex-1 bg-bg-primary/60"
        onClick={() => setOpen(false)}
      />

      {/* Drawer */}
      <aside className="w-[420px] bg-bg-nav border-l border-border flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-base font-semibold text-text-primary">
            Advanced Settings
          </span>
          <button
            onClick={() => setOpen(false)}
            className="w-5 h-5 text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
          {/* --- Audio Generation --- */}
          <section className="flex flex-col gap-3">
            <SectionTitle
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 10v3" /><path d="M6 6v11" /><path d="M10 3v18" /><path d="M14 8v7" /><path d="M18 5v13" /><path d="M22 10v3" />
                </svg>
              }
              label="Audio Generation"
            />
            <Toggle
              label="Add End Silence Token"
              checked={config.addEndSilence}
              onChange={(v) => updateConfig({ addEndSilence: v })}
            />
            <div className="flex gap-4">
              <NumberField
                label="Max Parallel"
                value={config.concurrency}
                onChange={(v) => updateConfig({ concurrency: v })}
                min={1}
                max={20}
                step={1}
              />
              <NumberField
                label="Max Retries"
                value={config.maxRetries}
                onChange={(v) => updateConfig({ maxRetries: v })}
                min={0}
                max={10}
                step={1}
              />
            </div>
            <NumberField
              label="Retry Base Delay"
              value={config.retryBaseDelay}
              onChange={(v) => updateConfig({ retryBaseDelay: v })}
              min={0.1}
              max={10}
              step={0.1}
              suffix="s"
            />
          </section>

          <Divider />

          {/* --- Silence Padding --- */}
          <section className="flex flex-col gap-3">
            <SectionTitle
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 9a5 5 0 0 1-6 0" /><path d="M2 2l20 20" /><path d="M11 5V3a1 1 0 0 1 2 0v2" /><path d="M19 13c0-1.3-.6-2.5-1.5-3.5" /><path d="M6.5 9.5C5.6 10.5 5 11.7 5 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1" /><path d="M8 21h8" /><path d="M12 17v4" />
                </svg>
              }
              label="Silence Padding"
            />
            <p className="text-xs text-text-muted">
              Add silence padding before and after the prompt voice audio.
            </p>
            <SliderField
              label="Prompt Start Silence"
              value={config.startSilence}
              onChange={(v) => updateConfig({ startSilence: v })}
              min={0}
              max={1}
              step={0.05}
              formatValue={(v) => `${v.toFixed(2)}s`}
            />
            <SliderField
              label="Prompt End Silence"
              value={config.endSilence}
              onChange={(v) => updateConfig({ endSilence: v })}
              min={0}
              max={1}
              step={0.05}
              formatValue={(v) => `${v.toFixed(2)}s`}
            />
          </section>

          <Divider />

          {/* --- Crossfade --- */}
          <section className="flex flex-col gap-3">
            <SectionTitle
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="12" r="7" /><circle cx="15" cy="12" r="7" />
                </svg>
              }
              label="Crossfade"
            />
            <SliderField
              label="Duration"
              value={config.crossfadeDuration}
              onChange={(v) => updateConfig({ crossfadeDuration: v })}
              min={0}
              max={0.2}
              step={0.005}
              formatValue={(v) => `${v.toFixed(3)}s`}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">
                Curve Type
              </label>
              <select
                value={config.fadeCurve}
                onChange={(e) =>
                  updateConfig({ fadeCurve: e.target.value as FadeCurve })
                }
                className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2 appearance-none cursor-pointer focus:outline-none focus:border-accent-primary"
              >
                {FADE_CURVES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

        </div>
      </aside>
    </div>
  );
}
