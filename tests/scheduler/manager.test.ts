import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchedulerManager } from '../../src/scheduler/manager.js';

describe('SchedulerManager', () => {
  let scheduler: SchedulerManager;

  beforeEach(() => {
    scheduler = new SchedulerManager();
  });

  it('should register handlers', () => {
    scheduler.registerHandler('test', async () => {});
    // No error means success
  });

  it('should schedule a valid task', () => {
    scheduler.registerHandler('test', async () => {});
    scheduler.schedule({
      id: 'task-1',
      name: 'Test Task',
      cron: '* * * * *',
      enabled: true,
      type: 'test',
      config: {},
    });
    expect(scheduler.getRunning()).toContain('task-1');
  });

  it('should skip disabled tasks', () => {
    scheduler.registerHandler('test', async () => {});
    scheduler.schedule({
      id: 'task-2',
      name: 'Disabled Task',
      cron: '* * * * *',
      enabled: false,
      type: 'test',
      config: {},
    });
    expect(scheduler.getRunning()).not.toContain('task-2');
  });

  it('should cancel a task', () => {
    scheduler.registerHandler('test', async () => {});
    scheduler.schedule({
      id: 'task-3',
      name: 'Cancel Me',
      cron: '* * * * *',
      enabled: true,
      type: 'test',
      config: {},
    });
    scheduler.cancel('task-3');
    expect(scheduler.getRunning()).not.toContain('task-3');
  });

  it('should cancel all tasks', () => {
    scheduler.registerHandler('test', async () => {});
    scheduler.schedule({ id: 'a', name: 'A', cron: '* * * * *', enabled: true, type: 'test', config: {} });
    scheduler.schedule({ id: 'b', name: 'B', cron: '* * * * *', enabled: true, type: 'test', config: {} });
    scheduler.cancelAll();
    expect(scheduler.getRunning()).toHaveLength(0);
  });
});
