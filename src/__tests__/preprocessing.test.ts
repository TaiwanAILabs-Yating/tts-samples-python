import { describe, it, expect } from "vitest";
import {
  SEGMENT_MODE_SENTENCE,
  balanceSegments,
  countTokens,
  ensureMaxTokens,
  forceSplitByChar,
  generateUttId,
  preprocessText,
  splitSentences,
  validateSentenceLengths,
  stripPunctuation,
} from "../utils/preprocessing";

// Test fixture from user (same as Python test)
const FIXTURE = `一九八二年，上人在佛七法會中開示，高愛師姊聽到矣。ká-sú我們大家行菩薩道，就要把家裡的人當作我們要關懷的人。我們有責任，要來教育我們的家庭；我們聽到的道理，就要找機會講給他們聽，讓他們感受、了解，感受到這樣有多好。我們做得到的，也要教育他們，讓他們做得到。過去先生大聲，你也跟他大聲；這馬先生大聲，我們就細聲，不要跟他大聲來、大聲去，輕聲細說跟他說話，慢慢地翁仔某就能好好說話，不再繼續相欠債，慢慢地家庭就和樂融融了、你的家庭，對面的家庭，再對面鄰居左右，家家戶戶都這樣，攏和樂融融矣！，一九八二年上人向初訪靜思精舍的顏惠美師姊說。 我要在花蓮蓋醫院，請妳一定要幫我接起來。`;

describe("countTokens", () => {
  it("counts Chinese characters as 1 token each", () => {
    expect(countTokens("你好")).toBe(2);
    expect(countTokens("一二三四五")).toBe(5);
  });

  it("counts English words as 1.5 tokens each (rounded down)", () => {
    expect(countTokens("hello")).toBe(1); // Math.floor(1 * 1.5) = 1
    expect(countTokens("hello world")).toBe(3); // Math.floor(2 * 1.5) = 3
  });

  it("handles mixed Chinese and English", () => {
    // 2 Chinese + Math.floor(1 * 1.5) English = 2 + 1 = 3
    expect(countTokens("你好world")).toBe(3);
  });
});

describe("forceSplitByChar", () => {
  it("keeps short text as single segment", () => {
    const result = forceSplitByChar("你好", 10);
    expect(result).toEqual(["你好"]);
  });

  it("splits text when it exceeds maxTokens", () => {
    const result = forceSplitByChar("一二三四五", 3);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(3);
    }
    expect(result.join("")).toBe("一二三四五");
  });

  it("keeps each segment within limit", () => {
    const text = "一".repeat(100);
    const result = forceSplitByChar(text, 20);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(20);
    }
  });
});

describe("ensureMaxTokens", () => {
  it("returns short text unchanged", () => {
    const result = ensureMaxTokens("你好世界", 10);
    expect(result).toEqual(["你好世界"]);
  });

  it("splits by clause punctuation first", () => {
    const text = "第一句，第二句，第三句";
    const result = ensureMaxTokens(text, 5);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(5);
    }
  });

  it("falls back to char split when no punctuation", () => {
    const text = "一二三四五六七八九十";
    const result = ensureMaxTokens(text, 5);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(5);
    }
    expect(result.join("")).toBe(text);
  });

  it("guarantees maxTokens for all segments", () => {
    const text = "這是一個很長的句子，沒有任何標點符號可以用來切分";
    const result = ensureMaxTokens(text, 10);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(10);
    }
  });
});

describe("balanceSegments", () => {
  it("returns empty list for empty input", () => {
    expect(balanceSegments([])).toEqual([]);
  });

  it("keeps single short segment unchanged", () => {
    const result = balanceSegments(["你好"], 60, 80);
    expect(result).toEqual(["你好"]);
  });

  it("merges small adjacent segments", () => {
    const segments = ["一", "二", "三"];
    const result = balanceSegments(segments, 60, 80);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("一二三");
  });

  it("never exceeds maxTokens", () => {
    const segments = ["一".repeat(50), "二".repeat(50), "三".repeat(50)];
    const result = balanceSegments(segments, 60, 80);
    for (const seg of result) {
      const tokens = countTokens(seg);
      expect(tokens).toBeLessThanOrEqual(80);
    }
  });

  it("splits oversized segments", () => {
    const segments = ["一".repeat(100)]; // 100 tokens, exceeds 80
    const result = balanceSegments(segments, 60, 80);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(80);
    }
  });

  it("merges short last segment with previous if possible", () => {
    // 70 + 5 = 75, within 80
    const segments = ["一".repeat(70), "二".repeat(5)];
    const result = balanceSegments(segments, 60, 80);
    expect(result).toHaveLength(1);
  });
});

describe("splitSentences", () => {
  it("enforces maxTokens as hard limit", () => {
    const result = splitSentences(FIXTURE, SEGMENT_MODE_SENTENCE, 60, 80);
    for (const seg of result) {
      const tokens = countTokens(seg);
      expect(tokens).toBeLessThanOrEqual(80);
    }
  });

  it("avoids very short non-final segments", () => {
    const result = splitSentences(FIXTURE, SEGMENT_MODE_SENTENCE, 60, 80);
    // Check all segments except last have at least half of min_tokens
    for (let i = 0; i < result.length - 1; i++) {
      const tokens = countTokens(result[i]);
      expect(tokens).toBeGreaterThanOrEqual(30);
    }
  });

  it("produces balanced segment lengths", () => {
    const result = splitSentences(FIXTURE, SEGMENT_MODE_SENTENCE, 60, 80);
    if (result.length >= 2) {
      const tokenCounts = result.map((seg) => countTokens(seg));
      const avg =
        tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length;
      for (let i = 0; i < tokenCounts.length - 1; i++) {
        expect(tokenCounts[i]).toBeGreaterThanOrEqual(avg * 0.3);
      }
    }
  });

  it("preserves all original content", () => {
    const result = splitSentences(FIXTURE, SEGMENT_MODE_SENTENCE, 60, 80);
    const punct = /[。.？?！!，,、；;\s]/g;
    const originalChars = FIXTURE.replace(punct, "");
    const resultChars = result.join("").replace(punct, "");
    expect(resultChars).toBe(originalChars);
  });
});

describe("stripPunctuation", () => {
  it("removes leading punctuation", () => {
    expect(stripPunctuation("，你好")).toBe("你好");
    expect(stripPunctuation("。！？你好")).toBe("你好");
    expect(stripPunctuation("、；;你好")).toBe("你好");
  });

  it("removes trailing comma/clause punctuation", () => {
    expect(stripPunctuation("你好，")).toBe("你好");
    expect(stripPunctuation("你好、")).toBe("你好");
    expect(stripPunctuation("你好；")).toBe("你好");
  });

  it("strips period but keeps exclamation/question", () => {
    expect(stripPunctuation("你好。")).toBe("你好");
    expect(stripPunctuation("你好.")).toBe("你好");
    expect(stripPunctuation("你好！")).toBe("你好！");
    expect(stripPunctuation("你好？")).toBe("你好？");
  });

  it("handles both leading and trailing correctly", () => {
    expect(stripPunctuation("，你好。")).toBe("你好");
    expect(stripPunctuation("、世界！")).toBe("世界！");
  });
});

describe("punctuation in splitSentences", () => {
  it("no segment starts with punctuation", () => {
    const result = splitSentences(FIXTURE, SEGMENT_MODE_SENTENCE, 60, 80);
    const leadingPunct = /^[。.？?！!，,、；;：:「」『』（）()\[\]【】]/;
    for (const seg of result) {
      expect(leadingPunct.test(seg)).toBe(false);
    }
  });

  it("no segment ends with comma-type punctuation", () => {
    const result = splitSentences(FIXTURE, SEGMENT_MODE_SENTENCE, 60, 80);
    const trailingComma = /[，,、；;：:「」『』（）()\[\]【】]$/;
    for (const seg of result) {
      expect(trailingComma.test(seg)).toBe(false);
    }
  });

  it("preserves exclamation/question but not period", () => {
    const text = "第一句。第二句！第三句？";
    const result = splitSentences(text, SEGMENT_MODE_SENTENCE, 5, 20);
    // ! and ? should be preserved
    const exclQuestion = result.filter((seg) => /[！？]$/.test(seg));
    expect(exclQuestion.length).toBeGreaterThan(0);
    // No segment should end with period
    const periodEndings = result.filter((seg) => /[。.]$/.test(seg));
    expect(periodEndings.length).toBe(0);
  });
});

describe("edge cases", () => {
  it("handles single long sentence", () => {
    const text = "這是一個非常非常長的句子" + "，很長".repeat(20);
    const result = splitSentences(text, SEGMENT_MODE_SENTENCE, 60, 80);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(80);
    }
  });

  it("merges many short sentences", () => {
    const text = "一。二。三。四。五。六。七。八。九。十。";
    const result = splitSentences(text, SEGMENT_MODE_SENTENCE, 60, 80);
    expect(result.length).toBeLessThan(10);
  });

  it("handles mixed lengths", () => {
    const text = "短。" + "這是一個較長的句子包含很多字元".repeat(3) + "。短。";
    const result = splitSentences(text, SEGMENT_MODE_SENTENCE, 60, 80);
    for (const seg of result) {
      expect(countTokens(seg)).toBeLessThanOrEqual(80);
    }
  });
});

describe("preprocessText", () => {
  it("removes line number prefixes", () => {
    const input = "     1→hello\n     2→world";
    expect(preprocessText(input)).toBe("hello world");
  });

  it("handles lines without prefixes", () => {
    const input = "hello\nworld";
    expect(preprocessText(input)).toBe("hello world");
  });

  it("skips empty lines", () => {
    const input = "     1→hello\n\n     3→world";
    expect(preprocessText(input)).toBe("hello world");
  });
});

describe("generateUttId", () => {
  it("generates zero-padded ID", () => {
    expect(generateUttId("test", 0)).toBe("test_00000");
    expect(generateUttId("test", 1)).toBe("test_00001");
    expect(generateUttId("test", 99999)).toBe("test_99999");
  });

  it("handles custom basename", () => {
    expect(generateUttId("19981202_nan", 5)).toBe("19981202_nan_00005");
  });
});

describe("validateSentenceLengths", () => {
  it("returns valid for short lines", () => {
    const result = validateSentenceLengths("短文\n第二行");
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("skips empty lines", () => {
    const result = validateSentenceLengths("第一行\n\n\n第二行");
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("detects lines exceeding maxChars", () => {
    const longLine = "字".repeat(1001);
    const result = validateSentenceLengths(`短句\n${longLine}\n另一行`);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toEqual({
      line: 2,
      text: longLine,
      length: 1001,
    });
  });

  it("detects multiple violations", () => {
    const long1 = "a".repeat(1001);
    const long2 = "b".repeat(2000);
    const result = validateSentenceLengths(`${long1}\n短\n${long2}`);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].line).toBe(1);
    expect(result.violations[1].line).toBe(3);
  });

  it("respects custom maxChars", () => {
    const result = validateSentenceLengths("12345", 3);
    expect(result.valid).toBe(false);
    expect(result.violations[0].length).toBe(5);
  });

  it("exactly 1000 chars is valid", () => {
    const exactLine = "字".repeat(1000);
    const result = validateSentenceLengths(exactLine);
    expect(result.valid).toBe(true);
  });
});
