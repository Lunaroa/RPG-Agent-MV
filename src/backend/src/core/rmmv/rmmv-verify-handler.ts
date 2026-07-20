import { runIsolatedRmmvPlaytestProbe } from '../desktop/isolated-playtest-probe.ts';
import fs from 'node:fs';
import path from 'node:path';
import type { InteractiveProjectRuntime } from '../desktop/interactive-playtest-runtime.ts';
import type { RmmvHandlerInput, RmmvHandlerResult } from './rmmv-handler-types.ts';
import { resolveProjectRoot, resolveWorkflowRootFromInput } from './rmmv-handler-utils.ts';

export async function runRmmvVerify(input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const runtime = resolveBoundRuntime();
  const desktopBound = Boolean(String(process.env.AIWF_PROJECT_BINDING_STATUS || '').trim());
  if (desktopBound && !runtime.runtime) {
    const code = runtime.code;
    return {
      summary: code === 'runtime-invalid'
        ? 'Real-device validation is blocked because the saved runtime is invalid. Ask the user to select a compatible MV/MZ runtime.'
        : 'Real-device validation is blocked because this source-only project needs a compatible MV/MZ runtime selection.',
      data: {
        status: 'blocked',
        code,
        stage: 'runtime-resolution',
        blocked: true,
      },
    };
  }
  const timeoutSeconds = optionalInteger(input.timeoutSeconds, 'timeoutSeconds');
  if (timeoutSeconds !== undefined && (timeoutSeconds < 5 || timeoutSeconds > 60)) {
    throw new Error('timeoutSeconds must be an integer from 5 to 60.');
  }

  const result = await runIsolatedRmmvPlaytestProbe(workflowRoot, project, {
    mapId: optionalInteger(input.mapId, 'mapId'),
    x: optionalInteger(input.x, 'x'),
    y: optionalInteger(input.y, 'y'),
    ...(timeoutSeconds !== undefined ? { timeoutMs: timeoutSeconds * 1_000 } : {}),
    ...(runtime.runtime ? { runtime: runtime.runtime } : {}),
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

function resolveBoundRuntime(): {
  runtime?: InteractiveProjectRuntime;
  code: 'runtime-selection-required' | 'runtime-invalid';
} {
  const executable = String(process.env.AIWF_PROJECT_RUNTIME_EXECUTABLE || '').trim();
  const engine = String(process.env.AIWF_PROJECT_RUNTIME_ENGINE || '').trim();
  const reason = String(process.env.AIWF_PROJECT_RUNTIME_REASON || '').trim();
  if (!executable) {
    return { code: reason === 'invalid' ? 'runtime-invalid' : 'runtime-selection-required' };
  }
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) return { code: 'runtime-invalid' };
  if (engine !== 'rpg-maker-mv' && engine !== 'rpg-maker-mz') return { code: 'runtime-invalid' };
  const source = String(process.env.AIWF_PROJECT_RUNTIME_SOURCE || 'configured');
  const normalizedSource = source === 'project-local' || source === 'official-install' ? source : 'configured';
  return {
    code: 'runtime-selection-required',
    runtime: {
      engine,
      executable: path.resolve(executable),
      runtimeRoot: path.resolve(String(process.env.AIWF_PROJECT_RUNTIME_ROOT || path.dirname(executable))),
      source: normalizedSource,
      launchStyle: process.env.AIWF_PROJECT_RUNTIME_LAUNCH_STYLE === 'embedded' ? 'embedded' : 'external',
      evidenceExecutable: `validated-${normalizedSource}-${engine}`,
      privateExecutable: path.resolve(executable),
    },
  };
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}
