import { describe, it, expect } from "vitest";
import { createLexiconService } from "../services/lexicon-service";

// Minimal vocab for testing — only Chinese words, no English
const TEST_VOCAB: Record<string, string[]> = {
  "我們": ["guán"],
  "大家": ["ta̍k-ke"],
  "菩薩": ["phôo-sat"],
  "家裡": ["ke-lāi"],
  "關懷": ["kuan-huâi"],
  "當作": ["tòng-tsò"],
  "就要": ["tō-ài"],
  "道": ["tō"],
};

const service = createLexiconService(TEST_VOCAB);

describe("segmentWords — Latin/English word preservation", () => {
  it("keeps ASCII English word as single token", () => {
    const result = service.segmentWords("道asus，");
    expect(result).toContain("asus");
    // Should not contain individual letters
    expect(result).not.toContain("a");
    expect(result).not.toContain("s");
    expect(result).not.toContain("u");
  });

  it("keeps accented Latin word as single token (台羅拼音)", () => {
    const result = service.segmentWords("ká-sú我們");
    expect(result[0]).toBe("ká-sú");
    expect(result[1]).toBe("我們");
  });

  it("keeps hyphenated Latin word together", () => {
    const result = service.segmentWords("hello-world");
    expect(result).toEqual(["hello-world"]);
  });

  it("includes digits in Latin token", () => {
    const result = service.segmentWords("MP3");
    expect(result).toEqual(["MP3"]);
  });

  it("keeps mixed letter-digit token together", () => {
    const result = service.segmentWords("道iPhone15，");
    expect(result).toContain("iPhone15");
  });

  it("does not merge Latin across punctuation", () => {
    const result = service.segmentWords("abc，def");
    expect(result).toEqual(["abc", "，", "def"]);
  });

  it("does not merge Latin across CJK characters", () => {
    const result = service.segmentWords("abc我們def");
    expect(result[0]).toBe("abc");
    expect(result[result.length - 1]).toBe("def");
  });

  it("handles the full example from the bug report", () => {
    const input = "ká-sú我們大家行菩薩道asus，就要把家裡的人當作我們要關懷的人。";
    const result = service.segmentWords(input);
    // English/Latin tokens should be whole words
    expect(result).toContain("ká-sú");
    expect(result).toContain("asus");
    // Chinese vocab words should still match
    expect(result).toContain("我們");
    expect(result).toContain("菩薩");
    expect(result).toContain("就要");
    expect(result).toContain("家裡");
    expect(result).toContain("關懷");
  });

  it("handles trailing hyphen as punctuation (not part of Latin token)", () => {
    const result = service.segmentWords("test-");
    // Trailing hyphen has no Latin char after it, should be separate
    expect(result).toEqual(["test", "-"]);
  });

  it("handles leading hyphen as punctuation", () => {
    const result = service.segmentWords("-test");
    expect(result).toEqual(["-", "test"]);
  });
});

describe("segmentWords — Chinese segmentation unchanged", () => {
  it("matches multi-char vocab words", () => {
    const result = service.segmentWords("我們大家");
    expect(result).toEqual(["我們", "大家"]);
  });

  it("falls back to single char for OOV Chinese", () => {
    const result = service.segmentWords("你好");
    expect(result).toEqual(["你", "好"]);
  });

  it("separates CJK punctuation", () => {
    const result = service.segmentWords("我們，大家。");
    expect(result).toEqual(["我們", "，", "大家", "。"]);
  });
});