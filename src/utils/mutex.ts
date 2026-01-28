/**
 * A simple Promise-based mutex for preventing concurrent operations
 */
export class Mutex {
  private lock: Promise<void> | null = null;
  private releaseLock: (() => void) | null = null;

  /**
   * Check if the mutex is currently locked
   */
  isLocked(): boolean {
    return this.lock !== null;
  }

  /**
   * Acquire the lock. Returns a release function that must be called to release the lock.
   * @returns A function to release the lock
   * @throws Error if the mutex is already locked
   */
  acquire(): () => void {
    if (this.lock !== null) {
      throw new Error('Mutex is already locked');
    }

    this.lock = new Promise<void>((resolve) => {
      this.releaseLock = resolve;
    });

    return () => {
      this.lock = null;
      this.releaseLock?.();
      this.releaseLock = null;
    };
  }

  /**
   * Wait for the lock to be released if it's currently locked
   */
  async wait(): Promise<void> {
    if (this.lock !== null) {
      await this.lock;
    }
  }
}
