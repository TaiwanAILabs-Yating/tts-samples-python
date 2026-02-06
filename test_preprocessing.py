"""Tests for preprocessing.py balance_segments functionality."""

import pytest

from preprocessing import (
    SEGMENT_MODE_SENTENCE,
    balance_segments,
    count_tokens,
    ensure_max_tokens,
    force_split_by_char,
    split_sentences,
    strip_punctuation,
)

# Test fixture from user
FIXTURE = """一九八二年，上人在佛七法會中開示，高愛師姊聽到矣。ká-sú我們大家行菩薩道，就要把家裡的人當作我們要關懷的人。我們有責任，要來教育我們的家庭；我們聽到的道理，就要找機會講給他們聽，讓他們感受、了解，感受到這樣有多好。我們做得到的，也要教育他們，讓他們做得到。過去先生大聲，你也跟他大聲；這馬先生大聲，我們就細聲，不要跟他大聲來、大聲去，輕聲細說跟他說話，慢慢地翁仔某就能好好說話，不再繼續相欠債，慢慢地家庭就和樂融融了、你的家庭，對面的家庭，再對面鄰居左右，家家戶戶都這樣，攏和樂融融矣！，一九八二年上人向初訪靜思精舍的顏惠美師姊說。 我要在花蓮蓋醫院，請妳一定要幫我接起來。"""


class TestCountTokens:
    """Tests for count_tokens function."""

    def test_chinese_only(self):
        """Chinese characters count as 1 token each."""
        assert count_tokens("你好") == 2
        assert count_tokens("一二三四五") == 5

    def test_english_only(self):
        """English words count as 1.5 tokens each (rounded down)."""
        assert count_tokens("hello") == 1  # int(1 * 1.5) = 1
        assert count_tokens("hello world") == 3  # int(2 * 1.5) = 3

    def test_mixed(self):
        """Mixed Chinese and English."""
        # 2 Chinese + int(1 * 1.5) English = 2 + 1 = 3
        assert count_tokens("你好world") == 3


class TestForceSplitByChar:
    """Tests for force_split_by_char function."""

    def test_short_text_unchanged(self):
        """Text shorter than max_tokens stays as single segment."""
        result = force_split_by_char("你好", 10)
        assert result == ["你好"]

    def test_splits_at_max(self):
        """Text is split when it exceeds max_tokens."""
        result = force_split_by_char("一二三四五", 3)
        assert all(count_tokens(seg) <= 3 for seg in result)
        assert "".join(result) == "一二三四五"

    def test_each_segment_within_limit(self):
        """Each segment must be <= max_tokens."""
        text = "一" * 100
        result = force_split_by_char(text, 20)
        for seg in result:
            assert count_tokens(seg) <= 20


class TestEnsureMaxTokens:
    """Tests for ensure_max_tokens function."""

    def test_short_text_unchanged(self):
        """Text within limit returns as-is."""
        result = ensure_max_tokens("你好世界", 10)
        assert result == ["你好世界"]

    def test_splits_by_clause_punctuation(self):
        """Tries to split by clause punctuation first."""
        text = "第一句，第二句，第三句"
        result = ensure_max_tokens(text, 5)
        assert all(count_tokens(seg) <= 5 for seg in result)

    def test_falls_back_to_char_split(self):
        """Falls back to char split when no punctuation."""
        text = "一二三四五六七八九十"
        result = ensure_max_tokens(text, 5)
        assert all(count_tokens(seg) <= 5 for seg in result)
        # Verify we can reconstruct original
        assert "".join(result) == text

    def test_guarantees_max_tokens(self):
        """All segments must be <= max_tokens."""
        text = "這是一個很長的句子，沒有任何標點符號可以用來切分"
        result = ensure_max_tokens(text, 10)
        for seg in result:
            assert count_tokens(seg) <= 10, f"Segment too long: {seg}"


class TestBalanceSegments:
    """Tests for balance_segments function."""

    def test_empty_input(self):
        """Empty list returns empty list."""
        assert balance_segments([]) == []

    def test_single_short_segment(self):
        """Single segment within limit unchanged."""
        result = balance_segments(["你好"], min_tokens=60, max_tokens=80)
        assert result == ["你好"]

    def test_merges_small_segments(self):
        """Small adjacent segments are merged."""
        segments = ["一", "二", "三"]
        result = balance_segments(segments, min_tokens=60, max_tokens=80)
        # All should be merged into one
        assert len(result) == 1
        assert result[0] == "一二三"

    def test_respects_max_tokens(self):
        """Never exceeds max_tokens."""
        segments = ["一" * 50, "二" * 50, "三" * 50]
        result = balance_segments(segments, min_tokens=60, max_tokens=80)
        for seg in result:
            tokens = count_tokens(seg)
            assert tokens <= 80, f"Segment has {tokens} tokens, exceeds max 80"

    def test_splits_oversized_segments(self):
        """Segments exceeding max_tokens are split."""
        segments = ["一" * 100]  # 100 tokens, exceeds 80
        result = balance_segments(segments, min_tokens=60, max_tokens=80)
        for seg in result:
            assert count_tokens(seg) <= 80

    def test_merges_short_last_segment(self):
        """Short last segment is merged with previous if possible."""
        # Create segments where last one is short
        segments = ["一" * 70, "二" * 5]  # 70 + 5 = 75, within 80
        result = balance_segments(segments, min_tokens=60, max_tokens=80)
        # Should merge into one
        assert len(result) == 1


class TestSplitSentences:
    """Tests for split_sentences with balance_segments integration."""

    def test_max_tokens_is_hard_limit(self):
        """Every segment must be <= max_tokens."""
        result = split_sentences(
            FIXTURE, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        for i, seg in enumerate(result):
            tokens = count_tokens(seg)
            assert tokens <= 80, f"Segment {i} has {tokens} tokens: {seg[:30]}..."

    def test_no_very_short_segments(self):
        """Non-final segments should have reasonable length."""
        result = split_sentences(
            FIXTURE, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        # Check all segments except last have at least half of min_tokens
        for i, seg in enumerate(result[:-1]):
            tokens = count_tokens(seg)
            assert tokens >= 30, f"Segment {i} is too short: {tokens} tokens"

    def test_segments_are_balanced(self):
        """Segment lengths should be relatively balanced."""
        result = split_sentences(
            FIXTURE, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        if len(result) >= 2:
            token_counts = [count_tokens(seg) for seg in result]
            avg = sum(token_counts) / len(token_counts)
            # No segment should be less than 30% of average (except possibly last)
            for i, tokens in enumerate(token_counts[:-1]):
                assert tokens >= avg * 0.3, (
                    f"Segment {i} is unbalanced: {tokens} vs avg {avg}"
                )

    def test_reconstructs_content(self):
        """All original content is preserved (punctuation aside)."""
        result = split_sentences(
            FIXTURE, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        # Join results and compare character count (excluding punctuation)
        import re

        original_chars = re.sub(r"[。.？?！!，,、；;\s]", "", FIXTURE)
        result_chars = re.sub(r"[。.？?！!，,、；;\s]", "", "".join(result))
        assert original_chars == result_chars


class TestStripPunctuation:
    """Tests for strip_punctuation function."""

    def test_removes_leading_punctuation(self):
        """Leading punctuation is removed."""
        assert strip_punctuation("，你好") == "你好"
        assert strip_punctuation("。！？你好") == "你好"
        assert strip_punctuation("、；;你好") == "你好"

    def test_removes_trailing_comma(self):
        """Trailing comma/clause punctuation is removed."""
        assert strip_punctuation("你好，") == "你好"
        assert strip_punctuation("你好、") == "你好"
        assert strip_punctuation("你好；") == "你好"

    def test_keeps_trailing_sentence_ending(self):
        """Trailing sentence-ending punctuation is kept."""
        assert strip_punctuation("你好。") == "你好。"
        assert strip_punctuation("你好！") == "你好！"
        assert strip_punctuation("你好？") == "你好？"

    def test_combined(self):
        """Both leading and trailing are handled correctly."""
        assert strip_punctuation("，你好。") == "你好。"
        assert strip_punctuation("、世界！") == "世界！"


class TestPunctuationInSplitSentences:
    """Tests for punctuation handling in split_sentences."""

    def test_no_leading_punctuation(self):
        """No segment should start with punctuation."""
        result = split_sentences(
            FIXTURE, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        import re

        leading_punct = r"^[。.？?！!，,、；;：:「」『』（）()\[\]【】]"
        for i, seg in enumerate(result):
            assert not re.match(leading_punct, seg), (
                f"Segment {i} starts with punctuation: {seg[:20]}"
            )

    def test_no_trailing_comma(self):
        """No segment should end with comma-type punctuation."""
        result = split_sentences(
            FIXTURE, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        import re

        trailing_comma = r"[，,、；;：:「」『』（）()\[\]【】]$"
        for i, seg in enumerate(result):
            assert not re.search(trailing_comma, seg), (
                f"Segment {i} ends with comma: {seg[-20:]}"
            )

    def test_preserves_sentence_ending(self):
        """Sentence-ending punctuation should be preserved where appropriate."""
        text = "第一句。第二句！第三句？"
        result = split_sentences(
            text, mode=SEGMENT_MODE_SENTENCE, min_tokens=5, max_tokens=20
        )
        # At least some segments should end with sentence-ending punctuation
        import re

        sentence_endings = sum(1 for seg in result if re.search(r"[。！？]$", seg))
        assert sentence_endings > 0, "No sentence endings preserved"


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_single_long_sentence(self):
        """Single sentence longer than max_tokens gets split."""
        text = "這是一個非常非常長的句子" + "，很長" * 20
        result = split_sentences(
            text, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        for seg in result:
            assert count_tokens(seg) <= 80

    def test_all_short_sentences(self):
        """Many short sentences get merged appropriately."""
        text = "一。二。三。四。五。六。七。八。九。十。"
        result = split_sentences(
            text, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        # Should merge into fewer segments
        assert len(result) < 10

    def test_mixed_lengths(self):
        """Mix of short and long sentences handled correctly."""
        text = "短。" + "這是一個較長的句子包含很多字元" * 3 + "。短。"
        result = split_sentences(
            text, mode=SEGMENT_MODE_SENTENCE, min_tokens=60, max_tokens=80
        )
        for seg in result:
            assert count_tokens(seg) <= 80


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
