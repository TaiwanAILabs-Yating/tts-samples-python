#!/usr/bin/env python3

import io
import os
import subprocess
import time
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Tuple

from client import send_zero_shot_request, upload_prompt_voice
from preprocessing import (
    SEGMENT_MODE_CLAUSE,
    SEGMENT_MODE_RAW,
    SEGMENT_MODE_SENTENCE,
    count_tokens,
    generate_utt_id,
    preprocess_text,
    split_sentences,
)


def get_wav_duration(wav_bytes: bytes) -> float:
    """
    Calculate duration of WAV audio from bytes.

    Handles streaming WAV files where the header may contain placeholder
    values (0xFFFFFFFF) for data size.
    """
    # Find 'data' chunk marker to locate where audio data starts
    data_pos = wav_bytes.find(b"data")
    if data_pos == -1:
        raise ValueError("Invalid WAV file: no data chunk found")

    # Get format info from wave module (sample rate, channels, sample width)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        n_channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()  # bytes per sample

    # Data starts at data_pos + 8 (4 bytes 'data' + 4 bytes size field)
    data_start = data_pos + 8
    actual_data_size = len(wav_bytes) - data_start

    # Calculate duration from actual data size
    bytes_per_frame = n_channels * sample_width
    actual_frames = actual_data_size // bytes_per_frame

    return actual_frames / sample_rate


def generate_audio_with_retry(
    utt_id: str,
    output_path: str,
    sentence: str,
    prompt_voice_text: str,
    prompt_voice_asset_key: str,
    prompt_voice_url: str = "",
    language: str = None,
    prompt_language: str = None,
    add_end_silence: bool = False,
    max_retries: int = 3,
    retry_base_delay: float = 1.0,
) -> Tuple[str, str, str, bool, str, float]:
    """
    Generate audio for a single sentence with exponential backoff retry.

    Args:
        utt_id: Utterance ID
        output_path: Where to save audio file
        sentence: Text to synthesize
        prompt_voice_text: Text corresponding to prompt voice
        prompt_voice_asset_key: Asset key for uploaded prompt voice
        prompt_voice_url: Optional URL for prompt voice
        language: Target language code
        prompt_language: Language tag for prompt text
        add_end_silence: Whether to add end silence token
        max_retries: Maximum retry attempts for failed requests
        retry_base_delay: Base delay in seconds for exponential backoff

    Returns:
        Tuple of (utt_id, sentence, output_path, success, status_message, duration)
    """
    # Check if we should skip existing files
    if os.path.exists(output_path):
        print(f"[SKIP] {utt_id}: File already exists")
        # Get duration from existing file
        with open(output_path, "rb") as f:
            duration = get_wav_duration(f.read())
        return (utt_id, sentence, output_path, True, "skipped", duration)

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                delay = retry_base_delay * (2 ** (attempt - 1))
                print(
                    f"[RETRY] {utt_id}: Attempt {attempt + 1}/{max_retries + 1}, waiting {delay:.1f}s..."
                )
                time.sleep(delay)

            print(f"[GEN] {utt_id}: {sentence[:50]}...")

            tts_speech: bytes = send_zero_shot_request(
                text=sentence,
                prompt_voice_text=prompt_voice_text,
                prompt_voice_asset_key=prompt_voice_asset_key,
                prompt_voice_url=prompt_voice_url,
                language=language,
                prompt_language=prompt_language,
                add_end_silence=add_end_silence,
            )

            # Save to WAV file
            with open(output_path, "wb") as f:
                f.write(tts_speech)

            duration = get_wav_duration(tts_speech)
            print(f"[OK] {utt_id}: Generated {duration:.2f}s")
            return (utt_id, sentence, output_path, True, "generated")

        except Exception as e:
            last_error = str(e)
            print(f"[ERROR] {utt_id}: Attempt {attempt + 1} failed - {last_error}")

    return (
        utt_id,
        sentence,
        output_path,
        False,
        f"Failed after {max_retries + 1} attempts: {last_error}",
    )


def format_srt_time(seconds: float) -> str:
    """Format seconds to SRT time format: HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def generate_srt(output_path: str, segments: list[tuple[str, float]]) -> None:
    """
    Generate SRT subtitle file from segments.

    Args:
        output_path: Path to output SRT file
        segments: List of (text, duration) tuples
    """
    current_time = 0.0
    with open(output_path, "w", encoding="utf-8") as f:
        for idx, (text, duration) in enumerate(segments, 1):
            start = format_srt_time(current_time)
            end = format_srt_time(current_time + duration)
            f.write(f"{idx}\n{start} --> {end}\n{text}\n\n")
            current_time += duration


def concat_wavs_ffmpeg(output_path: str, audio_paths: list[str]):
    list_file = "list.txt"
    with open(list_file, "w") as f:
        for p in audio_paths:
            f.write(f"file '{p}'\n")

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list_file,
            "-c",
            "copy",
            output_path,
        ],
        check=True,
    )


def concat_wavs_with_crossfade(
    output_path: str,
    audio_paths: list[str],
    crossfade_duration: float = 0.05,
    fade_curve: str = "tri",
) -> None:
    """
    Concatenate WAV files with crossfade to eliminate clicking/popping.

    Args:
        output_path: Path for the output WAV file
        audio_paths: List of input WAV file paths
        crossfade_duration: Duration of crossfade in seconds (default: 50ms)
        fade_curve: Fade curve type for crossfade (default: "tri" = linear)
    """
    if not audio_paths:
        raise ValueError("No audio files to concatenate")

    if len(audio_paths) == 1:
        import shutil

        shutil.copy(audio_paths[0], output_path)
        return

    # Build input arguments
    input_args = []
    for path in audio_paths:
        input_args.extend(["-i", path])

    # Build filter complex for crossfading
    if len(audio_paths) == 2:
        # Simple case: two files
        filter_complex = (
            f"[0][1]acrossfade=d={crossfade_duration}:c1={fade_curve}:c2={fade_curve}"
        )
    else:
        # Multiple files: chain crossfades
        filters = []
        for i in range(len(audio_paths) - 1):
            if i == 0:
                # First pair: [0][1] -> [a0]
                filters.append(
                    f"[0][1]acrossfade=d={crossfade_duration}:c1={fade_curve}:c2={fade_curve}[a0]"
                )
            elif i == len(audio_paths) - 2:
                # Last pair: [a{i-1}][{i+1}] -> final output (no label)
                filters.append(
                    f"[a{i - 1}][{i + 1}]acrossfade=d={crossfade_duration}:c1={fade_curve}:c2={fade_curve}"
                )
            else:
                # Middle pairs: [a{i-1}][{i+1}] -> [a{i}]
                filters.append(
                    f"[a{i - 1}][{i + 1}]acrossfade=d={crossfade_duration}:c1={fade_curve}:c2={fade_curve}[a{i}]"
                )
        filter_complex = ";".join(filters)

    cmd = [
        "ffmpeg",
        "-y",
        *input_args,
        "-filter_complex",
        filter_complex,
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg crossfade failed: {result.stderr}")


def main(args) -> None:
    print(f"[INFO] Input text: {args.input_text}")
    print(f"[INFO] Utterance ID basename: {args.audio_basename}")

    # Step 1: Preprocess text
    print("\n[STEP 1] Preprocessing text...")
    text = preprocess_text(args.input_text)

    # Step 2: Split into sentences
    print("[STEP 2] Splitting into sentences...")
    segment_mode = args.segment_mode if args.segment_mode else SEGMENT_MODE_SENTENCE
    print(f"[INFO] Segmentation mode: {segment_mode}")
    min_tokens = args.min_tokens
    max_tokens = args.max_tokens
    print(f"[INFO] Token limits: min={min_tokens}, max={max_tokens}")
    sentences = split_sentences(
        text, mode=segment_mode, min_tokens=min_tokens, max_tokens=max_tokens
    )
    print(f"[INFO] Found {len(sentences)} sentences")
    for i, sent in enumerate(sentences):
        tokens = count_tokens(sent)
        print(
            f"[INFO] Segment {i}: {tokens} tokens - {sent[:30]}{'...' if len(sent) > 30 else ''}"
        )

    # Step 3: Generate audio for each sentence
    print("\n[STEP 3] Generating audio...")
    utterances: list[tuple[str, str, str, bool, str, float]] = []

    start_silence = args.prompt_start_silence if args.prompt_start_silence else 0.0
    end_silence = args.prompt_end_silence if args.prompt_end_silence else 0.0
    if start_silence > 0.0 or end_silence > 0.0:
        print(
            f"[INFO] Padding prompt audio: start={start_silence}s, end={end_silence}s"
        )
    asset_key = upload_prompt_voice(
        file_path=args.prompt_voice_path,
        start_silence_sec=start_silence,
        end_silence_sec=end_silence,
    )
    print(f"[INFO] Uploaded prompt voice, asset key: {asset_key}")

    os.makedirs(args.output_dir, exist_ok=True)

    add_end_silence = args.add_end_silence if args.add_end_silence else False
    if add_end_silence:
        print("[INFO] End silence token will be added to each sentence")

    prompt_language = args.prompt_language if args.prompt_language else None
    if prompt_language:
        print(f"[INFO] Prompt language: {prompt_language}")

    max_parallel = args.max_parallel if args.max_parallel else 1
    max_retries = args.max_retries if args.max_retries else 3
    retry_base_delay = args.retry_base_delay if args.retry_base_delay else 1.0

    if max_parallel > 1:
        print(f"[INFO] Parallel mode: max {max_parallel} concurrent requests")
    print(
        f"[INFO] Retry config: max_retries={max_retries}, base_delay={retry_base_delay}s"
    )

    # Prepare tasks
    tasks = []
    for idx, sentence in enumerate(sentences):
        utt_id = generate_utt_id(args.audio_basename, idx)
        output_path = os.path.join(args.output_dir, f"{utt_id}.wav")
        tasks.append((idx, utt_id, output_path, sentence))

    # Execute tasks (parallel or sequential)
    with ThreadPoolExecutor(max_workers=max_parallel) as executor:
        futures = {
            executor.submit(
                generate_audio_with_retry,
                utt_id,
                output_path,
                sentence,
                prompt_voice_text=args.prompt_voice_text,
                prompt_voice_asset_key=asset_key,
                language=args.language,
                prompt_language=prompt_language,
                add_end_silence=add_end_silence,
                max_retries=max_retries,
                retry_base_delay=retry_base_delay,
            ): idx
            for idx, utt_id, output_path, sentence in tasks
        }

        # Collect results, maintaining original order
        results = [None] * len(tasks)
        for future in as_completed(futures):
            idx = futures[future]
            results[idx] = future.result()

        utterances = results

    # Summary of generation
    successful = sum(1 for _, _, _, succ, _, _ in utterances if succ)
    failed = len(utterances) - successful
    print(f"\n[SUMMARY] Generated: {successful}/{len(utterances)} sentences")
    if failed > 0:
        print(f"[WARNING] Failed: {failed} sentences")

    # Step 4: Concatenate audio files
    print("\n[STEP 4] Concatenating audio files...")
    audio_paths = [path for _, _, path, succ, _, _ in utterances if succ]

    if audio_paths:
        if args.crossfade_duration > 0:
            print(
                f"[INFO] Using crossfade: duration={args.crossfade_duration}s, curve={args.crossfade_curve}"
            )
            concat_wavs_with_crossfade(
                args.output_wav,
                audio_paths,
                crossfade_duration=args.crossfade_duration,
                fade_curve=args.crossfade_curve,
            )
        else:
            concat_wavs_ffmpeg(args.output_wav, audio_paths)
        print(f"[OK] Concatenated audio saved: {args.output_wav}")
    else:
        print("[WARNING] No audio files to concatenate")

    # Step 5: Generate SRT subtitle file (if requested)
    if args.output_srt:
        print("\n[STEP 5] Generating SRT subtitle file...")
        srt_segments = [
            (sentence, duration)
            for _, sentence, _, succ, _, duration in utterances
            if succ
        ]
        if srt_segments:
            generate_srt(args.output_srt, srt_segments)
            print(f"[OK] SRT subtitle saved: {args.output_srt}")
        else:
            print("[WARNING] No segments for SRT generation")

    print("\n[DONE] Batch TTS generation complete!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--input-text", type=str)
    parser.add_argument("--prompt-voice-text", type=str)
    parser.add_argument("--prompt-voice-path", type=str)
    parser.add_argument("--audio-basename", type=str)
    parser.add_argument("--output-dir", type=str)
    parser.add_argument("--output-wav", type=str)
    parser.add_argument(
        "--output-srt",
        type=str,
        default=None,
        help="Output SRT subtitle file path",
    )
    parser.add_argument("--language", type=str)
    parser.add_argument(
        "--prompt-language",
        type=str,
        default=None,
        help="Language tag for prompt text (e.g., 'zh', 'nan', 'en'). Adds <|{lang}|> before prompt text",
    )
    # Sentence segmentation mode
    parser.add_argument(
        "--segment-mode",
        type=str,
        choices=[SEGMENT_MODE_RAW, SEGMENT_MODE_SENTENCE, SEGMENT_MODE_CLAUSE],
        default=SEGMENT_MODE_SENTENCE,
        help="Segmentation mode: 'raw' (no splitting), 'sentence' (split on 。.？！?!), 'clause' (split on 。.？！?!，,、；;)",
    )
    parser.add_argument(
        "--min-tokens",
        type=int,
        default=10,
        help="Soft minimum tokens per segment in sentence mode (default: 10)",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=40,
        help="Hard maximum tokens per segment in sentence mode (default: 40)",
    )
    # End silence token
    parser.add_argument(
        "--add-end-silence",
        action="store_true",
        help="Add <|sil_200ms|> token at end of each sentence to prevent premature ending",
    )
    # Prompt audio silence padding
    parser.add_argument(
        "--prompt-start-silence",
        type=float,
        default=0.0,
        help="Duration (seconds) of silence to pad at start of prompt audio (default: 0.0)",
    )
    parser.add_argument(
        "--prompt-end-silence",
        type=float,
        default=0.0,
        help="Duration (seconds) of silence to pad at end of prompt audio (default: 0.0)",
    )
    # Crossfade options for reducing audio artifacts
    parser.add_argument(
        "--crossfade-duration",
        type=float,
        default=0.05,
        help="Crossfade duration in seconds between audio segments (0 = disabled, recommended: 0.03-0.1)",
    )
    parser.add_argument(
        "--crossfade-curve",
        type=str,
        default="hsin",
        choices=["tri", "qsin", "hsin", "log", "exp"],
        help="Crossfade curve type (default: hsin)",
    )
    # Parallel execution options
    parser.add_argument(
        "--max-parallel",
        type=int,
        default=1,
        help="Maximum number of parallel TTS requests (default: 1, sequential)",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Maximum retry attempts for failed requests (default: 3)",
    )
    parser.add_argument(
        "--retry-base-delay",
        type=float,
        default=1.0,
        help="Base delay in seconds for exponential backoff (default: 1.0)",
    )
    args = parser.parse_args()

    main(args)
