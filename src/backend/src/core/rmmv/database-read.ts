import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getProjectFileForRead } from "../desktop/staging-service.ts";
import {
  getRmmvDatabaseSchemaByKey,
  type RmmvDatabaseTableKey,
  type RmmvDatabaseTableSchema,
} from "./database-schema.ts";
import { dataRelativePath, resolveRmmvLayout } from "./rmmv-layout.ts";

export interface EffectiveRmmvDatabaseTable {
  schema: RmmvDatabaseTableSchema;
  relativePath: string;
  staged: boolean;
  contentHash: string;
  value: unknown;
}

export function readEffectiveRmmvDatabaseTable(
  workflowRoot: string,
  projectRoot: string,
  table: RmmvDatabaseTableKey,
): EffectiveRmmvDatabaseTable | null {
  const project = path.resolve(projectRoot);
  const schema = getRmmvDatabaseSchemaByKey(table);
  const relativePath = dataRelativePath(resolveRmmvLayout(project), schema.fileName);
  const effectiveFile = getProjectFileForRead(workflowRoot, project, relativePath);
  if (!effectiveFile) return null;

  const content = fs.readFileSync(effectiveFile);
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RMMV database JSON at ${relativePath}: ${detail}`);
  }

  return {
    schema,
    relativePath,
    staged: path.resolve(effectiveFile) !== path.resolve(project, relativePath),
    contentHash: crypto.createHash("sha256").update(content).digest("hex"),
    value,
  };
}
