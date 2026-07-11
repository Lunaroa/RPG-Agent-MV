import { runIsolatedRmmvPlaytestProbe } from '../desktop/isolated-playtest-probe.ts';
import type { RmmvHandlerInput, RmmvHandlerResult } from './rmmv-handler-types.ts';
import { resolveProjectRoot, resolveWorkflowRootFromInput } from './rmmv-handler-utils.ts';

export async function runRmmvVerify(input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const timeoutSeconds = optionalInteger(input.timeoutSeconds, 'timeoutSeconds');
  if (timeoutSeconds !== undefined && (timeoutSeconds < 5 || timeoutSeconds > 60)) {
    throw new Error('timeoutSeconds must be an integer from 5 to 60.');
  }

  const result = await runIsolatedRmmvPlaytestProbe(workflowRoot, project, {
    mapId: optionalInteger(input.mapId, 'mapId'),
    x: optionalInteger(input.x, 'x'),
    y: optionalInteger(input.y, 'y'),
    ...(timeoutSeconds !== undefined ? { timeoutMs: timeoutSeconds * 1_000 } : {}),
  });

  const detail = result.status === 'verified'
    ? 'Isolated staged-project playtest verified all required evidence.'
    : result.status === 'blocked'
      ? `Isolated staged-project playtest was blocked: ${result.blockers.join(' ') || result.error || 'preflight failed.'}`
      : result.status === 'review'
        ? `Isolated staged-project playtest needs review: ${result.review.join(' ') || result.error || 'strict evidence was incomplete.'}`
        : `Isolated staged-project playtest failed: ${result.error || 'strict evidence did not pass.'}`;

  return {
    summary: detail,
    data: result,
    artifacts: result.artifacts,
  };
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}
