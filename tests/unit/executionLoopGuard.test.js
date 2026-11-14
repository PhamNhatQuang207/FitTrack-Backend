const { createExecutionLoopGuard } = require('../../src/services/ai/guards/executionLoopGuard');

describe('executionLoopGuard (unit)', () => {
  test('enforces maxSteps limit', () => {
    const guard = createExecutionLoopGuard({ maxSteps: 3 });
    expect(guard.canStep().ok).toBe(true);
    expect(guard.canStep().ok).toBe(true);
    expect(guard.canStep().ok).toBe(true);
    expect(guard.canStep()).toEqual({
      ok: false,
      reason: 'MAX_STEPS_EXCEEDED'
    });
  });

  test('blocks identical tool call repeated more than maxDuplicateCalls times', () => {
    const guard = createExecutionLoopGuard({ maxSteps: 5, maxDuplicateCalls: 2 });
    expect(guard.checkToolCall('search_exercises', { query: 'bench' }).ok).toBe(true);
    expect(guard.checkToolCall('search_exercises', { query: 'bench' }).ok).toBe(true);
    const third = guard.checkToolCall('search_exercises', { query: 'bench' });
    expect(third.ok).toBe(false);
    expect(third.reason).toMatch(/Duplicate tool call/i);
  });

  test('records toolTrace entries in order', () => {
    const guard = createExecutionLoopGuard();
    guard.recordToolResult('get_user_profile', false);
    guard.recordToolResult('propose_weekly_plan', true);
    expect(guard.getToolTrace()).toEqual([
      { name: 'get_user_profile', status: 'ok' },
      { name: 'propose_weekly_plan', status: 'error' }
    ]);
  });
});
