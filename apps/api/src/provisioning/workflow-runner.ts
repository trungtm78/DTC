import { Logger } from '@nestjs/common';

/**
 * Starts long-running work under a workflow id (`prov:{tenant_id}:{attempt}`) that is unique while it runs: a second
 * start with the same id does nothing. Temporal implements this port in ST-KERNEL-044; until then work runs in-process.
 */
export interface WorkflowRunner {
  start(workflowId: string, run: () => Promise<void>): Promise<void>;
}

const logger = new Logger('InProcessWorkflowRunner');

export class InProcessWorkflowRunner implements WorkflowRunner {
  private readonly active = new Map<string, Promise<void>>();

  constructor(private readonly onError: (workflowId: string, error: unknown) => void = (workflowId) => logger.error(`workflow ${workflowId} failed`)) {}

  start(workflowId: string, run: () => Promise<void>): Promise<void> {
    if (this.active.has(workflowId)) return Promise.resolve();
    const running = run()
      .catch((error: unknown) => this.onError(workflowId, error))
      .finally(() => this.active.delete(workflowId));
    this.active.set(workflowId, running);
    return Promise.resolve();
  }

  /** Resolves when no workflow is running (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.active.size > 0) await Promise.all([...this.active.values()]);
  }

  isRunning(workflowId: string): boolean {
    return this.active.has(workflowId);
  }
}
