import { describe, it, expect } from "vitest";
import { buildSentenceStates } from "../utils/sentence-builder";
import { splitDirectInputIntoSentences, splitSentences } from "../utils/preprocessing";

const RAW = "一九八二年，上人開示。咱大家做伙行菩薩道！你敢知影：「這是你的因緣？」";

describe("buildSentenceStates", () => {
  it("keeps the user's original punctuation in sentence.text (direct mode)", () => {
    const groups = splitDirectInputIntoSentences(RAW, "sentence", 1, 8, 2);
    const sentences = buildSentenceStates(groups, { mode: "direct", rawText: RAW });
    expect(sentences.map((s) => s.text).join("")).toBe(RAW);
  });

  it("uses each original line as sentence.text (upload mode)", () => {
    const lines = ["第一行，有標點。", "第二行！也有標點？"];
    const groups = lines.map((l) => splitSentences(l, "sentence", 1, 8));
    const sentences = buildSentenceStates(groups, { mode: "upload", lines });
    expect(sentences.map((s) => s.text)).toEqual(lines);
  });

  it("strips punctuation from segments but never from sentence.text", () => {
    const lines = ["第一行，有標點。"];
    const groups = lines.map((l) => splitSentences(l, "sentence", 1, 8));
    const sentences = buildSentenceStates(groups, { mode: "upload", lines });
    expect(sentences[0].text).toBe("第一行，有標點。");
    // TTS input stays stripped — this is what gets sent to the API.
    expect(sentences[0].pipeline!.segments.map((s) => s.text)).toEqual(groups[0]);
    expect(sentences[0].pipeline!.segments.some((s) => s.text.includes("。"))).toBe(false);
  });

  it("builds pending segments with pipeline scaffolding", () => {
    const sentences = buildSentenceStates([["甲", "乙"]], {
      mode: "upload",
      lines: ["甲、乙。"],
    });
    expect(sentences).toHaveLength(1);
    expect(sentences[0].index).toBe(0);
    expect(sentences[0].status).toBe("pending");
    expect(sentences[0].pipeline!.segments).toEqual([
      { index: 0, text: "甲", status: "pending", attempts: 0, history: [] },
      { index: 1, text: "乙", status: "pending", attempts: 0, history: [] },
    ]);
  });

  it("indexes sentences sequentially", () => {
    const lines = ["一。", "二。", "三。"];
    const sentences = buildSentenceStates(
      lines.map((l) => [l.replace("。", "")]),
      { mode: "upload", lines },
    );
    expect(sentences.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("falls back to joined segments when the original text is unavailable", () => {
    const sentences = buildSentenceStates([["甲", "乙"]], { mode: "upload", lines: [] });
    expect(sentences[0].text).toBe("甲乙");
  });

  it("returns an empty list for no groups", () => {
    expect(buildSentenceStates([], { mode: "direct", rawText: RAW })).toEqual([]);
  });
});
