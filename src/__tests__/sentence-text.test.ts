import { describe, it, expect } from "vitest";
import {
  findSegmentSpans,
  extractOriginalSentenceTexts,
  replaceInSentenceText,
} from "../utils/sentence-text";
import { splitSentences, splitDirectInputIntoSentences } from "../utils/preprocessing";

describe("findSegmentSpans", () => {
  it("maps stripped segments back to spans in the original text", () => {
    const source = "你好嗎？我很好。";
    const spans = findSegmentSpans(source, ["你好嗎", "我很好"]);
    expect(spans).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it("handles repeated characters by ordered matching", () => {
    const source = "好好，好好好。";
    const spans = findSegmentSpans(source, ["好好", "好好好"]);
    expect(spans).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
  });

  it("returns null when a segment cannot be matched", () => {
    expect(findSegmentSpans("你好。", ["你好", "不存在"])).toBeNull();
  });
});

describe("extractOriginalSentenceTexts", () => {
  it("recovers original punctuation for direct-input groups", () => {
    const raw = "一九八二年，上人開示。大家行菩薩道！你敢知影？";
    const groups = splitDirectInputIntoSentences(raw, "sentence", 1, 8, 2);
    const originals = extractOriginalSentenceTexts(raw, groups);
    expect(originals).toHaveLength(groups.length);
    // Every original chunk keeps its punctuation and concatenates back to raw
    expect(originals.join("")).toBe(raw);
  });

  it("includes trailing sentence punctuation in each chunk", () => {
    const raw = "第一句。第二句！";
    const groups = [["第一句"], ["第二句"]];
    const originals = extractOriginalSentenceTexts(raw, groups);
    expect(originals).toEqual(["第一句。", "第二句！"]);
  });

  it("keeps opening quotes with the sentence they belong to", () => {
    const raw = "他講：「免驚。」逗陣來去。";
    const segs = splitSentences(raw, "sentence", 1, 6);
    const originals = extractOriginalSentenceTexts(raw, [segs]);
    expect(originals.join("")).toBe(raw);
  });

  it("falls back to joined segments when matching fails", () => {
    const originals = extractOriginalSentenceTexts("完全不相關", [["你好"]]);
    expect(originals).toEqual(["你好"]);
  });
});

describe("replaceInSentenceText", () => {
  const sentenceText = "我看見你的時候，你敢知影？";
  const oldSegments = ["我看見你的時候", "你敢知影"];

  it("replaces only within selected segments' spans, keeping punctuation", () => {
    const out = replaceInSentenceText(sentenceText, oldSegments, new Set([0]), "你", "汝");
    expect(out).toBe("我看見汝的時候，你敢知影？");
  });

  it("replaces in all selected segments", () => {
    const out = replaceInSentenceText(sentenceText, oldSegments, new Set([0, 1]), "你", "汝");
    expect(out).toBe("我看見汝的時候，汝敢知影？");
  });

  it("returns text unchanged when nothing selected", () => {
    expect(replaceInSentenceText(sentenceText, oldSegments, new Set(), "你", "汝")).toBe(
      sentenceText,
    );
  });

  it("falls back to whole-text replace when spans cannot be matched", () => {
    // segment text was manually edited and no longer matches sentence text
    const out = replaceInSentenceText("你來你去。", ["完全不同"], new Set([0]), "你", "汝");
    expect(out).toBe("汝來汝去。");
  });
});
