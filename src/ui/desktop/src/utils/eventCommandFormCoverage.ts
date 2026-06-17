import {
  COMMAND_DEFINITIONS,
  type CommandDefinition,
} from '../composables/eventCommandCatalog.ts';

export type EventCommandFormCoverageLevel = 'specialized' | 'parameter-form' | 'no-parameter' | 'raw';

export interface EventCommandFormCoverageRow {
  code: number;
  label: string;
  level: EventCommandFormCoverageLevel;
  fieldCount: number;
}

const SPECIALIZED_COMMAND_CODES = new Set([101, 102, 105, 108, 205, 355, 356]);

export function eventCommandFormCoverageRows(definitions: CommandDefinition[] = COMMAND_DEFINITIONS): EventCommandFormCoverageRow[] {
  return definitions.map((definition) => ({
    code: definition.code,
    label: definition.label,
    level: formCoverageLevel(definition),
    fieldCount: definition.fields.length,
  }));
}

export function eventCommandFormCoverageSummary(definitions: CommandDefinition[] = COMMAND_DEFINITIONS) {
  const rows = eventCommandFormCoverageRows(definitions);
  return {
    total: rows.length,
    specialized: rows.filter((row) => row.level === 'specialized').map((row) => row.code),
    parameterForm: rows.filter((row) => row.level === 'parameter-form').map((row) => row.code),
    noParameter: rows.filter((row) => row.level === 'no-parameter').map((row) => row.code),
    raw: rows.filter((row) => row.level === 'raw').map((row) => row.code),
  };
}

function formCoverageLevel(definition: CommandDefinition): EventCommandFormCoverageLevel {
  if (SPECIALIZED_COMMAND_CODES.has(definition.code)) return 'specialized';
  if (definition.fields.length > 0) return 'parameter-form';
  return 'no-parameter';
}
