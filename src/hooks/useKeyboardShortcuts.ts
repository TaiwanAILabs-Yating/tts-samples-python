import { useEffect } from "react";

interface KeyboardShortcutsConfig {
  onTogglePlayPause: () => void;
  onPrevSegment: () => void;
  onNextSegment: () => void;
  onPrevSentence: () => void;
  onNextSentence: () => void;
  onApprove: () => void;
  onReject: () => void;
  isGenerating?: boolean;
}

/**
 * Register workspace keyboard shortcuts.
 * Only fires when focus is NOT inside an input/textarea/select.
 */
export function useKeyboardShortcuts(config: KeyboardShortcutsConfig) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore shortcuts when typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          config.onTogglePlayPause();
          break;
        case "[":
          e.preventDefault();
          config.onPrevSegment();
          break;
        case "]":
          e.preventDefault();
          config.onNextSegment();
          break;
        case "ArrowUp":
          e.preventDefault();
          config.onPrevSentence();
          break;
        case "ArrowDown":
          e.preventDefault();
          config.onNextSentence();
          break;
        case "a":
        case "A":
          if (!config.isGenerating) config.onApprove();
          break;
        case "r":
        case "R":
          if (!config.isGenerating) config.onReject();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [config]);
}
