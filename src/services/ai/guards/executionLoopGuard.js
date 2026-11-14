const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_DUPLICATE_CALLS = 2;
const DEFAULT_TIMEOUT_MS = 25000;

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`).join(',')}}`;
}

function createExecutionLoopGuard({
  maxSteps = DEFAULT_MAX_STEPS,
  maxDuplicateCalls = DEFAULT_MAX_DUPLICATE_CALLS,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let steps = 0;
  const startedAt = Date.now();
  const callCounts = new Map();
  const toolTrace = [];

  function canStep() {
    if (Date.now() - startedAt > timeoutMs) {
      return { ok: false, reason: 'AGENT_TIMEOUT' };
    }
    if (steps >= maxSteps) {
      return { ok: false, reason: 'MAX_STEPS_EXCEEDED' };
    }
    steps += 1;
    return { ok: true, step: steps };
  }

  function checkToolCall(toolName, args = {}) {
    if (Date.now() - startedAt > timeoutMs) {
      return { ok: false, reason: 'Agent loop timed out.' };
    }
    const signature = `${toolName}:${stableSerialize(args)}`;
    const nextCount = (callCounts.get(signature) || 0) + 1;
    callCounts.set(signature, nextCount);

    if (nextCount > maxDuplicateCalls) {
      return {
        ok: false,
        reason: `Duplicate tool call blocked: "${toolName}" was already called ${maxDuplicateCalls} times with identical arguments. Use the existing tool result to respond to the user.`
      };
    }
    return { ok: true };
  }

  function recordToolResult(toolName, isError = false) {
    toolTrace.push({
      name: toolName,
      status: isError ? 'error' : 'ok'
    });
  }

  function getToolTrace() {
    return [...toolTrace];
  }

  return {
    MAX_AGENT_STEPS: maxSteps,
    canStep,
    checkToolCall,
    recordToolResult,
    getToolTrace
  };
}

module.exports = {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  createExecutionLoopGuard
};
