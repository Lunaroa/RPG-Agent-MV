export interface ConditionalBranchCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

export interface ConditionalBranchLayout {
  headIndent: number;
  elseIndex: number | null;
  endIndex: number;
}

export type ConditionalBranchEngine = 'rpg-maker-mv' | 'rpg-maker-mz';

type ConditionalParameterFieldKind =
  | 'positiveInteger'
  | 'nonNegativeInteger'
  | 'integer'
  | 'finiteNumber'
  | 'string'
  | 'boolean'
  | 'enum';

interface ConditionalParameterField {
  kind: ConditionalParameterFieldKind;
  values?: readonly unknown[];
}

export interface ConditionalBranchParameterContract {
  lengths: readonly number[];
  fields: Readonly<Record<number, ConditionalParameterField>>;
}

export const CONDITIONAL_BUTTON_KEY_NAMES = Object.freeze([
  'down',
  'left',
  'right',
  'up',
  'ok',
  'cancel',
  'shift',
  'pageup',
  'pagedown',
] as const);

export const CONDITIONAL_BUTTON_MODES = Object.freeze([0, 1, 2] as const);

const CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_SHARED: Readonly<Record<number, ConditionalBranchParameterContract>> = Object.freeze({
  0: { lengths: [3], fields: { 1: { kind: 'positiveInteger' }, 2: { kind: 'enum', values: [0, 1] } } },
  1: { lengths: [5], fields: { 1: { kind: 'positiveInteger' }, 2: { kind: 'enum', values: [0, 1] }, 4: { kind: 'enum', values: [0, 1, 2, 3, 4, 5] } } },
  2: { lengths: [3], fields: { 1: { kind: 'enum', values: ['A', 'B', 'C', 'D'] }, 2: { kind: 'enum', values: [0, 1] } } },
  3: { lengths: [3], fields: { 1: { kind: 'nonNegativeInteger' }, 2: { kind: 'enum', values: [0, 1] } } },
  4: { lengths: [3, 4], fields: { 1: { kind: 'positiveInteger' }, 2: { kind: 'enum', values: [0, 1, 2, 3, 4, 5, 6] } } },
  5: { lengths: [3, 4], fields: { 1: { kind: 'nonNegativeInteger' }, 2: { kind: 'enum', values: [0, 1] } } },
  6: { lengths: [3], fields: { 1: { kind: 'integer' }, 2: { kind: 'enum', values: [2, 4, 6, 8] } } },
  7: { lengths: [3], fields: { 1: { kind: 'nonNegativeInteger' }, 2: { kind: 'enum', values: [0, 1, 2] } } },
  8: { lengths: [2], fields: { 1: { kind: 'positiveInteger' } } },
  9: { lengths: [3], fields: { 1: { kind: 'positiveInteger' }, 2: { kind: 'boolean' } } },
  10: { lengths: [3], fields: { 1: { kind: 'positiveInteger' }, 2: { kind: 'boolean' } } },
  12: { lengths: [2], fields: { 1: { kind: 'string' } } },
  13: { lengths: [2], fields: { 1: { kind: 'enum', values: [0, 1, 2] } } },
});

const CONDITIONAL_BRANCH_TYPE11_CONTRACTS: Readonly<Record<ConditionalBranchEngine, ConditionalBranchParameterContract>> = Object.freeze({
  'rpg-maker-mv': { lengths: [2], fields: { 1: { kind: 'enum', values: CONDITIONAL_BUTTON_KEY_NAMES } } },
  'rpg-maker-mz': { lengths: [3], fields: { 1: { kind: 'enum', values: CONDITIONAL_BUTTON_KEY_NAMES }, 2: { kind: 'enum', values: CONDITIONAL_BUTTON_MODES } } },
});

/** RM code-111 parameter shapes, kept in one table for validation/tests. */
export const CONDITIONAL_BRANCH_PARAMETER_CONTRACTS: Readonly<Record<number, ConditionalBranchParameterContract>> = Object.freeze({
  ...CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_SHARED,
  11: CONDITIONAL_BRANCH_TYPE11_CONTRACTS['rpg-maker-mv'],
});

export const CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_BY_ENGINE: Readonly<Record<ConditionalBranchEngine, Readonly<Record<number, ConditionalBranchParameterContract>>>> = Object.freeze({
  'rpg-maker-mv': CONDITIONAL_BRANCH_PARAMETER_CONTRACTS,
  'rpg-maker-mz': Object.freeze({
    ...CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_SHARED,
    11: CONDITIONAL_BRANCH_TYPE11_CONTRACTS['rpg-maker-mz'],
  }),
});

export type ConditionalNamedEntryKind = 'switch' | 'variable';

/**
 * Check whether a named-entry selector result still targets the active
 * code-111 field.  The selector callback is asynchronous, so callers must
 * re-check the opening type and field role before writing its result.
 */
export function isConditionalNamedEntryTarget(
  parameters: readonly unknown[],
  kind: ConditionalNamedEntryKind,
  index: number,
): boolean {
  const type = parameters[0];
  if (type === 0) return kind === 'switch' && index === 1;
  if (type !== 1 || kind !== 'variable') return false;
  if (index === 1) return true;
  return index === 3 && parameters[2] === 1;
}

export function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value > 0;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function assertFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertField(value: unknown, field: ConditionalParameterField, label: string): void {
  if (field.kind === 'positiveInteger') return assertPositiveInteger(value, label);
  if (field.kind === 'nonNegativeInteger') {
    if (!isFiniteInteger(value) || value < 0) throw new Error(`${label} must be a finite non-negative integer`);
    return;
  }
  if (field.kind === 'integer') {
    if (!isFiniteInteger(value)) throw new Error(`${label} must be a finite integer`);
    return;
  }
  if (field.kind === 'finiteNumber') return assertFiniteNumber(value, label);
  if (field.kind === 'string') {
    if (typeof value !== 'string') throw new Error(`${label} must be a string`);
    return;
  }
  if (field.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
    return;
  }
  if (!field.values?.some((candidate) => candidate === value)) {
    throw new Error(`${label} must be one of the allowed values`);
  }
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (!isFinitePositiveInteger(value)) {
    throw new Error(`${label} must be a finite positive integer`);
  }
}

function assertParameterArray(parameters: unknown): asserts parameters is unknown[] {
  if (!Array.isArray(parameters)) throw new Error('Conditional branch parameters must be an array');
}

/**
 * Validate the code-111 fields whose values are used as named system entries.
 * The editor normalizer may fill missing fields for new commands, but it must
 * not silently turn an existing invalid ID into a different entry.
 */
export function validateConditionalBranchParameters(
  parameters: unknown[],
  engine: ConditionalBranchEngine = 'rpg-maker-mv',
): void {
  assertParameterArray(parameters);
  const type = parameters[0];
  if (!isFiniteInteger(type) || type < 0 || type > 13) {
    throw new Error('Conditional branch type must be an integer from 0 to 13');
  }
  const contract = CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_BY_ENGINE[engine]?.[type];
  if (!contract || !contract.lengths.includes(parameters.length)) {
    throw new Error(`Conditional branch type ${type} has an invalid parameter shape`);
  }
  for (const [indexText, field] of Object.entries(contract.fields)) {
    const index = Number(indexText);
    const label = type === 0 && index === 1
      ? 'Switch ID'
      : type === 1 && index === 1
        ? 'Left variable ID'
        : `Conditional branch parameter ${index}`;
    assertField(parameters[index], field, label);
  }

  if (type === 1) {
    if (parameters[2] === 1) assertPositiveInteger(parameters[3], 'Right variable ID');
    else assertFiniteNumber(parameters[3], 'Variable comparison constant');
  } else if (type === 4) {
    const subtype = parameters[2];
    if (subtype === 1) {
      if (typeof parameters[3] !== 'string') throw new Error('Actor name condition must be a string');
    } else if (typeof subtype === 'number' && subtype >= 2) {
      assertPositiveInteger(parameters[3], 'Actor condition entry ID');
    }
  } else if (type === 5 && parameters[2] === 1) {
    assertPositiveInteger(parameters[3], 'Enemy state ID');
  }
}

export type ConditionalBranchDraftMap = Readonly<Record<number, unknown[]>>;

export function initializeConditionalBranchDraftMap(parameters: readonly unknown[]): Record<number, unknown[]> {
  const type = parameters[0];
  if (!isFiniteInteger(type) || type < 0 || type > 13) {
    throw new Error('Conditional branch type must be an integer from 0 to 13');
  }
  return { [type]: cloneValue(parameters) as unknown[] };
}

export function switchConditionalBranchDraft(
  drafts: ConditionalBranchDraftMap,
  currentParameters: readonly unknown[],
  nextType: number,
  createParameters: (type: number) => readonly unknown[],
): { drafts: Record<number, unknown[]>; parameters: unknown[] } {
  if (!isFiniteInteger(nextType) || nextType < 0 || nextType > 13) {
    throw new Error('Conditional branch type must be an integer from 0 to 13');
  }
  const currentType = currentParameters[0];
  if (!isFiniteInteger(currentType) || currentType < 0 || currentType > 13) {
    throw new Error('Conditional branch type must be an integer from 0 to 13');
  }
  const nextDrafts: Record<number, unknown[]> = Object.fromEntries(
    Object.entries(drafts).map(([type, parameters]) => [Number(type), cloneValue(parameters) as unknown[]]),
  );
  nextDrafts[currentType] = cloneValue(currentParameters) as unknown[];
  const parameters = nextDrafts[nextType]
    ? cloneValue(nextDrafts[nextType]) as unknown[]
    : cloneValue(createParameters(nextType)) as unknown[];
  nextDrafts[nextType] = cloneValue(parameters) as unknown[];
  return { drafts: nextDrafts, parameters };
}

/**
 * Update the variable-condition operand as one transaction. It deliberately
 * preserves p1 (left variable ID) and p4 (comparison operator), while p2/p3
 * are changed together so a render never observes a half-updated pair.
 */
export function updateConditionalVariableOperand(
  parameters: readonly unknown[],
  operand: 0 | 1,
): unknown[] {
  const next = [...parameters];
  validateConditionalBranchParameters(next);
  if (next[0] !== 1) throw new Error('Variable operand is only valid for type-1 conditions');
  next[2] = operand;
  next[3] = operand === 1 ? 1 : 0;
  return next;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function cloneCommand(command: ConditionalBranchCommand): ConditionalBranchCommand {
  return {
    code: command.code,
    indent: command.indent,
    parameters: cloneValue(command.parameters) as unknown[],
  };
}

function assertMarker(command: ConditionalBranchCommand, code: 411 | 412, index: number): void {
  if (command.code !== code || !Number.isInteger(command.indent) || command.indent < 0) {
    throw new Error(`Conditional branch marker ${code} at index ${index} is malformed`);
  }
  if (!Array.isArray(command.parameters) || command.parameters.length !== 0) {
    throw new Error(`Conditional branch marker ${code} at index ${index} must have no parameters`);
  }
}

/**
 * Inspect one complete code-111 block. The caller must pass the full block,
 * from its 111 head through its matching 412 terminator. Nested commands are
 * allowed; top-level 411/412 markers must remain unique and ordered.
 */
export function inspectConditionalBranchSpan(
  commands: readonly ConditionalBranchCommand[],
  engine: ConditionalBranchEngine = 'rpg-maker-mv',
): ConditionalBranchLayout {
  if (commands.length < 2) throw new Error('Conditional branch block is missing its 412 terminator');
  const head = commands[0];
  if (!head || head.code !== 111 || !Number.isInteger(head.indent) || head.indent < 0) {
    throw new Error('Conditional branch block must start with a valid 111 command');
  }
  validateConditionalBranchParameters(head.parameters, engine);

  const headIndent = head.indent;
  let elseIndex: number | null = null;
  let endIndex: number | null = null;
  const nestedConditions: Array<{ indent: number; hasElse: boolean }> = [];
  for (let index = 1; index < commands.length; index += 1) {
    const command = commands[index];
    if (!command || !Number.isInteger(command.code) || !Number.isInteger(command.indent) || command.indent < 0) {
      throw new Error(`Conditional branch command at index ${index} is malformed`);
    }
    if (command.indent < headIndent) {
      throw new Error(`Conditional branch command at index ${index} escapes the 111 block`);
    }
    if (command.code === 111) {
      if (command.indent <= headIndent) {
        throw new Error(`Nested conditional at index ${index} must be indented below its parent`);
      }
      validateConditionalBranchParameters(command.parameters, engine);
      nestedConditions.push({ indent: command.indent, hasElse: false });
      continue;
    }

    if (command.indent !== headIndent) {
      const nested = nestedConditions.at(-1);
      if (command.code === 411) {
        if (!nested || nested.indent !== command.indent || nested.hasElse) {
          throw new Error(`Nested conditional 411 marker at index ${index} is malformed`);
        }
        assertMarker(command, 411, index);
        nested.hasElse = true;
      } else if (command.code === 412) {
        if (!nested || nested.indent !== command.indent) {
          throw new Error(`Nested conditional 412 marker at index ${index} is malformed`);
        }
        assertMarker(command, 412, index);
        nestedConditions.pop();
      }
      continue;
    }

    if (nestedConditions.length) {
      throw new Error(`Top-level conditional marker at index ${index} closes an unclosed nested condition`);
    }

    if (command.code === 411) {
      if (elseIndex !== null) throw new Error('Conditional branch contains more than one top-level 411 marker');
      if (endIndex !== null) throw new Error('Conditional branch contains a 411 marker after 412');
      assertMarker(command, 411, index);
      elseIndex = index;
      continue;
    }
    if (command.code === 412) {
      if (endIndex !== null) throw new Error('Conditional branch contains more than one top-level 412 marker');
      assertMarker(command, 412, index);
      endIndex = index;
      if (index !== commands.length - 1) {
        throw new Error('Conditional branch has commands after its top-level 412 marker');
      }
      continue;
    }
    throw new Error(`Conditional branch command at index ${index} has invalid top-level indent/code`);
  }

  if (nestedConditions.length) throw new Error('Conditional branch contains an unclosed nested condition');
  if (endIndex === null) throw new Error('Conditional branch block is missing its top-level 412 marker');
  if (elseIndex !== null && elseIndex >= endIndex) {
    throw new Error('Conditional branch 411 marker must precede 412');
  }
  return { headIndent, elseIndex, endIndex };
}

/**
 * Add or remove the top-level Else marker without touching either branch body.
 * Removing an Else intentionally drops its body; the UI asks for confirmation
 * before calling this path when that body is non-empty.
 */
export function applyConditionalBranchElse(
  commands: readonly ConditionalBranchCommand[],
  includeElse: boolean,
  engine: ConditionalBranchEngine = 'rpg-maker-mv',
): ConditionalBranchCommand[] {
  if (!commands.length) throw new Error('Conditional branch block is empty');
  if (commands.length === 1) {
    const head = commands[0];
    if (!head || head.code !== 111) throw new Error('New conditional branch must start with 111');
    validateConditionalBranchParameters(head.parameters, engine);
    const end: ConditionalBranchCommand = { code: 412, indent: head.indent, parameters: [] };
    return includeElse
      ? [cloneCommand(head), { code: 411, indent: head.indent, parameters: [] }, end]
      : [cloneCommand(head), end];
  }

  const layout = inspectConditionalBranchSpan(commands, engine);
  const end = cloneCommand(commands[layout.endIndex]!);
  if (includeElse) {
    if (layout.elseIndex !== null) return commands.map(cloneCommand);
    return [
      ...commands.slice(0, layout.endIndex).map(cloneCommand),
      { code: 411, indent: layout.headIndent, parameters: [] },
      end,
    ];
  }

  if (layout.elseIndex === null) return commands.map(cloneCommand);
  return [
    ...commands.slice(0, layout.elseIndex).map(cloneCommand),
    end,
  ];
}

/** Count substantive commands in the top-level Else body; RM placeholder rows are insertion points. */
export function conditionalElseBodyCommandCount(
  commands: readonly ConditionalBranchCommand[],
  engine: ConditionalBranchEngine = 'rpg-maker-mv',
): number {
  const layout = inspectConditionalBranchSpan(commands, engine);
  if (layout.elseIndex === null) return 0;
  return commands
    .slice(layout.elseIndex + 1, layout.endIndex)
    .filter((command) => command.code !== 0)
    .length;
}
