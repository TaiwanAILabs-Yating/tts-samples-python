import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../../stores/project-store.ts";
import {
  findReplaceMatches,
  matchKey,
  splitByTerm,
  summarizeSelection,
  toSegmentEdits,
  type SegmentTextEdit,
} from "../../utils/batch-replace.ts";

export interface BatchReplaceApplyOptions {
  edits: SegmentTextEdit[];
  regenerate: boolean;
}

interface BatchReplaceDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (opts: BatchReplaceApplyOptions) => void;
}

type Scope = "all" | "current";

/** Render text with occurrences of `term` highlighted. */
function Highlighted({
  text,
  term,
  variant,
}: {
  text: string;
  term: string;
  variant: "before" | "after";
}) {
  const parts = splitByTerm(text, term);
  const chipCls =
    variant === "before"
      ? "bg-status-error/25 text-red-300"
      : "bg-accent-primary/30 text-violet-200";
  return (
    <span className={variant === "before" ? "text-text-secondary" : "text-text-primary"}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className={`rounded-sm px-0.5 font-semibold ${chipCls}`}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

export function BatchReplaceDialog({ open, onClose, onApply }: BatchReplaceDialogProps) {
  const sentences = useProjectStore((s) => s.sentences);
  const selectedSentenceIndex = useProjectStore((s) => s.selectedSentenceIndex);

  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  // Keys the user explicitly unchecked (default = everything selected).
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());

  // Reset form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setFind("");
      setReplaceWith("");
      setScope("all");
      setExcluded(new Set());
    }
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const matches = useMemo(
    () =>
      findReplaceMatches(
        sentences,
        find,
        replaceWith,
        scope === "current" ? { sentenceIndex: selectedSentenceIndex } : {},
      ),
    [sentences, find, replaceWith, scope, selectedSentenceIndex],
  );

  const selectedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      const k = matchKey(m);
      if (!excluded.has(k)) set.add(k);
    }
    return set;
  }, [matches, excluded]);

  const summary = useMemo(
    () => summarizeSelection(matches, selectedKeys, sentences),
    [matches, selectedKeys, sentences],
  );

  // Segments that will actually be regenerated (their sentence has been generated before).
  const regenerableCount = useMemo(
    () =>
      matches.filter(
        (m) =>
          selectedKeys.has(matchKey(m)) &&
          !!sentences[m.sentenceIndex]?.pipeline?.promptVoiceAssetKey,
      ).length,
    [matches, selectedKeys, sentences],
  );

  if (!open) return null;

  const canApply = find.length > 0 && find !== replaceWith && summary.selectedSegments > 0;

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectAll = () => setExcluded(new Set());
  const clearAll = () => setExcluded(new Set(matches.map(matchKey)));

  const apply = (regenerate: boolean) => {
    if (!canApply) return;
    onApply({ edits: toSegmentEdits(matches, selectedKeys), regenerate });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-replace-title"
        className="bg-bg-secondary border border-border-secondary rounded-xl w-full max-w-[640px] max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-secondary">
          <div className="flex items-center gap-2.5">
            <svg className="w-[18px] h-[18px] text-accent-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4a2 2 0 0 1 2-2" /><path d="M16 10a2 2 0 0 1-2-2" /><path d="M20 2a2 2 0 0 1 2 2" /><path d="M22 8a2 2 0 0 1-2 2" />
              <path d="m3 7 3 3 3-3" /><path d="M6 10V5a3 3 0 0 1 3-3h1" /><rect x="2" y="14" width="8" height="8" rx="2" />
            </svg>
            <h3 id="batch-replace-title" className="text-base font-semibold text-text-primary">
              批次取代字詞
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors"
            aria-label="關閉"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 py-5 overflow-hidden min-h-0">
          {/* Inputs */}
          <div className="flex items-end gap-3">
            <label className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">尋找</span>
              <input
                autoFocus
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder="例如：你"
                className="h-9 w-full bg-bg-primary border border-border-secondary rounded-md px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary focus:border-accent-primary"
              />
            </label>
            <div className="h-9 flex items-center text-text-muted">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
              </svg>
            </div>
            <label className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">取代為</span>
              <input
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                placeholder="例如：汝"
                className="h-9 w-full bg-bg-primary border border-border-secondary rounded-md px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary focus:border-accent-primary"
              />
            </label>
          </div>

          {/* Scope */}
          <div className="flex items-center gap-4 text-[13px]">
            <span className="text-xs font-medium text-text-secondary">範圍</span>
            {(
              [
                ["all", "全部句子"],
                ["current", `目前句子（#${String(selectedSentenceIndex + 1).padStart(3, "0")}）`],
              ] as [Scope, string][]
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="batch-replace-scope"
                  value={value}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  className="accent-accent-primary"
                />
                <span className={scope === value ? "text-text-primary" : "text-text-secondary"}>
                  {label}
                </span>
              </label>
            ))}
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-text-primary">預覽</span>
                <span className="text-[11px] text-text-muted">
                  {find.length === 0
                    ? "輸入要尋找的字詞"
                    : matches.length === 0
                      ? "無符合結果"
                      : `共 ${summary.totalOccurrences} 處 · ${summary.totalMatches} 個 segment · 已勾選 ${summary.selectedSegments}`}
                </span>
              </div>
              {matches.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] font-medium">
                  <button onClick={selectAll} className="text-accent-primary hover:underline">全選</button>
                  <span className="text-text-muted">·</span>
                  <button onClick={clearAll} className="text-accent-primary hover:underline">全不選</button>
                </div>
              )}
            </div>

            <div className="bg-bg-primary border border-border-secondary rounded-lg overflow-y-auto max-h-[300px] min-h-[120px]">
              {matches.length === 0 ? (
                <div className="flex items-center justify-center h-[120px] text-xs text-text-muted">
                  {find.length === 0 ? "—" : "找不到符合的 segment"}
                </div>
              ) : (
                matches.map((m) => {
                  const key = matchKey(m);
                  const checked = selectedKeys.has(key);
                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-3 px-3 py-2.5 border-b border-border last:border-b-0 cursor-pointer hover:bg-bg-secondary/40 transition-opacity ${
                        checked ? "" : "opacity-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(key)}
                        className="mt-0.5 accent-accent-primary"
                      />
                      <div className="w-[68px] shrink-0 flex flex-col">
                        <span className="text-xs font-mono font-semibold text-text-primary">
                          #{String(m.sentenceIndex + 1).padStart(3, "0")}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          Seg {m.segmentIndex + 1}
                          {m.count > 1 ? ` · ${m.count} 處` : ""}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1 text-[13px] leading-snug break-words">
                        <Highlighted text={m.before} term={find} variant="before" />
                        <div className="flex items-start gap-1.5">
                          <svg className="w-3 h-3 mt-0.5 shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 10 20 15 15 20" /><path d="M4 4v7a4 4 0 0 0 4 4h12" />
                          </svg>
                          <Highlighted text={m.after} term={replaceWith} variant="after" />
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Warning */}
          {summary.selectedSegments > 0 && (
            <div className="flex items-start gap-2 rounded-md px-3 py-2 bg-status-generated/10 border border-status-generated/30 text-xs text-amber-200 leading-relaxed">
              <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-status-generated" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />
              </svg>
              <span>
                取代後 {summary.selectedSegments} 個 segment 需要重新生成
                {summary.approvedSentences > 0 && (
                  <>
                    ；其中 {summary.approvedSentences} 個句子原本已 approved，將退回未審核
                  </>
                )}
                。
                {regenerableCount < summary.selectedSegments && (
                  <> 尚未生成過的句子只會更新文字，之後由 Regenerate All 處理。</>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 pt-4 pb-5 border-t border-border-secondary">
          <button
            onClick={onClose}
            className="text-sm text-text-secondary h-9 px-4 rounded-md border border-border-input hover:bg-bg-tertiary transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => apply(false)}
            disabled={!canApply}
            className="text-sm font-medium text-violet-200 h-9 px-4 rounded-md border border-accent-primary hover:bg-accent-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            僅取代文字{summary.selectedSegments > 0 ? `（${summary.selectedSegments}）` : ""}
          </button>
          <button
            onClick={() => apply(true)}
            disabled={!canApply || regenerableCount === 0}
            className="flex items-center gap-1.5 text-sm font-medium text-white h-9 px-4 rounded-md bg-accent-primary hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
            </svg>
            取代並重新生成{regenerableCount > 0 ? `（${regenerableCount}）` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
