import { isDeepStrictEqual } from "node:util";

import type {
  RmmvDatabaseTableSchema,
  RmmvDatabaseValidationIssue,
  RmmvDatabaseValidationResult,
} from "./database-schema.ts";
import type { RpgMakerEngine } from "./rpg-maker-engine.ts";

export function validateRmmvDatabaseEntryTransition(
  schema: Pick<RmmvDatabaseTableSchema, "validate">,
  before: unknown,
  after: unknown,
  engine: RpgMakerEngine,
): RmmvDatabaseValidationResult {
  const existingIssues = new Map<string, unknown[]>();
  for (const issue of schema.validate(before, engine).issues) {
    const identity = validationIssueIdentity(issue);
    const values = existingIssues.get(identity) ?? [];
    values.push(validationIssueValue(before, issue.path));
    existingIssues.set(identity, values);
  }

  const issues = schema.validate(after, engine).issues.filter((issue) => {
    const existingValues = existingIssues.get(validationIssueIdentity(issue));
    if (!existingValues?.length) return true;
    const afterValue = validationIssueValue(after, issue.path);
    const matchingIndex = existingValues.findIndex((beforeValue) => isDeepStrictEqual(beforeValue, afterValue));
    if (matchingIndex < 0) return true;
    existingValues.splice(matchingIndex, 1);
    return false;
  });

  return { ok: issues.length === 0, issues };
}

function validationIssueIdentity(issue: RmmvDatabaseValidationIssue): string {
  return JSON.stringify([
    issue.path,
    issue.message,
    issue.expected ?? null,
    issue.actual ?? null,
  ]);
}

function validationIssueValue(value: unknown, path: string): unknown {
  if (path === "$" || !path) return value;
  const segments = path.match(/[^.[\]]+|\[\d+\]/g);
  if (!segments?.length) return value;

  let cursor = value;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return value;
    const key = segment.startsWith("[")
      ? Number(segment.slice(1, -1))
      : segment;
    if (!Object.prototype.hasOwnProperty.call(cursor, key)) return value;
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}
