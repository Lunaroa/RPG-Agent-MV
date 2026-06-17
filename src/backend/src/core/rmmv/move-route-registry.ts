export type MoveRouteParameterType =
  | "integer"
  | "string"
  | "audio";

export interface MoveRouteParameterSchema {
  index: number;
  name: string;
  type: MoveRouteParameterType;
  min?: number;
  max?: number;
}

export interface MoveRouteCommandDefinition {
  code: number;
  name: string;
  parameters: readonly MoveRouteParameterSchema[];
  defaultParameters: readonly unknown[];
}

export interface MoveRouteCommand {
  code: number;
  parameters: unknown[];
}

const int = (index: number, name: string, min?: number, max?: number): MoveRouteParameterSchema => ({
  index,
  name,
  type: "integer",
  ...(min === undefined ? {} : { min }),
  ...(max === undefined ? {} : { max })
});

const str = (index: number, name: string): MoveRouteParameterSchema => ({ index, name, type: "string" });
const audio = (index: number, name: string): MoveRouteParameterSchema => ({ index, name, type: "audio" });

const seDefault = Object.freeze({ name: "", volume: 90, pitch: 100, pan: 0 });

const route = (
  code: number,
  name: string,
  parameters: readonly MoveRouteParameterSchema[] = [],
  defaultParameters: readonly unknown[] = []
): MoveRouteCommandDefinition => ({ code, name, parameters, defaultParameters });

export const MOVE_ROUTE_COMMAND_DEFINITIONS: readonly MoveRouteCommandDefinition[] = Object.freeze([
  route(0, "End of Move Route"),
  route(1, "Move Down"),
  route(2, "Move Left"),
  route(3, "Move Right"),
  route(4, "Move Up"),
  route(5, "Move Lower Left"),
  route(6, "Move Lower Right"),
  route(7, "Move Upper Left"),
  route(8, "Move Upper Right"),
  route(9, "Move at Random"),
  route(10, "Move toward Player"),
  route(11, "Move away from Player"),
  route(12, "One Step Forward"),
  route(13, "One Step Backward"),
  route(14, "Jump", [int(0, "x"), int(1, "y")], [0, 0]),
  route(15, "Wait", [int(0, "frames", 1)], [60]),
  route(16, "Turn Down"),
  route(17, "Turn Left"),
  route(18, "Turn Right"),
  route(19, "Turn Up"),
  route(20, "Turn 90 Degrees Right"),
  route(21, "Turn 90 Degrees Left"),
  route(22, "Turn 180 Degrees"),
  route(23, "Turn 90 Degrees Right or Left"),
  route(24, "Turn at Random"),
  route(25, "Turn toward Player"),
  route(26, "Turn away from Player"),
  route(27, "Switch ON", [int(0, "switchId", 1)], [1]),
  route(28, "Switch OFF", [int(0, "switchId", 1)], [1]),
  route(29, "Change Speed", [int(0, "speed", 1, 6)], [4]),
  route(30, "Change Frequency", [int(0, "frequency", 1, 5)], [3]),
  route(31, "Walking Animation ON"),
  route(32, "Walking Animation OFF"),
  route(33, "Stepping Animation ON"),
  route(34, "Stepping Animation OFF"),
  route(35, "Direction Fix ON"),
  route(36, "Direction Fix OFF"),
  route(37, "Through ON"),
  route(38, "Through OFF"),
  route(39, "Transparent ON"),
  route(40, "Transparent OFF"),
  route(41, "Change Image", [str(0, "characterName"), int(1, "characterIndex", 0, 7)], ["", 0]),
  route(42, "Change Opacity", [int(0, "opacity", 0, 255)], [255]),
  route(43, "Change Blend Mode", [int(0, "blendMode", 0, 3)], [0]),
  route(44, "Play SE", [audio(0, "se")], [seDefault]),
  route(45, "Script", [str(0, "script")], [""])
]);

export const STANDARD_MOVE_ROUTE_CODES: readonly number[] = Object.freeze(MOVE_ROUTE_COMMAND_DEFINITIONS.map((definition) => definition.code));

const moveRouteDefinitionByCode = new Map<number, MoveRouteCommandDefinition>(
  MOVE_ROUTE_COMMAND_DEFINITIONS.map((definition) => [definition.code, definition])
);

assertRegistryIntegrity();

export function moveRouteCommandDefinition(code: number): MoveRouteCommandDefinition | undefined {
  return moveRouteDefinitionByCode.get(code);
}

export function isKnownMoveRouteCode(code: number): boolean {
  return moveRouteDefinitionByCode.has(code);
}

export function defaultMoveRouteParameters(code: number): unknown[] {
  const definition = moveRouteCommandDefinition(code);
  if (!definition) throw new Error(`Unknown RMMV move route command code ${code}`);
  return clone([...definition.defaultParameters]);
}

export function validateMoveRouteCommandBasic(command: unknown, label = "moveRouteCommand"): asserts command is MoveRouteCommand {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error(`${label} must be an object with code/parameters`);
  }
  const cmd = command as MoveRouteCommand;
  if (!Number.isInteger(cmd.code) || cmd.code < 0) {
    throw new Error(`${label}.code must be a non-negative integer`);
  }
  if (!Array.isArray(cmd.parameters)) {
    throw new Error(`${label}.parameters must be an array`);
  }
  const definition = moveRouteCommandDefinition(cmd.code);
  if (!definition) {
    throw new Error(`${label}.code ${cmd.code} is not a standard RPG Maker MV move route command code`);
  }
  validateParameters(definition, cmd.parameters, label);
}

function validateParameters(definition: MoveRouteCommandDefinition, parameters: unknown[], label: string): void {
  const expectedLength = definition.parameters.length
    ? Math.max(...definition.parameters.map((parameter) => parameter.index)) + 1
    : 0;
  if (parameters.length !== expectedLength) {
    throw new Error(`${label}.parameters for move route code ${definition.code} must have ${expectedLength} value(s); got ${parameters.length}`);
  }
  for (const parameter of definition.parameters) {
    validateParameter(parameter, parameters[parameter.index], `${label}.parameters[${parameter.index}]`);
  }
}

function validateParameter(schema: MoveRouteParameterSchema, value: unknown, label: string): void {
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${label} (${schema.name}) must be an integer`);
    if (schema.min !== undefined && (value as number) < schema.min) throw new Error(`${label} (${schema.name}) must be >= ${schema.min}`);
    if (schema.max !== undefined && (value as number) > schema.max) throw new Error(`${label} (${schema.name}) must be <= ${schema.max}`);
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw new Error(`${label} (${schema.name}) must be a string`);
    return;
  }
  if (schema.type === "audio") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} (${schema.name}) must be an RPG Maker MV audio object`);
    const audioValue = value as { name?: unknown; volume?: unknown; pitch?: unknown; pan?: unknown };
    if (typeof audioValue.name !== "string") throw new Error(`${label}.name must be a string`);
    for (const key of ["volume", "pitch", "pan"] as const) {
      if (!Number.isFinite(audioValue[key])) throw new Error(`${label}.${key} must be a number`);
    }
  }
}

function assertRegistryIntegrity(): void {
  const expected = Array.from({ length: 46 }, (_value, index) => index);
  if (MOVE_ROUTE_COMMAND_DEFINITIONS.length !== expected.length) {
    throw new Error(`RMMV move route registry must cover codes 0-45; got ${MOVE_ROUTE_COMMAND_DEFINITIONS.length}`);
  }
  const codes = MOVE_ROUTE_COMMAND_DEFINITIONS.map((definition) => definition.code);
  if (new Set(codes).size !== codes.length) throw new Error("RMMV move route registry has duplicate codes");
  for (const code of expected) {
    if (!moveRouteDefinitionByCode.has(code)) throw new Error(`RMMV move route registry is missing code ${code}`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
