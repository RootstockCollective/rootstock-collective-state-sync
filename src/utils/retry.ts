const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries: number,
  initialRetryDelay: number
): Promise<T> => {
  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      retryCount++;

      if (retryCount <= maxRetries) {
        const delay = initialRetryDelay * Math.pow(2, retryCount - 1);
        await wait(delay);
      }
    }
  }

  throw new Error(`Operation failed after ${maxRetries} retries. Last error: ${lastError?.message}`);
};
