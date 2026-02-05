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


def force_split_by_char(text: str, max_tokens: int) -> List[str]:
    """
    Force split text by character when no punctuation is available.

    Args:
        text: Text to split
        max_tokens: Maximum tokens per segment

    Returns:
        List of segments, each <= max_tokens
    """
    result = []
    current = ""
    for char in text:
        if count_tokens(current + char) <= max_tokens:
            current += char
        else:
            if current:
                result.append(current)
            current = char
    if current:
        result.append(current)
    return result


def ensure_max_tokens(text: str, max_tokens: int) -> List[str]:
    """
    Ensure text is split into segments where each segment <= max_tokens.

    Strategy:
    1. If text already <= max_tokens, return as-is
    2. Try splitting by clause punctuation (，,、；;)
    3. If any part still > max_tokens, force split by character

    Args:
        text: Text to process
        max_tokens: Maximum tokens per segment

    Returns:
        List of segments, each guaranteed <= max_tokens
    """
    if count_tokens(text) <= max_tokens:
        return [text]

    # Split by clause punctuation, keeping delimiters
    parts = re.split(r"([，,、；;])", text)

    result = []
    current = ""

    for part in parts:
        if count_tokens(current + part) <= max_tokens:
            current += part
        else:
            if current:
                if count_tokens(current) > max_tokens:
                    # Recursively force split
                    result.extend(force_split_by_char(current, max_tokens))
                else:
                    result.append(current)
            current = part

    if current:
        if count_tokens(current) > max_tokens:
            result.extend(force_split_by_char(current, max_tokens))
        else:
            result.append(current)

    return result


def balance_segments(
    segments: List[str], min_tokens: int = 60, max_tokens: int = 80
) -> List[str]:
    """
    Balance segment token counts with hard max_tokens limit and soft min_tokens target.

    Algorithm:
    1. First ensure all segments <= max_tokens (using ensure_max_tokens)
    2. Greedy merge: combine adjacent segments if combined <= max_tokens
    3. Post-process: if last segment is too short, try merging with previous

    Args:
        segments: List of text segments to balance
        min_tokens: Soft minimum tokens per segment (default 60)
        max_tokens: Hard maximum tokens per segment (default 80)

    Returns:
        List of balanced segments, each guaranteed <= max_tokens
    """
    if not segments:
        return segments

    # Step 1: Ensure all segments are <= max_tokens
    atomic = []
    for seg in segments:
        atomic.extend(ensure_max_tokens(seg, max_tokens))

    # At this point, every piece in atomic is guaranteed <= max_tokens

    if not atomic:
        return []

    if len(atomic) == 1:
        return atomic

    # Step 2: Greedy merge - only combine if won't exceed max_tokens
    result = []
    current = ""
    current_tokens = 0

    for piece in atomic:
        piece_tokens = count_tokens(piece)

        if current_tokens + piece_tokens <= max_tokens:
            # Can merge without exceeding max
            current += piece
            current_tokens += piece_tokens
        else:
            # Would exceed max, start new segment
            if current:
                result.append(current)
            current = piece
            current_tokens = piece_tokens

    # Don't forget the last segment
    if current:
        result.append(current)

    # Step 3: Post-process - handle short last segment
    if len(result) >= 2:
        last_tokens = count_tokens(result[-1])
        if last_tokens < min_tokens:
            # Try merging with previous segment
            combined = result[-2] + result[-1]
            if count_tokens(combined) <= max_tokens:
                result = result[:-2] + [combined]

    return result


def split_sentences(
    text: str,
    mode: str = SEGMENT_MODE_SENTENCE,
    min_tokens: int = 60,
    max_tokens: int = 80,
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
        min_tokens: Soft minimum tokens per segment (default 60)
        max_tokens: Hard maximum tokens per segment (default 80)

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
        sentences = balance_segments(sentences, min_tokens, max_tokens)

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
