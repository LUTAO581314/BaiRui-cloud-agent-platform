import { randomUUID } from "node:crypto";
import { synchronizeAgentMemory } from "./projection-coordinator.mjs";

function safeErrorCode(error) {
  const value = String(error?.code ?? "memory_projection_failed").toLowerCase();
  return /^[a-z][a-z0-9_.-]{0,127}$/.test(value) ? value : "memory_projection_failed";
}

export class MemoryProjectionWorker {
  constructor(options) {
    this.repository = options.repository;
    this.runtimeClient = options.runtimeClient;
    this.project = options.project ?? synchronizeAgentMemory;
    this.logger = options.logger ?? console;
    this.workerId = options.workerId ?? `memory-worker-${randomUUID()}`;
    this.batchSize = Math.max(1, Math.min(20, Number(options.batchSize) || 4));
    this.leaseSeconds = Math.max(15, Math.min(600, Number(options.leaseSeconds) || 90));
    this.maxAttempts = Math.max(1, Math.min(100, Number(options.maxAttempts) || 8));
    const configuredBaseRetry = Number(options.baseRetryMs);
    const configuredMaxRetry = Number(options.maxRetryMs);
    this.baseRetryMs = Number.isFinite(configuredBaseRetry) ? Math.max(0, configuredBaseRetry) : 2_000;
    this.maxRetryMs = Math.max(this.baseRetryMs, Number.isFinite(configuredMaxRetry) ? configuredMaxRetry : 5 * 60_000);
    this.intervalMs = Math.max(250, Number(options.intervalMs) || 2_000);
    this.running = false;
    this.timer = null;
  }

  retryDelay(attempts) {
    return Math.min(this.maxRetryMs, this.baseRetryMs * 2 ** Math.max(0, attempts - 1));
  }

  async process(job) {
    try {
      const resultSummary = await this.project({ repository: this.repository, runtimeClient: this.runtimeClient, job });
      return await this.repository.completeMemoryProjectionJob({ id: job.id, leaseToken: job.leaseToken, resultSummary });
    } catch (error) {
      const code = safeErrorCode(error);
      try {
        const updated = await this.repository.retryMemoryProjectionJob({ id: job.id, leaseToken: job.leaseToken, errorCode: code, maxAttempts: this.maxAttempts, delayMs: this.retryDelay(job.attempts) });
        if (updated?.state === "dead") await this.repository.markObsidianProjectionFailed(job);
        this.logger?.error?.("Memory projection failed", { workerId: this.workerId, jobId: job.id, agentId: job.agentId, code, state: updated?.state ?? "lease_lost" });
        return updated;
      } catch (persistenceError) {
        this.logger?.error?.("Memory projection retry persistence failed", { workerId: this.workerId, jobId: job.id, agentId: job.agentId, code: safeErrorCode(persistenceError), state: "lease_recovery_pending" });
        return null;
      }
    }
  }

  async runOnce() {
    const jobs = await this.repository.leaseMemoryProjectionJobs({ limit: this.batchSize, leaseSeconds: this.leaseSeconds, workerId: this.workerId });
    return Promise.all(jobs.map((job) => this.process(job)));
  }

  async tick() {
    if (this.running) return [];
    this.running = true;
    try { return await this.runOnce(); }
    catch (error) {
      this.logger?.error?.("Memory projection worker cycle failed", { workerId: this.workerId, code: safeErrorCode(error), state: "retry_next_cycle" });
      return [];
    }
    finally { this.running = false; }
  }

  start() {
    if (this.timer) return this;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
