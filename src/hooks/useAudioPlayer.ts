import { useState, useRef, useCallback, useEffect } from "react";

export interface SegmentRange {
  startTime: number;
  endTime: number;
  text: string;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function useAudioPlayer() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Track when playback started so we can compute current position
  const startTimeRef = useRef(0); // audioContext.currentTime when started
  const startOffsetRef = useRef(0); // offset in the audio when started
  const animFrameRef = useRef(0);

  const getContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
      gainNodeRef.current.gain.value = volume;
    }
    return audioContextRef.current;
  }, []);

  // Load audio from ArrayBuffer
  const loadAudio = useCallback(
    async (buffer: ArrayBuffer) => {
      const ctx = getContext();
      // Must slice because decodeAudioData detaches the buffer
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      audioBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);
      setCurrentTime(0);
      startOffsetRef.current = 0;
      stop();
    },
    [getContext]
  );

  // Update time on each animation frame while playing
  const updateTime = useCallback(() => {
    if (!audioContextRef.current || !audioBufferRef.current) return;

    const elapsed =
      (audioContextRef.current.currentTime - startTimeRef.current) *
      playbackRate;
    const time = startOffsetRef.current + elapsed;

    if (time >= audioBufferRef.current.duration) {
      // Reached end
      setCurrentTime(audioBufferRef.current.duration);
      setIsPlaying(false);
      startOffsetRef.current = 0;
      return;
    }

    setCurrentTime(time);
    animFrameRef.current = requestAnimationFrame(updateTime);
  }, [playbackRate]);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        // Already stopped
      }
      sourceRef.current = null;
    }
    cancelAnimationFrame(animFrameRef.current);
    setIsPlaying(false);
  }, []);

  const playFrom = useCallback(
    (offset: number) => {
      if (!audioBufferRef.current) return;
      const ctx = getContext();

      // Stop any existing playback
      if (sourceRef.current) {
        try {
          sourceRef.current.onended = null;
          sourceRef.current.stop();
        } catch {
          // ignore
        }
      }
      cancelAnimationFrame(animFrameRef.current);

      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.playbackRate.value = playbackRate;
      source.connect(gainNodeRef.current!);
      sourceRef.current = source;

      startTimeRef.current = ctx.currentTime;
      startOffsetRef.current = offset;

      source.onended = () => {
        setIsPlaying(false);
        startOffsetRef.current = audioBufferRef.current?.duration ?? 0;
        cancelAnimationFrame(animFrameRef.current);
      };

      source.start(0, offset);
      setIsPlaying(true);
      setCurrentTime(offset);
      animFrameRef.current = requestAnimationFrame(updateTime);
    },
    [getContext, playbackRate, updateTime]
  );

  const play = useCallback(() => {
    if (!audioBufferRef.current) return;
    // If at end, restart from beginning
    const offset =
      startOffsetRef.current >= audioBufferRef.current.duration
        ? 0
        : startOffsetRef.current;
    playFrom(offset);
  }, [playFrom]);

  const pause = useCallback(() => {
    if (!audioContextRef.current || !isPlaying) return;
    // Save current position
    const elapsed =
      (audioContextRef.current.currentTime - startTimeRef.current) *
      playbackRate;
    startOffsetRef.current = Math.min(
      startOffsetRef.current + elapsed,
      duration
    );
    stop();
    setCurrentTime(startOffsetRef.current);
  }, [isPlaying, playbackRate, duration, stop]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(time, duration));
      startOffsetRef.current = clamped;
      setCurrentTime(clamped);
      if (isPlaying) {
        playFrom(clamped);
      }
    },
    [duration, isPlaying, playFrom]
  );

  const changeVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      setVolume(clamped);
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = clamped;
      }
    },
    []
  );

  const changePlaybackRate = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      if (isPlaying && sourceRef.current) {
        // Need to restart with new rate (Web Audio doesn't allow live rate change easily)
        const ctx = audioContextRef.current;
        if (ctx) {
          const elapsed =
            (ctx.currentTime - startTimeRef.current) * playbackRate;
          const currentOffset = startOffsetRef.current + elapsed;
          startOffsetRef.current = currentOffset;
        }
        // The next play call will use the new rate
        stop();
        // Small delay to ensure stop completes
        setTimeout(() => {
          playFrom(startOffsetRef.current);
        }, 10);
      }
    },
    [isPlaying, playbackRate, stop, playFrom]
  );

  const cyclePlaybackRate = useCallback(() => {
    const currentIdx = PLAYBACK_RATES.indexOf(
      playbackRate as (typeof PLAYBACK_RATES)[number]
    );
    const nextIdx = (currentIdx + 1) % PLAYBACK_RATES.length;
    changePlaybackRate(PLAYBACK_RATES[nextIdx]);
  }, [playbackRate, changePlaybackRate]);

  // Navigate between segments
  const seekToSegment = useCallback(
    (segments: SegmentRange[], direction: "prev" | "next") => {
      if (segments.length === 0) return;
      const cur = currentTime;
      if (direction === "next") {
        const next = segments.find((s) => s.startTime > cur + 0.05);
        if (next) seek(next.startTime);
      } else {
        // Find current segment, then go to its start or previous
        const currentSeg = [...segments]
          .reverse()
          .find((s) => s.startTime <= cur + 0.05);
        if (currentSeg && cur - currentSeg.startTime > 0.5) {
          // Go to start of current segment if we're more than 0.5s in
          seek(currentSeg.startTime);
        } else {
          // Go to previous segment
          const prev = [...segments]
            .reverse()
            .find((s) => s.startTime < (currentSeg?.startTime ?? cur) - 0.05);
          if (prev) seek(prev.startTime);
          else seek(0);
        }
      }
    },
    [currentTime, seek]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    // State
    isPlaying,
    currentTime,
    duration,
    volume,
    playbackRate,
    hasAudio: audioBufferRef.current !== null,
    audioBuffer: audioBufferRef.current,

    // Actions
    loadAudio,
    play,
    pause,
    togglePlayPause,
    seek,
    playFrom,
    stop,
    changeVolume,
    changePlaybackRate,
    cyclePlaybackRate,
    seekToSegment,
  };
}
