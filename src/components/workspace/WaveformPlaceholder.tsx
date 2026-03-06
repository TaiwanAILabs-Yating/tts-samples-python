export function WaveformPlaceholder() {
  return (
    <div className="rounded-lg bg-bg-secondary border border-border-secondary flex flex-col">
      {/* Waveform area */}
      <div className="h-[120px] flex items-center justify-center">
        <span className="text-sm text-text-muted">
          Waveform player — Phase 4
        </span>
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-border-secondary">
        {/* Left controls */}
        <div className="flex items-center gap-2">
          <button className="text-text-secondary hover:text-text-primary transition-colors">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" x2="5" y1="19" y2="5" />
            </svg>
          </button>
          <button className="text-text-secondary hover:text-text-primary transition-colors">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:opacity-90 transition-opacity">
            <svg className="w-4 h-4 text-bg-primary ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
          <button className="text-text-secondary hover:text-text-primary transition-colors">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <button className="text-text-secondary hover:text-text-primary transition-colors">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" x2="19" y1="5" y2="19" />
            </svg>
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-1 text-xs font-mono font-medium text-text-primary px-2 py-1 rounded border border-border-input">
            1x
            <svg className="w-3 h-3 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
            <div className="w-20 h-1 bg-border-input rounded-full">
              <div className="w-3/4 h-full bg-text-secondary rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
