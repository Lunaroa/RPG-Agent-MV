import type {
  MapPreviewFailureCode,
  MapPreviewFailureDetail,
  MapPreviewPreflightFailure,
  MapPreviewSession,
  RpgMakerEngine,
} from '@contract/types';

export interface MapPreviewDiagnostic {
  failureCode?: MapPreviewFailureCode;
  engine: RpgMakerEngine;
  mapId: number;
  operationId?: number;
  detail: MapPreviewFailureDetail;
}

export function mapPreviewDiagnosticFromSession(session: MapPreviewSession): MapPreviewDiagnostic {
  return {
    ...(session.failureCode ? { failureCode: session.failureCode } : {}),
    engine: session.engine,
    mapId: session.mapId,
    ...(session.operationId ? { operationId: session.operationId } : {}),
    detail: session.failureDetail || {
      stage: 'unknown',
      ...(session.operationId ? { operationId: session.operationId } : {}),
      targetMapId: session.mapId,
      message: sanitizeClientPreviewError(session.error || 'Map preview failed.'),
    },
  };
}

export function mapPreviewDiagnosticFromPreflightFailure(input: {
  failure: MapPreviewPreflightFailure;
  engine: RpgMakerEngine;
  mapId: number;
  operationId?: number;
}): MapPreviewDiagnostic {
  return {
    failureCode: 'staging-conflict',
    engine: input.engine,
    mapId: input.mapId,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    detail: {
      stage: input.failure.stage,
      ...(input.operationId ? { operationId: input.operationId } : {}),
      targetMapId: input.mapId,
      message: `Staging preflight found ${input.failure.conflictCount} conflicted file(s).`,
      stagingConflicts: input.failure.conflicts,
    },
  };
}

export function mapPreviewPreflightFailureFromSession(
  session: MapPreviewSession,
): MapPreviewPreflightFailure | undefined {
  const conflicts = session.failureDetail?.stagingConflicts;
  if (session.failureCode !== 'staging-conflict' || !conflicts?.length) return undefined;
  return {
    code: 'staging-conflict',
    stage: 'staging-preflight',
    conflictCount: conflicts.length,
    conflicts,
  };
}

export function mapPreviewDiagnosticFromError(input: {
  error: unknown;
  stage: string;
  engine: RpgMakerEngine;
  mapId: number;
  operationId?: number;
  project?: string;
}): MapPreviewDiagnostic {
  const message = input.error instanceof Error ? input.error.message : String(input.error || 'Map preview failed.');
  return {
    engine: input.engine,
    mapId: input.mapId,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    detail: {
      stage: input.stage,
      ...(input.operationId ? { operationId: input.operationId } : {}),
      targetMapId: input.mapId,
      message: sanitizeClientPreviewError(message, input.project),
    },
  };
}

export function sanitizeClientPreviewError(message: string, project?: string): string {
  let value = String(message || 'Map preview failed.').slice(0, 8_192);
  const projectPath = project?.replace(/\\/g, '/').replace(/\/$/, '');
  const fileUrl = projectPath && /^[a-z]:\//i.test(projectPath) ? `file:///${projectPath}` : '';
  const roots = project
    ? [project, projectPath, fileUrl, fileUrl ? encodeURI(fileUrl) : '']
      .filter((root): root is string => Boolean(root))
    : [];
  for (const root of roots.sort((left, right) => right.length - left.length)) {
    value = value.replace(new RegExp(`${escapeRegExp(root)}(?=$|[\\\\/])`, 'gi'), '[project]');
  }
  return value
    .replace(/\[project\][\\/]\.rpg-agent-preview-profile-[^\\/\s:)]*/gi, '[preview-profile]')
    .replace(/\[project\][\\/](?:www[\\/])?/gi, '')
    .replace(/file:\/\/\/[a-z]:\/[^\s"'<>]+/gi, '[external-path]')
    .replace(/(["'])[a-z]:[\\/][^"'\r\n<>]+\1/gi, '$1[external-path]$1')
    .replace(/(?:\\\\|\/\/)[^\\/\s"'<>]+[\\/][^\s"'<> ,;)\]}]+/g, '[external-path]')
    .replace(/[a-z]:[\\/][^\s"'<> ,;)\]}]+/gi, '[external-path]')
    .replace(/\/(?:Users|home|tmp|var|opt|usr|etc|mnt)\/[^\s"'<> ,;)\]}]+/g, '[external-path]')
    .replace(/\\/g, '/');
}

export function serializeMapPreviewDiagnostic(diagnostic: MapPreviewDiagnostic): string {
  const value = structuredClone(diagnostic) as MapPreviewDiagnostic;
  let serialized = JSON.stringify(value, null, 2);
  while (serialized.length > 30_000 && value.detail.stagingConflicts?.length) {
    value.detail.stagingConflicts.pop();
    serialized = JSON.stringify(value, null, 2);
  }
  while (serialized.length > 30_000 && value.detail.resources?.length) {
    value.detail.resources.pop();
    serialized = JSON.stringify(value, null, 2);
  }
  if (serialized.length > 30_000 && value.detail.runtimeOutput) {
    value.detail.runtimeOutput = value.detail.runtimeOutput.slice(0, 2_000);
    serialized = JSON.stringify(value, null, 2);
  }
  if (serialized.length > 30_000) {
    value.detail.message = value.detail.message.slice(0, 4_000);
    serialized = JSON.stringify(value, null, 2);
  }
  if (serialized.length > 30_000) {
    value.detail.resources = [];
    delete value.detail.runtimeOutput;
    value.detail.message = value.detail.message.slice(0, 2_000);
    serialized = JSON.stringify(value, null, 2);
  }
  return serialized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
