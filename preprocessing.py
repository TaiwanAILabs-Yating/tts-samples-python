import re
from typing import List


def preprocess_text(text: str) -> str:
    lines = text.splitlines()

    # Remove line number prefix (pattern: "     N→")
    cleaned_lines: List[str] = []
    for line in lines:
        # Match pattern like "     1→" or "   123→"
        cleaned = re.sub(r"^\s*\d+→", "", line)
        cleaned = cleaned.strip()
        if cleaned:  # Only keep non-empty lines
            cleaned_lines.append(cleaned)

    # Join into single text
    return " ".join(cleaned_lines)


# Segmentation mode constants
SEGMENT_MODE_RAW = "raw"  # No splitting, send text as-is
SEGMENT_MODE_SENTENCE = "sentence"  # Split on sentence endings only: 。.？！?!
SEGMENT_MODE_CLAUSE = "clause"  # Split on sentence + clause endings: 。.？！?!，,、；;


def count_tokens(text: str) -> int:
    """
    Count tokens in text.
    - Chinese character: 1 token
    - English word: 1.5 tokens (fixed average)
    """
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    english_words = len(re.findall(r"[a-zA-Z]+", text))
    return chinese_chars + int(english_words * 1.5)


def balance_segments(segments: List[str], max_tokens: int = 70) -> List[str]:
    """
    Balance segment token counts to ensure even distribution.

    Strategy:
    1. Merge adjacent segments if combined tokens <= max_tokens
    2. If last segment is too short (< half of average), redistribute
    3. Ensure each segment doesn't exceed max_tokens
    """
    if not segments:
        return segments

    if len(segments) == 1:
        return segments

    # Calculate token counts for each segment
    token_counts = [count_tokens(s) for s in segments]
    total_tokens = sum(token_counts)

    # If total is small enough, return as single segment
    if total_tokens <= max_tokens:
        return ["".join(segments)]

    # Merge small adjacent segments
    merged = []
    current_segment = ""
    current_tokens = 0

    for seg, tokens in zip(segments, token_counts):
        if current_tokens + tokens <= max_tokens:
            current_segment += seg
            current_tokens += tokens
        else:
            if current_segment:
                merged.append(current_segment)
            current_segment = seg
            current_tokens = tokens

    if current_segment:
        merged.append(current_segment)

    # Check if last segment is too short
    if len(merged) >= 2:
        merged_tokens = [count_tokens(s) for s in merged]
        avg_tokens = sum(merged_tokens) / len(merged_tokens)

        # If last segment is less than half the average, merge with previous
        if merged_tokens[-1] < avg_tokens * 0.5:
            # Try to redistribute more evenly
            combined = merged[-2] + merged[-1]
            combined_tokens = count_tokens(combined)

            if combined_tokens <= max_tokens:
                # Simply merge last two
                merged = merged[:-2] + [combined]
            else:
                # Need to split more evenly - keep as is for now
                # More complex redistribution could be added here
                pass

    return merged


def split_sentences(
    text: str, mode: str = SEGMENT_MODE_SENTENCE, max_tokens: int = 70
) -> List[str]:
    """
    Split text into sentences based on:
    - Chinese punctuation
    - Spaces/tabs between Chinese characters

    Args:
        text: Input text string
        mode: Segmentation mode
            - "raw": No splitting, return text as-is
            - "sentence": Split on sentence ending marks only (。.？！?!)
            - "clause": Split on sentence + clause ending marks (。.？！?!，,、；;)
        max_tokens: Maximum tokens per segment (used in sentence mode)

    Returns:
        List of sentences
    """
    # Raw mode: no splitting
    if mode == SEGMENT_MODE_RAW:
        return [text]

    # Define delimiter patterns based on mode
    if mode == SEGMENT_MODE_CLAUSE:
        # Sentence endings + clause endings (both CJK and ASCII variants)
        delimiter_pattern = r"[。.？?！!，,、；;]"
    else:
        # Sentence endings only (both CJK and ASCII variants)
        delimiter_pattern = r"[。.？?！!]"

    # First, split on spaces/tabs that appear between Chinese characters
    # This handles cases like "大哉大悟大聖主　　無垢無染無所著"
    # [\u4e00-\u9fff] matches Chinese characters
    # [\s\u3000]+ matches one or more whitespace (including ideographic space)
    text = re.sub(r"([\u4e00-\u9fff])[\s\u3000]+([\u4e00-\u9fff])", r"\1\n\2", text)

    # Split on newlines to get segments
    segments = text.split("\n")

    sentences: list[str] = []
    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        # Further split each segment on delimiters based on mode
        sub_sentences = [s for s in re.split(delimiter_pattern, segment) if s]

        if sub_sentences:
            # If we found sentences with delimiters, add them
            sentences.extend([s.strip() for s in sub_sentences if s.strip()])
        else:
            # If no delimiters found, treat the whole segment as a sentence
            # This handles cases like "無量義經" or "蕭齊天竺三藏曇摩伽陀耶舍譯"
            sentences.append(segment)

    # Balance segments in sentence mode to ensure even token distribution
    if mode == SEGMENT_MODE_SENTENCE:
        sentences = balance_segments(sentences, max_tokens)

    return sentences


def generate_utt_id(basename: str, index: int) -> str:
    """
    Generate utterance ID with zero-padded index.

    Args:
        basename: Base name for utterance IDs
        index: Sentence index (0-based)

    Returns:
        Formatted utterance ID (e.g., "basename_00001")
    """
    return f"{basename}_{index:05d}"
