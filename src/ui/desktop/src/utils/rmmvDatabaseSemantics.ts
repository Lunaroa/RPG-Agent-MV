export interface MvTraitRecord extends Record<string, unknown> {
  code: number;
  dataId: number;
  value: number;
}

export interface MvEffectRecord extends Record<string, unknown> {
  code: number;
  dataId: number;
  value1: number;
  value2: number;
}

export interface MvSemanticReferences {
  elementId?: number;
  stateId?: number;
  skillTypeId?: number;
  skillId?: number;
  weaponTypeId?: number;
  armorTypeId?: number;
  equipTypeId?: number;
  commonEventId?: number;
}

export interface MvNumericEditorSpec {
  field: 'value' | 'value1' | 'value2';
  kind: 'integer' | 'percent';
  minimum: number;
  maximum: number;
  step: number;
  label: 'rate' | 'amount' | 'flat' | 'turns' | 'probability' | 'speed' | 'times';
}

export interface MvEffectNumericEditorSpec extends Omit<MvNumericEditorSpec, 'field'> {
  field: 'value1' | 'value2';
}

export const MV_STANDARD_TRAIT_CODES = [
  11, 12, 13, 14,
  21, 22, 23,
  31, 32, 33, 34,
  41, 42, 43, 44,
  51, 52, 53, 54, 55,
  61, 62, 63, 64,
] as const;

export const MV_STANDARD_EFFECT_CODES = [
  11, 12, 13,
  21, 22,
  31, 32, 33, 34,
  41, 42, 43, 44,
] as const;

const TRAIT_CODES = new Set<number>(MV_STANDARD_TRAIT_CODES);
const EFFECT_CODES = new Set<number>(MV_STANDARD_EFFECT_CODES);
const TRAIT_PERCENT_CODES = new Set([11, 12, 13, 21, 22, 23, 32, 61]);

export function isStandardMvTraitCode(value: unknown): value is typeof MV_STANDARD_TRAIT_CODES[number] {
  return Number.isInteger(value) && TRAIT_CODES.has(Number(value));
}

export function isStandardMvEffectCode(value: unknown): value is typeof MV_STANDARD_EFFECT_CODES[number] {
  return Number.isInteger(value) && EFFECT_CODES.has(Number(value));
}

export function normalizeMvTrait(value: unknown): MvTraitRecord {
  const source = asRecord(value);
  return {
    ...source,
    code: finiteNumber(source.code, 0),
    dataId: finiteNumber(source.dataId, 0),
    value: finiteNumber(source.value, 0),
  };
}

export function createStandardMvTrait(
  code: typeof MV_STANDARD_TRAIT_CODES[number] = 21,
  references: MvSemanticReferences = {},
): MvTraitRecord {
  return setStandardMvTraitCode({}, code, references);
}

export function setStandardMvTraitCode(
  value: unknown,
  code: typeof MV_STANDARD_TRAIT_CODES[number],
  references: MvSemanticReferences = {},
): MvTraitRecord {
  if (!isStandardMvTraitCode(code)) throw new RangeError(`Unsupported standard MV trait code: ${String(code)}`);
  const source = asRecord(value);
  return {
    ...source,
    code,
    dataId: defaultTraitDataId(code, references),
    value: defaultTraitValue(code),
  };
}

export function mvTraitNumericSpec(code: number): MvNumericEditorSpec | null {
  if ([11, 12, 13, 21, 23, 32].includes(code)) {
    return { field: 'value', kind: 'percent', minimum: 0, maximum: 1000, step: 1, label: code === 32 ? 'probability' : 'rate' };
  }
  if (code === 22) return { field: 'value', kind: 'percent', minimum: -1000, maximum: 1000, step: 1, label: 'rate' };
  if (code === 33) return { field: 'value', kind: 'integer', minimum: -1000, maximum: 1000, step: 1, label: 'speed' };
  if (code === 34) return { field: 'value', kind: 'integer', minimum: 0, maximum: 9, step: 1, label: 'times' };
  if (code === 61) return { field: 'value', kind: 'percent', minimum: 0, maximum: 100, step: 1, label: 'probability' };
  return null;
}

export function mvTraitEditorValue(value: unknown): number {
  const trait = normalizeMvTrait(value);
  return TRAIT_PERCENT_CODES.has(trait.code) ? roundEditorNumber(trait.value * 100) : trait.value;
}

export function setMvTraitEditorValue(value: unknown, amount: unknown): MvTraitRecord {
  const trait = normalizeMvTrait(value);
  const spec = mvTraitNumericSpec(trait.code);
  if (!spec) return trait;
  const editorValue = clampNumber(amount, spec.minimum, spec.maximum, spec.kind === 'integer');
  return { ...trait, value: spec.kind === 'percent' ? editorValue / 100 : editorValue };
}

export function normalizeMvEffect(value: unknown): MvEffectRecord {
  const source = asRecord(value);
  return {
    ...source,
    code: finiteNumber(source.code, 0),
    dataId: finiteNumber(source.dataId, 0),
    value1: finiteNumber(source.value1, 0),
    value2: finiteNumber(source.value2, 0),
  };
}

export function createStandardMvEffect(
  code: typeof MV_STANDARD_EFFECT_CODES[number] = 11,
  references: MvSemanticReferences = {},
): MvEffectRecord {
  return setStandardMvEffectCode({}, code, references);
}

export function setStandardMvEffectCode(
  value: unknown,
  code: typeof MV_STANDARD_EFFECT_CODES[number],
  references: MvSemanticReferences = {},
): MvEffectRecord {
  if (!isStandardMvEffectCode(code)) throw new RangeError(`Unsupported standard MV effect code: ${String(code)}`);
  const source = asRecord(value);
  const defaults = defaultEffectValues(code);
  return {
    ...source,
    code,
    dataId: defaultEffectDataId(code, references),
    value1: defaults.value1,
    value2: defaults.value2,
  };
}

export function mvEffectNumericSpecs(code: number): MvEffectNumericEditorSpec[] {
  switch (code) {
    case 11:
      return [
        { field: 'value1', kind: 'percent', minimum: -100, maximum: 100, step: 1, label: 'rate' },
        { field: 'value2', kind: 'integer', minimum: -999999, maximum: 999999, step: 1, label: 'flat' },
      ];
    case 12:
      return [
        { field: 'value1', kind: 'percent', minimum: -100, maximum: 100, step: 1, label: 'rate' },
        { field: 'value2', kind: 'integer', minimum: -9999, maximum: 9999, step: 1, label: 'flat' },
      ];
    case 13:
      return [{ field: 'value1', kind: 'integer', minimum: 0, maximum: 100, step: 1, label: 'amount' }];
    case 21:
      return [{ field: 'value1', kind: 'percent', minimum: 0, maximum: 1000, step: 1, label: 'probability' }];
    case 22:
      return [{ field: 'value1', kind: 'percent', minimum: 0, maximum: 100, step: 1, label: 'probability' }];
    case 31:
    case 32:
      return [{ field: 'value1', kind: 'integer', minimum: 1, maximum: 1000, step: 1, label: 'turns' }];
    case 42:
      return [{ field: 'value1', kind: 'integer', minimum: 1, maximum: 1000, step: 1, label: 'amount' }];
    default:
      return [];
  }
}

export function mvEffectEditorValue(value: unknown, field: 'value1' | 'value2'): number {
  const effect = normalizeMvEffect(value);
  const spec = mvEffectNumericSpecs(effect.code).find((candidate) => candidate.field === field);
  const stored = field === 'value1' ? effect.value1 : effect.value2;
  return spec?.kind === 'percent' ? roundEditorNumber(stored * 100) : stored;
}

export function setMvEffectEditorValue(
  value: unknown,
  field: 'value1' | 'value2',
  amount: unknown,
): MvEffectRecord {
  const effect = normalizeMvEffect(value);
  const spec = mvEffectNumericSpecs(effect.code).find((candidate) => candidate.field === field);
  if (!spec) return effect;
  const editorValue = clampNumber(amount, spec.minimum, spec.maximum, spec.kind === 'integer');
  return { ...effect, [field]: spec.kind === 'percent' ? editorValue / 100 : editorValue };
}

export function classParameterValueRange(paramIndex: number): { minimum: number; maximum: number } {
  if (!Number.isInteger(paramIndex) || paramIndex < 0 || paramIndex > 7) {
    throw new RangeError(`Invalid MV class parameter index: ${String(paramIndex)}`);
  }
  if (paramIndex === 0) return { minimum: 1, maximum: 9999 };
  if (paramIndex === 1) return { minimum: 0, maximum: 9999 };
  return { minimum: 1, maximum: 999 };
}

function defaultTraitDataId(code: number, references: MvSemanticReferences): number {
  if (code === 11 || code === 31) return positiveReference(references.elementId);
  if (code === 13 || code === 14 || code === 32) return positiveReference(references.stateId);
  if (code === 41 || code === 42) return positiveReference(references.skillTypeId);
  if (code === 43 || code === 44) return positiveReference(references.skillId);
  if (code === 51) return positiveReference(references.weaponTypeId);
  if (code === 52) return positiveReference(references.armorTypeId);
  if (code === 53 || code === 54) return positiveReference(references.equipTypeId);
  if (code === 55) return 1;
  return 0;
}

function defaultTraitValue(code: number): number {
  if (code === 22 || code === 33) return 0;
  return 1;
}

function defaultEffectDataId(code: number, references: MvSemanticReferences): number {
  if (code === 21) return 0;
  if (code === 22) return positiveReference(references.stateId);
  if (code === 43) return positiveReference(references.skillId);
  if (code === 44) return positiveReference(references.commonEventId);
  return 0;
}

function defaultEffectValues(code: number): { value1: number; value2: number } {
  if (code === 21 || code === 22) return { value1: 1, value2: 0 };
  if (code === 31 || code === 32 || code === 42) return { value1: 1, value2: 0 };
  return { value1: 0, value2: 0 };
}

function positiveReference(value: unknown): number {
  const integer = Number(value);
  return Number.isInteger(integer) && integer > 0 ? integer : 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, integer: boolean): number {
  const numeric = finiteNumber(value, minimum);
  const normalized = integer ? Math.trunc(numeric) : numeric;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function roundEditorNumber(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}
