export interface GenerateResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: number;
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * Equivalent to Python's generate_audio_with_retry() pattern.
 *
 * @param fn - Async function to execute
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param baseDelay - Base delay in seconds for exponential backoff (default: 1.0)
 * @param onRetry - Optional callback called before each retry
 * @returns Result with success status, data, and attempt count
 */
export async function generateWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1.0,
  onRetry?: (attempt: number, delay: number, error: string) => void
): Promise<GenerateResult<T>> {
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = baseDelay * 2 ** (attempt - 1);
        onRetry?.(attempt, delay, lastError);
        await sleep(delay * 1000);
      }

      const data = await fn();
      return { success: true, data, attempts: attempt + 1 };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries + 1} attempts: ${lastError}`,
    attempts: maxRetries + 1,
  };
}

/**
 * Execute multiple async tasks with concurrency limit.
 *
 * Equivalent to Python's ThreadPoolExecutor with max_workers,
 * using a semaphore pattern with Promise.
 *
 * Results are returned in the same order as the input tasks.
 *
 * @param tasks - Array of async task functions
 * @param concurrency - Maximum number of concurrent tasks (default: 3)
 * @param onProgress - Optional callback with (completed, total)
 * @returns Array of results in same order as input
 */
export async function generateBatch<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 3,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results = new Array<T>(tasks.length);
  let completed = 0;
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
      completed++;
      onProgress?.(completed, tasks.length);
    }
  }

  // Launch up to `concurrency` workers
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runNext()
  );

  await Promise.all(workers);
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
