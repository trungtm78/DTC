import { InProcessWorkflowRunner } from '../../src/provisioning/workflow-runner';

describe('InProcessWorkflowRunner', () => {
  it('runs a workflow once per id while it runs, and again after it ended', async () => {
    const runner = new InProcessWorkflowRunner();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const work = async (): Promise<void> => {
      runs += 1;
      await gate;
    };
    await runner.start('prov:t:1', work);
    await runner.start('prov:t:1', work);
    expect(runs).toBe(1);
    expect(runner.isRunning('prov:t:1')).toBe(true);
    release();
    await runner.idle();
    expect(runner.isRunning('prov:t:1')).toBe(false);
    await runner.start('prov:t:1', work);
    await runner.idle();
    expect(runs).toBe(2);
  });

  it('reports a failing workflow to the error handler and keeps running others', async () => {
    const failures: string[] = [];
    const runner = new InProcessWorkflowRunner((workflowId) => failures.push(workflowId));
    let other = 0;
    await runner.start('prov:bad:1', () => Promise.reject(new Error('boom')));
    await runner.start('prov:good:1', () => {
      other += 1;
      return Promise.resolve();
    });
    await runner.idle();
    expect(failures).toEqual(['prov:bad:1']);
    expect(other).toBe(1);
    expect(runner.isRunning('prov:bad:1')).toBe(false);
  });

  it('logs a failure through the default handler without throwing', async () => {
    const runner = new InProcessWorkflowRunner();
    await runner.start('prov:default:1', () => Promise.reject(new Error('boom')));
    await expect(runner.idle()).resolves.toBeUndefined();
  });
});
