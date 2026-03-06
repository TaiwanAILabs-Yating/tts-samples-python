import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateWithRetry,
  generateBatch,
} from "../services/batch-generator";

describe("generateWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns success on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("data");
    const promise = generateWithRetry(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data).toBe("data");
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure with exponential backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const onRetry = vi.fn();
    const promise = generateWithRetry(fn, 3, 1.0, onRetry);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data).toBe("success");
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);

    // Check retry callbacks with correct delays
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 1.0, "fail 1"); // 1.0 * 2^0
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 2.0, "fail 2"); // 1.0 * 2^1
  });

  it("returns failure after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent error"));

    const promise = generateWithRetry(fn, 2, 0.01);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed after 3 attempts");
    expect(result.error).toContain("persistent error");
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("works with maxRetries=0 (no retries)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = generateWithRetry(fn, 0, 0.01);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("handles non-Error thrown values", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    const promise = generateWithRetry(fn, 0, 0.01);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.error).toContain("string error");
  });
});

describe("generateBatch", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns empty array for empty input", async () => {
    const result = await generateBatch([]);
    expect(result).toEqual([]);
  });

  it("executes all tasks and returns results in order", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];

    const result = await generateBatch(tasks, 3);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const createTask = (id: number) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return id;
    };

    const tasks = Array.from({ length: 6 }, (_, i) => createTask(i));
    const result = await generateBatch(tasks, 2);

    expect(result).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("calls onProgress callback", async () => {
    const onProgress = vi.fn();
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    await generateBatch(tasks, 1, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
  });

  it("handles single task", async () => {
    const result = await generateBatch([() => Promise.resolve(42)]);
    expect(result).toEqual([42]);
  });

  it("handles concurrency greater than task count", async () => {
    const tasks = [() => Promise.resolve("x")];
    const result = await generateBatch(tasks, 10);
    expect(result).toEqual(["x"]);
  });
});
