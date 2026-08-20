import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore, type SentenceState } from "../stores/project-store";
import type { SegmentState, WordSegState } from "../services/tts-orchestrator";

const WORDSEG: WordSegState[] = [
  { word: "你", tailo: "lí", tailoList: ["lí"], inVocab: true, useTailo: false },
];

function seg(index: number, text: string, extra: Partial<SegmentState> = {}): SegmentState {
  return { index, text, status: "success", attempts: 1, history: [], ...extra };
}

function makeSentences(): SentenceState[] {
  return [
    {
      index: 0,
      text: "我看見你，你敢知影？",
      status: "approved",
      pipeline: {
        segments: [seg(0, "我看見你，", { wordSegmentation: WORDSEG }), seg(1, "你敢知影？")],
        concatenatedAudio: new ArrayBuffer(4),
        promptVoiceAssetKey: "asset-1",
      },
    },
    { index: 1, text: "無關的句子。", status: "generated", pipeline: { segments: [seg(0, "無關的句子。")] } },
    { index: 2, text: "師父問你有啥物想法？", status: "rejected", pipeline: { segments: [seg(0, "師父問你有啥物想法？")] } },
  ];
}

describe("applyBatchReplace", () => {
  beforeEach(() => {
    useProjectStore.getState().setSentences(makeSentences());
  });

  it("updates only the targeted segments' text", () => {
    useProjectStore.getState().applyBatchReplace([
      { sentenceIndex: 0, segmentIndex: 1, text: "汝敢知影？" },
      { sentenceIndex: 2, segmentIndex: 0, text: "師父問汝有啥物想法？" },
    ]);
    const s = useProjectStore.getState().sentences;
    expect(s[0].pipeline!.segments[0].text).toBe("我看見你，");
    expect(s[0].pipeline!.segments[1].text).toBe("汝敢知影？");
    expect(s[1].pipeline!.segments[0].text).toBe("無關的句子。");
    expect(s[2].pipeline!.segments[0].text).toBe("師父問汝有啥物想法？");
  });

  it("rebuilds sentence.text from its segments for affected sentences only", () => {
    useProjectStore.getState().applyBatchReplace([
      { sentenceIndex: 0, segmentIndex: 0, text: "我看見汝，" },
    ]);
    const s = useProjectStore.getState().sentences;
    expect(s[0].text).toBe("我看見汝，你敢知影？");
    expect(s[1].text).toBe("無關的句子。");
    expect(s[2].text).toBe("師父問你有啥物想法？");
  });

  it("reverts approved sentences to generated; leaves other statuses untouched", () => {
    useProjectStore.getState().applyBatchReplace([
      { sentenceIndex: 0, segmentIndex: 0, text: "我看見汝，" },
      { sentenceIndex: 2, segmentIndex: 0, text: "師父問汝有啥物想法？" },
    ]);
    const s = useProjectStore.getState().sentences;
    expect(s[0].status).toBe("generated");
    expect(s[1].status).toBe("generated");
    expect(s[2].status).toBe("rejected");
  });

  it("does not touch wordSegmentation, audio, history or asset key", () => {
    useProjectStore.getState().applyBatchReplace([
      { sentenceIndex: 0, segmentIndex: 0, text: "我看見汝，" },
    ]);
    const p = useProjectStore.getState().sentences[0].pipeline!;
    expect(p.segments[0].wordSegmentation).toEqual(WORDSEG);
    expect(p.segments[0].status).toBe("success");
    expect(p.concatenatedAudio).toBeInstanceOf(ArrayBuffer);
    expect(p.promptVoiceAssetKey).toBe("asset-1");
  });

  it("ignores edits pointing at missing sentences/segments", () => {
    const before = useProjectStore.getState().sentences;
    useProjectStore.getState().applyBatchReplace([
      { sentenceIndex: 9, segmentIndex: 0, text: "x" },
      { sentenceIndex: 1, segmentIndex: 5, text: "x" },
    ]);
    const after = useProjectStore.getState().sentences;
    expect(after).toEqual(before);
  });

  it("no-ops on empty edits", () => {
    const before = useProjectStore.getState().sentences;
    useProjectStore.getState().applyBatchReplace([]);
    expect(useProjectStore.getState().sentences).toBe(before);
  });
});
