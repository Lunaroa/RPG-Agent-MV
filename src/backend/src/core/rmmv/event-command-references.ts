import { validateEventCommandList, type RawEventCommand } from "./event-command-registry.ts";
import type { RmmvDatabaseTableKey } from "./database-schema.ts";
import type { RpgMakerEngine } from "./rpg-maker-engine.ts";

export type RmmvEventReferenceTarget =
  | RmmvDatabaseTableKey
  | "switches"
  | "variables"
  | "maps"
  | "equipTypes";

export interface RmmvEventCommandReference {
  target: RmmvEventReferenceTarget;
  value: unknown;
  endValue?: unknown;
  path: string;
  endPath?: string;
  commandIndex: number;
  specialValues?: readonly number[];
}

export function collectEventCommandReferences(
  commandList: unknown,
  pathPrefix = "eventCommandList",
  engine: RpgMakerEngine = "rpg-maker-mv",
): RmmvEventCommandReference[] {
  validateEventCommandList(commandList, pathPrefix, engine);
  const references: RmmvEventCommandReference[] = [];
  commandList.forEach((command, commandIndex) => {
    collectCommandReferences(command, commandIndex, pathPrefix, references);
  });
  return references;
}

export function collectRawEventCommandReferences(
  commandList: unknown,
  pathPrefix = "eventCommandList",
): RmmvEventCommandReference[] {
  if (!Array.isArray(commandList)) return [];
  const references: RmmvEventCommandReference[] = [];
  commandList.forEach((value, commandIndex) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const command = value as Partial<RawEventCommand>;
    if (!Number.isInteger(command.code) || !Array.isArray(command.parameters)) return;
    collectCommandReferences(command as RawEventCommand, commandIndex, pathPrefix, references);
  });
  return references;
}

function collectCommandReferences(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  references: RmmvEventCommandReference[],
): void {
  const add = (
    parameterIndex: number,
    target: RmmvEventReferenceTarget,
    specialValues?: readonly number[],
  ): void => {
    references.push({
      target,
      value: command.parameters[parameterIndex],
      path: `${pathPrefix}[${commandIndex}].parameters[${parameterIndex}]`,
      commandIndex,
      ...(specialValues ? { specialValues } : {}),
    });
  };
  const addRange = (startIndex: number, endIndex: number, target: "switches" | "variables"): void => {
    references.push({
      target,
      value: command.parameters[startIndex],
      endValue: command.parameters[endIndex],
      path: `${pathPrefix}[${commandIndex}].parameters[${startIndex}]`,
      endPath: `${pathPrefix}[${commandIndex}].parameters[${endIndex}]`,
      commandIndex,
    });
  };

  switch (command.code) {
    case 103:
    case 104:
      add(0, "variables");
      return;
    case 121:
      addRange(0, 1, "switches");
      return;
    case 122:
      addRange(0, 1, "variables");
      collectOperandReferences(command, commandIndex, pathPrefix, 2, references);
      return;
    case 111:
      collectConditionalReferences(command, commandIndex, pathPrefix, references);
      return;
    case 117:
      add(0, "commonEvents");
      return;
    case 125:
      collectOperandReferences(command, commandIndex, pathPrefix, 0, references);
      return;
    case 126:
      add(0, "items");
      collectOperandReferences(command, commandIndex, pathPrefix, 1, references);
      return;
    case 127:
      add(0, "weapons");
      collectOperandReferences(command, commandIndex, pathPrefix, 1, references);
      return;
    case 128:
      add(0, "armors");
      collectOperandReferences(command, commandIndex, pathPrefix, 1, references);
      return;
    case 129:
      add(0, "actors");
      return;
    case 311:
    case 312:
    case 315:
    case 316:
    case 326:
      collectActorTarget(command, commandIndex, pathPrefix, references);
      collectOperandReferences(command, commandIndex, pathPrefix, 2, references);
      return;
    case 313:
      collectActorTarget(command, commandIndex, pathPrefix, references);
      add(3, "states");
      return;
    case 314:
      collectActorTarget(command, commandIndex, pathPrefix, references);
      return;
    case 317:
      collectActorTarget(command, commandIndex, pathPrefix, references);
      collectOperandReferences(command, commandIndex, pathPrefix, 3, references);
      return;
    case 318:
      collectActorTarget(command, commandIndex, pathPrefix, references);
      add(3, "skills");
      return;
    case 319: {
      add(0, "actors");
      add(1, "equipTypes");
      add(2, command.parameters[1] === 1 ? "weapons" : "armors", [0]);
      return;
    }
    case 320:
    case 324:
    case 325:
      add(0, "actors");
      return;
    case 321:
      add(0, "actors");
      add(1, "classes");
      return;
    case 201:
      collectLocationReferences(command, commandIndex, pathPrefix, 0, 1, references);
      return;
    case 202:
      collectLocationReferences(command, commandIndex, pathPrefix, 1, 2, references);
      return;
    case 203:
      if (command.parameters[1] === 1) {
        add(2, "variables");
        add(3, "variables");
      }
      return;
    case 205:
      collectMoveRouteReferences(command, commandIndex, pathPrefix, references);
      return;
    case 212:
      add(1, "animations");
      return;
    case 301:
      if (command.parameters[0] === 0) add(1, "troops");
      if (command.parameters[0] === 1) add(1, "variables");
      return;
    case 302:
    case 605:
      collectShopGoodsReference(command, commandIndex, pathPrefix, references);
      return;
    case 303:
    case 322:
      add(0, "actors");
      return;
    case 282:
      add(0, "tilesets");
      return;
    case 285:
      add(0, "variables");
      if (command.parameters[2] === 1) {
        add(3, "variables");
        add(4, "variables");
      }
      return;
    case 331:
    case 332:
    case 342:
      collectOperandReferences(command, commandIndex, pathPrefix, 1, references);
      return;
    case 333:
      add(2, "states");
      return;
    case 336:
      add(1, "enemies");
      return;
    case 337:
      add(1, "animations");
      return;
    case 339:
      if (command.parameters[0] === 1) add(1, "actors");
      add(2, "skills");
      return;
    default:
      return;
  }
}

function collectConditionalReferences(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  references: RmmvEventCommandReference[],
): void {
  const conditionType = command.parameters[0];
  const add = (parameterIndex: number, target: RmmvEventReferenceTarget): void => {
    references.push({
      target,
      value: command.parameters[parameterIndex],
      path: `${pathPrefix}[${commandIndex}].parameters[${parameterIndex}]`,
      commandIndex,
    });
  };
  if (conditionType === 0) {
    add(1, "switches");
  } else if (conditionType === 1) {
    add(1, "variables");
    if (command.parameters[2] === 1) add(3, "variables");
  } else if (conditionType === 4) {
    add(1, "actors");
    const actorConditionTargets: Partial<Record<number, RmmvEventReferenceTarget>> = {
      2: "classes",
      3: "skills",
      4: "weapons",
      5: "armors",
      6: "states",
    };
    const target = Number.isInteger(command.parameters[2])
      ? actorConditionTargets[Number(command.parameters[2])]
      : undefined;
    if (target) add(3, target);
  } else if (conditionType === 5 && command.parameters[2] === 1) {
    add(3, "states");
  } else if (conditionType === 8) {
    add(1, "items");
  } else if (conditionType === 9) {
    add(1, "weapons");
  } else if (conditionType === 10) {
    add(1, "armors");
  }
}

function collectActorTarget(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  references: RmmvEventCommandReference[],
): void {
  if (command.parameters[0] === 1) {
    references.push({
      target: "variables",
      value: command.parameters[1],
      path: `${pathPrefix}[${commandIndex}].parameters[1]`,
      commandIndex,
    });
    return;
  }
  if (command.parameters[0] !== 0) return;
  references.push({
    target: "actors",
    value: command.parameters[1],
    path: `${pathPrefix}[${commandIndex}].parameters[1]`,
    commandIndex,
    specialValues: [0],
  });
}

function collectOperandReferences(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  operationIndex: number,
  references: RmmvEventCommandReference[],
): void {
  const operandTypeIndex = operationIndex + 1;
  const operandIndex = operationIndex + 2;
  if (command.parameters[operandTypeIndex] === 1) {
    references.push({
      target: "variables",
      value: command.parameters[operandIndex],
      path: `${pathPrefix}[${commandIndex}].parameters[${operandIndex}]`,
      commandIndex,
    });
  } else if (command.parameters[operandTypeIndex] === 3) {
    collectGameDataOperand(command, commandIndex, pathPrefix, operandIndex, references);
  }
}

function collectGameDataOperand(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  gameDataTypeIndex: number,
  references: RmmvEventCommandReference[],
): void {
  const targets: Partial<Record<number, RmmvEventReferenceTarget>> = {
    0: "items",
    1: "weapons",
    2: "armors",
    3: "actors",
  };
  const gameDataType = command.parameters[gameDataTypeIndex];
  const target = Number.isInteger(gameDataType) ? targets[Number(gameDataType)] : undefined;
  if (!target) return;
  const idIndex = gameDataTypeIndex + 1;
  references.push({
    target,
    value: command.parameters[idIndex],
    path: `${pathPrefix}[${commandIndex}].parameters[${idIndex}]`,
    commandIndex,
  });
}

function collectLocationReferences(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  locationTypeIndex: number,
  firstLocationIndex: number,
  references: RmmvEventCommandReference[],
): void {
  const target = command.parameters[locationTypeIndex] === 0 ? "maps" : "variables";
  const count = target === "maps" ? 1 : 3;
  for (let offset = 0; offset < count; offset += 1) {
    const parameterIndex = firstLocationIndex + offset;
    references.push({
      target,
      value: command.parameters[parameterIndex],
      path: `${pathPrefix}[${commandIndex}].parameters[${parameterIndex}]`,
      commandIndex,
    });
  }
}

function collectMoveRouteReferences(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  references: RmmvEventCommandReference[],
): void {
  const route = command.parameters[1];
  if (!route || typeof route !== "object" || Array.isArray(route)) return;
  const list = (route as { list?: unknown }).list;
  if (!Array.isArray(list)) return;
  list.forEach((step, stepIndex) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return;
    const move = step as { code?: unknown; parameters?: unknown[] };
    if ((move.code !== 27 && move.code !== 28) || !Array.isArray(move.parameters)) return;
    references.push({
      target: "switches",
      value: move.parameters[0],
      path: `${pathPrefix}[${commandIndex}].parameters[1].list[${stepIndex}].parameters[0]`,
      commandIndex,
    });
  });
}

function collectShopGoodsReference(
  command: RawEventCommand,
  commandIndex: number,
  pathPrefix: string,
  references: RmmvEventCommandReference[],
): void {
  const targets: Partial<Record<number, RmmvDatabaseTableKey>> = {
    0: "items",
    1: "weapons",
    2: "armors",
  };
  const goodsType = command.parameters[0];
  const target = Number.isInteger(goodsType) ? targets[Number(goodsType)] : undefined;
  if (!target) return;
  references.push({
    target,
    value: command.parameters[1],
    path: `${pathPrefix}[${commandIndex}].parameters[1]`,
    commandIndex,
  });
}
