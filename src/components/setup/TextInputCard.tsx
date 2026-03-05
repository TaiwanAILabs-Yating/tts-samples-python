import { useRef, useState, useCallback } from "react";
import { useProjectStore, type InputMode } from "../../stores/project-store.ts";
import { countTokens } from "../../utils/preprocessing.ts";

interface UploadedFile {
  name: string;
  lineCount: number;
  sizeKB: number;
}

export function TextInputCard() {
  const rawText = useProjectStore((s) => s.rawText);
  const setRawText = useProjectStore((s) => s.setRawText);
  const inputMode = useProjectStore((s) => s.inputMode);
  const setInputMode = useProjectStore((s) => s.setInputMode);

  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const charCount = rawText.length;
  const tokenCount = rawText ? countTokens(rawText) : 0;

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        // Support both plain text (one sentence per line) and Kaldi format (utt_id<space>text)
        const lines = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        // Auto-detect Kaldi format: if most lines have a clear "id text" pattern
        const kaldiPattern = /^\S+\s+.+$/;
        const kaldiMatches = lines.filter((l) => kaldiPattern.test(l)).length;
        const isKaldi = kaldiMatches > lines.length * 0.8 && lines.length > 0;

        let text: string;
        if (isKaldi) {
          // Strip utterance IDs, keep only text
          text = lines
            .map((l) => l.replace(/^\S+\s+/, ""))
            .join("\n");
        } else {
          text = lines.join("\n");
        }

        setRawText(text);
        setUploadedFile({
          name: file.name,
          lineCount: lines.length,
          sizeKB: parseFloat((file.size / 1024).toFixed(1)),
        });
      };
      reader.readAsText(file);
    },
    [setRawText],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".txt")) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [processFile],
  );

  const handleRemoveFile = useCallback(() => {
    setUploadedFile(null);
    setRawText("");
  }, [setRawText]);

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-secondary p-6 flex flex-col gap-3">
      {/* Header row: tabs + required label */}
      <div className="flex items-center justify-between">
        <div className="flex bg-bg-primary rounded-md p-1">
          <button
            onClick={() => setInputMode("direct")}
            className={`text-[13px] font-medium px-4 py-1.5 rounded transition-colors ${
              inputMode === "direct"
                ? "bg-bg-tertiary text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Direct Input
          </button>
          <button
            onClick={() => setInputMode("upload")}
            className={`text-[13px] font-medium px-4 py-1.5 rounded transition-colors ${
              inputMode === "upload"
                ? "bg-bg-tertiary text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Upload File
          </button>
        </div>
        <span className="text-[11px] text-status-error">
          <span className="text-status-error">*</span> Required
        </span>
      </div>

      {/* Content */}
      {inputMode === "direct" ? (
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Enter text to synthesize..."
          className="bg-bg-primary text-text-primary text-sm rounded-md border border-border-input px-3 py-2.5 h-40 resize-none placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center h-40 bg-bg-primary rounded-md border border-dashed cursor-pointer transition-colors ${
              isDragOver
                ? "border-accent-primary bg-accent-primary/5"
                : "border-border-input hover:border-text-muted"
            }`}
          >
            <svg
              className="w-8 h-8 text-text-muted mb-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
            <span className="text-[13px] text-text-secondary">
              Drag & drop a .txt file here, or
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="mt-2 text-[13px] font-medium text-accent-primary px-4 py-1.5 rounded border border-accent-primary hover:bg-accent-primary/10 transition-colors"
            >
              Browse Files
            </button>
            <span className="text-[11px] text-text-muted mt-2">
              Supported: .txt (plain text, one sentence per line or Kaldi format)
            </span>
          </div>

          {/* File info row (shown after upload) */}
          {uploadedFile && (
            <div className="flex items-center justify-between px-3 py-2 rounded-md bg-bg-primary border border-border-input">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-status-approved shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                  <path d="M10 9H8" />
                  <path d="M16 13H8" />
                  <path d="M16 17H8" />
                </svg>
                <span className="text-[13px] font-medium text-text-primary">
                  {uploadedFile.name}
                </span>
                <span className="text-[11px] text-text-muted">
                  {uploadedFile.lineCount} lines · {uploadedFile.sizeKB} KB
                </span>
              </div>
              <button
                onClick={handleRemoveFile}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
                title="Remove file"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="flex justify-end gap-4">
        <span className="text-[11px] font-mono text-text-muted">
          Characters: {charCount}
        </span>
        <span className="text-[11px] font-mono text-text-muted">
          Tokens: ~{tokenCount}
        </span>
      </div>
    </div>
  );
}
