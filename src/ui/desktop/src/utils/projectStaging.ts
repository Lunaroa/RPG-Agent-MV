export interface StagingOperationSummary {
  operationId: string;
  files: string[];
}

export interface ProjectStagingSummary {
  staged: boolean;
  operations: StagingOperationSummary[];
}

export function parseProjectStagingSummary(status: unknown): ProjectStagingSummary {
  if (!status || typeof status !== 'object') return { staged: false, operations: [] };
  const source = status as { staged?: boolean; operations?: unknown[] };
  const operations = Array.isArray(source.operations)
    ? source.operations.flatMap((operation) => {
      if (!operation || typeof operation !== 'object') return [];
      const candidate = operation as { operationId?: unknown; files?: unknown };
      if (
        typeof candidate.operationId !== 'string'
        || !candidate.operationId
        || !Array.isArray(candidate.files)
      ) return [];
      return [{
        operationId: candidate.operationId,
        files: candidate.files.filter((file): file is string => typeof file === 'string'),
      }];
    })
    : [];
  return { staged: Boolean(source.staged), operations };
}
