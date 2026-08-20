import { describe, it, expect } from "vitest";
import {
  countOccurrences,
  replaceAllLiteral,
  splitByTerm,
  findReplaceMatches,
  matchKey,
  summarizeSelection,
} from "../utils/batch-replace";
import type { SentenceState } from "../stores/project-store";
import type { SegmentState } from "../services/tts-orchestrator";

function seg(index: number, text: string): SegmentState {
  return { index, text, status: "success", attempts: 1, history: [] };
}

function sentence(
  index: number,
  segTexts: string[],
  status: SentenceState["status"] = "generated",
): SentenceState {
  return {
    index,
    text: segTexts.join(""),
    status,
    pipeline: { segments: segTexts.map((t, i) => seg(i, t)) },
  };
}

const SENTENCES: SentenceState[] = [
  sentence(0, ["我看見你的時候，", "你敢知影？"], "approved"),
  sentence(1, ["這句沒有那個字。"], "generated"),
  sentence(2, ["阿母講你著愛較細膩。", "若是你願意，咱做伙來去。"], "approved"),
  sentence(3, ["師父問你有啥物想法？"], "pending"),
];

describe("countOccurrences", () => {
  it("counts non-overlapping literal occurrences", () => {
    expect(countOccurrences("你你你", "你")).toBe(3);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("abc", "x")).toBe(0);
  });

  it("returns 0 for empty needle", () => {
    expect(countOccurrences("abc", "")).toBe(0);
  });

  it("treats regex metacharacters literally", () => {
    expect(countOccurrences("a.b.c", ".")).toBe(2);
    expect(countOccurrences("(你)", "(")).toBe(1);
  });
});

describe("replaceAllLiteral", () => {
  it("replaces every occurrence", () => {
    expect(replaceAllLiteral("你看你", "你", "汝")).toBe("汝看汝");
  });

  it("supports replacing with empty string", () => {
    expect(replaceAllLiteral("a-b-c", "-", "")).toBe("abc");
  });

  it("does not interpret $ patterns in replacement", () => {
    expect(replaceAllLiteral("x", "x", "$&$1")).toBe("$&$1");
  });

  it("returns input unchanged for empty needle", () => {
    expect(replaceAllLiteral("abc", "", "z")).toBe("abc");
  });
});

describe("splitByTerm", () => {
  it("returns alternating [plain, match, plain, ...] parts", () => {
    expect(splitByTerm("我看見你的時候你", "你")).toEqual([
      "我看見",
      "你",
      "的時候",
      "你",
      "",
    ]);
  });

  it("returns single plain part when no match", () => {
    expect(splitByTerm("abc", "x")).toEqual(["abc"]);
  });
});

describe("findReplaceMatches", () => {
  it("returns one match per segment containing the term, with before/after", () => {
    const matches = findReplaceMatches(SENTENCES, "你", "汝");
    expect(matches.map((m) => [m.sentenceIndex, m.segmentIndex, m.count])).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      [2, 0, 1],
      [2, 1, 1],
      [3, 0, 1],
    ]);
    expect(matches[0].before).toBe("我看見你的時候，");
    expect(matches[0].after).toBe("我看見汝的時候，");
  });

  it("returns empty for empty search term", () => {
    expect(findReplaceMatches(SENTENCES, "", "汝")).toEqual([]);
  });

  it("restricts to a single sentence when scope.sentenceIndex is given", () => {
    const matches = findReplaceMatches(SENTENCES, "你", "汝", { sentenceIndex: 2 });
    expect(matches.map((m) => m.sentenceIndex)).toEqual([2, 2]);
  });

  it("skips sentences without pipeline", () => {
    const noPipeline: SentenceState = { index: 0, text: "你", status: "pending" };
    expect(findReplaceMatches([noPipeline], "你", "汝")).toEqual([]);
  });
});

describe("summarizeSelection", () => {
  it("counts selected segments, distinct sentences and approved sentences", () => {
    const matches = findReplaceMatches(SENTENCES, "你", "汝");
    const selected = new Set(matches.map(matchKey));
    selected.delete(matchKey(matches[3])); // deselect sentence 2 seg 1

    const summary = summarizeSelection(matches, selected, SENTENCES);
    expect(summary).toEqual({
      totalMatches: 5,
      totalOccurrences: 5,
      selectedSegments: 4,
      selectedSentences: 3,
      approvedSentences: 2,
      sentenceIndices: [0, 2, 3],
    });
  });

  it("returns zeros for empty selection", () => {
    const matches = findReplaceMatches(SENTENCES, "你", "汝");
    const summary = summarizeSelection(matches, new Set(), SENTENCES);
    expect(summary.selectedSegments).toBe(0);
    expect(summary.selectedSentences).toBe(0);
    expect(summary.approvedSentences).toBe(0);
    expect(summary.sentenceIndices).toEqual([]);
  });
});
