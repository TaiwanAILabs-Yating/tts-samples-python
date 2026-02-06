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
SEGMENT_MODE_SENTENCE = "sentence"  # Split on sentence endings only: 。.？！?!
SEGMENT_MODE_CLAUSE = "clause"  # Split on sentence + clause endings: 。.？！?!，,、；;


def split_sentences(text: str, mode: str = SEGMENT_MODE_SENTENCE) -> List[str]:
    """
    Split text into sentences based on:
    - Chinese punctuation
    - Spaces/tabs between Chinese characters

    Args:
        text: Input text string
        mode: Segmentation mode
            - "sentence": Split on sentence ending marks only (。.？！?!)
            - "clause": Split on sentence + clause ending marks (。.？！?!，,、；;)

    Returns:
        List of sentences
    """
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
