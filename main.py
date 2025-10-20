#!/usr/bin/env python3

import os
import subprocess
from typing import Tuple 
from client import send_zero_shot_request, upload_prompt_voice
from preprocessing import preprocess_text, split_sentences, generate_utt_id


SAMPLING_RATE = 24000  # From client.py

OUTPUT_DIR = "output"
OUTPUT_WAV = "output.wav"
PROMPT_VOICE_PATH = "<YOUR_PROMPT_VOICE_PATH>"  # Path to your prompt voice file
BASENAME = "<basename>"

def generate_audio(
    utt_id: str,
    output_path: str,
    sentence: str,
    prompt_voice_text: str,
    prompt_voice_asset_key: str,
    prompt_voice_url: str ="",
) -> Tuple[str, str, str, bool, str]:
    """
    Generate audio for a single sentence using the specified TTS mode.

    Args:
        sentence: Text to synthesize
        utt_id: Utterance ID
        output_path: Where to save audio file
        args: Command-line arguments
        mode: TTS mode ("zero_shot", "streaming", or "sft")

    Returns:
        Tuple of (utt_id, sentence, output_path, success, status_message)
    """
    # Check if we should skip existing files
    if os.path.exists(output_path):
        print(f"[SKIP] {utt_id}: File already exists")
        return (utt_id, sentence, output_path, True, "skipped")

    try:
        print(f"[GEN] {utt_id}: {sentence[:50]}...")

        tts_speech: bytes = send_zero_shot_request(
            text=sentence,
            prompt_voice_text=prompt_voice_text,
            prompt_voice_asset_key=prompt_voice_asset_key,
            prompt_voice_url=prompt_voice_url,
        )

        # Save to WAV file
        with open(output_path, 'wb') as f:
            f.write(tts_speech)
            f.close()

        print(f"[OK] {utt_id}: Generated {len(tts_speech)/SAMPLING_RATE:.2f}s")
        return (utt_id, sentence, output_path, True, "generated")

    except Exception as e:
        print(f"[ERROR] {utt_id}: {str(e)}")
        return (utt_id, sentence, output_path, False, str(e))



def concat_wavs_ffmpeg(output_path: str, audio_paths: list[str]):
    list_file = "list.txt"
    with open(list_file, "w") as f:
        for p in audio_paths:
            f.write(f"file '{p}'\n")

    subprocess.run([
        "ffmpeg",
        "-f", "concat",
        "-safe", "0",
        "-i", list_file,
        "-c", "copy",
        output_path
    ], check=True)


def main() -> None:

    input_text = "色即是空，空即是色。受想行識，亦復如是。"

    print(f"[INFO] Input text: {input_text}")
    print(f"[INFO] Utterance ID basename: {BASENAME}")

    # Step 1: Preprocess text
    print("\n[STEP 1] Preprocessing text...")
    text = preprocess_text(input_text)

    # Step 2: Split into sentences
    print("[STEP 2] Splitting into sentences...")
    sentences = split_sentences(text)
    print(f"[INFO] Found {len(sentences)} sentences")

    # Step 3: Generate audio for each sentence
    print("\n[STEP 3] Generating audio...")
    utterances: list[tuple[str, str, str, bool, str]] = []

    asset_key = upload_prompt_voice(file_path=PROMPT_VOICE_PATH)
    print(f"[INFO] Uploaded prompt voice, asset key: {asset_key}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for idx, sentence in enumerate(sentences):
        utt_id = generate_utt_id(BASENAME, idx)
        output_path = os.path.join(OUTPUT_DIR, f"{utt_id}.wav")

        result = generate_audio(utt_id, output_path, sentence, prompt_voice_text="I think I'm actually a very nice person.", prompt_voice_asset_key=asset_key)
        utterances.append(result)


    # Summary of generation
    successful = sum(1 for _, _, _, succ, _ in utterances if succ)
    failed = len(utterances) - successful
    print(f"\n[SUMMARY] Generated: {successful}/{len(utterances)} sentences")
    if failed > 0:
        print(f"[WARNING] Failed: {failed} sentences")

    # Step 4: Concatenate audio files
    print("\n[STEP 4] Concatenating audio files...")
    audio_paths = [path for _, _, path, succ, _ in utterances if succ]

    if audio_paths:
        concat_wavs_ffmpeg(OUTPUT_WAV, audio_paths)
        print(f"[OK] Concatenated audio saved: {OUTPUT_WAV}")
    else:
        print("[WARNING] No audio files to concatenate")


    print("\n[DONE] Batch TTS generation complete!")


if __name__ == "__main__":
    main()