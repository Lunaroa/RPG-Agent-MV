import {
  getRmmvDatabaseSchemaByKey,
  type RmmvDatabaseFieldSchema,
  type RmmvDatabaseReferenceField,
  type RmmvDatabaseTableKey,
  type RmmvDatabaseTableSchema,
} from "./database-schema.ts";
import { readEffectiveRmmvDatabaseTable } from "./database-read.ts";

export interface RmmvDbEntrySchema {
  group: string;
  key: string;
  fileName: string;
  isArrayTable: boolean;
  coreFields: RmmvDatabaseFieldSchema[];
  references: RmmvDatabaseReferenceField[];
}

export interface RmmvDbEntryResult {
  table: RmmvDatabaseTableKey;
  group: string;
  id: number;
  value: unknown;
  schema: RmmvDbEntrySchema;
  relativePath: string;
  staged: boolean;
  contentHash: string;
}

export function readRmmvDbEntry(
  workflowRoot: string,
  projectRoot: string,
  request: { table: RmmvDatabaseTableKey; id: number },
): RmmvDbEntryResult {
  const schema = getRmmvDatabaseSchemaByKey(request.table);
  const id = Number(request.id);
  if (schema.isArrayTable) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`dbEntry table "${request.table}" requires a positive integer id`);
    }
  } else if (id !== 0) {
    throw new Error(`dbEntry table "${request.table}" requires id 0`);
  }

  const effective = readEffectiveRmmvDatabaseTable(workflowRoot, projectRoot, request.table);
  if (!effective) throw new Error(`dbEntry database file is missing: ${schema.fileName}`);

  let value: unknown;
  if (schema.isArrayTable) {
    if (!Array.isArray(effective.value)) {
      throw new Error(`dbEntry database table "${request.table}" is not an array`);
    }
    if (id >= effective.value.length) {
      throw new Error(
        `dbEntry id ${id} is outside table "${request.table}" (valid range: 1..${Math.max(0, effective.value.length - 1)})`,
      );
    }
    const entry = effective.value[id];
    value = entry === null || entry === undefined ? null : structuredClone(entry);
  } else {
    value = readDocumentValue(schema, effective.value);
  }

  return {
    table: request.table,
    group: schema.group,
    id,
    value,
    schema: schemaPayload(schema),
    relativePath: effective.relativePath,
    staged: effective.staged,
    contentHash: effective.contentHash,
  };
}

function readDocumentValue(schema: RmmvDatabaseTableSchema, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`dbEntry database table "${schema.key}" is not an object`);
  }
  return structuredClone(raw as Record<string, unknown>);
}

function schemaPayload(schema: RmmvDatabaseTableSchema): RmmvDbEntrySchema {
  return {
    group: schema.group,
    key: schema.key,
    fileName: schema.fileName,
    isArrayTable: schema.isArrayTable,
    coreFields: schema.coreFields.map((field) => ({ ...field })),
    references: schema.references.map((field) => ({ ...field })),
  };
}
