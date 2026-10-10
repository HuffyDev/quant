/**
 * Serial job queue: timeline tasks, the autonomous loop and chat-independent Baby work run one at a time,
 * so Baby never "thinks" two things at once and rate caps stay simple.
 * `generation` is bumped on sim reset so stale jobs are dropped.
 */
type Job = { name: string; gen: number; run: () => Promise<void> };

class SerialQueue {
  private jobs: Job[] = [];
  private running: Job | null = null;
  generation = 0;

  push(name: string, run: () => Promise<void>) {
    this.jobs.push({ name, gen: this.generation, run });
    void this.drain();
  }

  pending() {
    return { running: this.running?.name ?? null, waiting: this.jobs.map((j) => j.name) };
  }

  /** true if a job with this name is running or waiting */
  has(name: string) {
    return this.running?.name === name || this.jobs.some((j) => j.name === name);
  }

  get busy() {
    return this.running !== null || this.jobs.length > 0;
  }

  reset() {
    this.generation++;
    this.jobs = [];
  }

  private async drain() {
    if (this.running) return;
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      if (job.gen !== this.generation) continue;
      this.running = job;
      try {
        await job.run();
      } catch (e) {
        console.error(`[queue] ${job.name} crashed`, e);
      } finally {
        this.running = null;
      }
    }
  }

  /** Resolves when the queue is idle (used by tests). */
  async idle() {
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
  }
}

export const queue = new SerialQueue();
