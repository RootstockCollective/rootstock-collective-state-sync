/**
 * Splits an array into chunks of the specified size
 */
export const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) {
    throw new Error('Batch size must be greater than 0');
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Processes items in batches with a callback function
 * @param items - Array of items to process
 * @param batchSize - Size of each batch
 * @param processor - Async function to process each batch
 * @param options - Optional configuration for progress logging
 */
export const processBatches = async <T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchIndex: number) => Promise<void>,
  options?: {
    onProgress?: (currentBatch: number, totalBatches: number, processedItems: number, totalItems: number) => void;
    logInterval?: number; // Log progress every N batches (default: 10)
  }
): Promise<void> => {
  if (items.length === 0) return;

  const totalBatches = Math.ceil(items.length / batchSize);
  const logInterval = options?.logInterval ?? 10;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    await processor(batch, batchNumber - 1);

    if (options?.onProgress && totalBatches > 1 && batchNumber % logInterval === 0) {
      options.onProgress(
        batchNumber,
        totalBatches,
        Math.min(i + batchSize, items.length),
        items.length
      );
    }
  }
};
