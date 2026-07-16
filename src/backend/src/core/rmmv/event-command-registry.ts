import { validateMoveRouteCommandBasic } from "./move-route-registry.ts";
import type { RpgMakerEngine } from "./rpg-maker-engine.ts";

export type EventCommandParameterType =
  | "integer"
  | "number"
  | "string"
  | "boolean"
  | "enum"
  | "audio"
  | "tone"
  | "color"
  | "stringArray"
  | "stringRecord"
  | "moveRoute"
  | "moveRouteCommand"
  | "any";

export interface EventCommandParameterSchema {
  index: number;
  name: string;
  type: EventCommandParameterType;
  optional?: boolean;
  min?: number;
  max?: number;
  enumValues?: readonly (number | string | boolean)[];
}

export type EventCommandBlockKind = "none" | "multiline" | "structured" | "continuation" | "terminator";

export interface EventCommandBlockMetadata {
  kind: EventCommandBlockKind;
  optional?: boolean;
  continuationCodes?: readonly number[];
  branchCodes?: readonly number[];
  endCode?: number;
  parentCode?: number;
}

export interface EventCommandDefinition {
  code: number;
  name: string;
  category: string;
  parameters: readonly EventCommandParameterSchema[];
  defaultParameters: readonly unknown[];
  parameterMode: "exact" | "min";
  block: EventCommandBlockMetadata;
  standard: boolean;
}

export interface RawEventCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

const none = Object.freeze({ kind: "none" as const });
const integer = (index: number, name: string, min?: number, max?: number): EventCommandParameterSchema => ({
  index,
  name,
  type: "integer",
  ...(min === undefined ? {} : { min }),
  ...(max === undefined ? {} : { max })
});
const numberParam = (index: number, name: string, min?: number, max?: number): EventCommandParameterSchema => ({
  index,
  name,
  type: "number",
  ...(min === undefined ? {} : { min }),
  ...(max === undefined ? {} : { max })
});
const string = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "string" });
const boolean = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "boolean" });
const any = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "any" });
const optionalAny = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "any", optional: true });
const audio = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "audio" });
const tone = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "tone" });
const color = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "color" });
const stringArray = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "stringArray" });
const stringRecord = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "stringRecord" });
const moveRoute = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "moveRoute" });
const moveRouteCommand = (index: number, name: string): EventCommandParameterSchema => ({ index, name, type: "moveRouteCommand" });
const choice = (index: number, name: string, enumValues: readonly (number | string | boolean)[]): EventCommandParameterSchema => ({
  index,
  name,
  type: "enum",
  enumValues
});

const audioDefault = Object.freeze({ name: "", volume: 90, pitch: 100, pan: 0 });
const emptyTone = Object.freeze([0, 0, 0, 0]);
const flashColor = Object.freeze([255, 255, 255, 170]);

const ON_OFF = [0, 1] as const;
const INCREASE_DECREASE = [0, 1] as const;
const ENABLE_DISABLE = [0, 1] as const;
const ACTOR_TARGET = [0, 1] as const;
const OPERATION = [0, 1, 2, 3, 4, 5] as const;
const OPERAND = [0, 1, 2, 3, 4] as const;
const LOCATION_OPERAND = [0, 1] as const;
const DIRECTION = [0, 2, 4, 6, 8] as const;
const EVENT_TARGET = [-1, 0] as const;
const VEHICLE = [0, 1, 2] as const;

const command = (
  code: number,
  name: string,
  category: string,
  parameters: readonly EventCommandParameterSchema[] = [],
  defaultParameters: readonly unknown[] = [],
  options: Partial<Pick<EventCommandDefinition, "parameterMode" | "block" | "standard">> = {}
): EventCommandDefinition => ({
  code,
  name,
  category,
  parameters,
  defaultParameters,
  parameterMode: options.parameterMode || "exact",
  block: options.block || none,
  standard: options.standard !== false
});

const actorTargetParameters = (offset = 0): EventCommandParameterSchema[] => [
  choice(offset, "actorTargetType", ACTOR_TARGET),
  integer(offset + 1, "actorIdOrPartyIndex", 0)
];

const operandParameters = (offset = 0): EventCommandParameterSchema[] => [
  choice(offset, "operation", INCREASE_DECREASE),
  choice(offset + 1, "operandType", OPERAND),
  any(offset + 2, "operand")
];

const enemyOperandParameters = (allowDeath: boolean): EventCommandParameterSchema[] => [
  integer(0, "enemyIndex", -1),
  ...operandParameters(1),
  ...(allowDeath ? [boolean(4, "allowDeath")] : [])
];

const picturePlacementParameters = (includeName: boolean): EventCommandParameterSchema[] => [
  integer(0, "pictureId", 1),
  ...(includeName ? [string(1, "pictureName")] : [any(1, "reservedPictureNameSlot")]),
  choice(2, "origin", [0, 1]),
  choice(3, "positionType", LOCATION_OPERAND),
  numberParam(4, "x"),
  numberParam(5, "y"),
  numberParam(6, "scaleX"),
  numberParam(7, "scaleY"),
  integer(8, "opacity", 0, 255),
  choice(9, "blendMode", [0, 1, 2, 3])
];

const structured = (
  continuationCodes: readonly number[] = [],
  branchCodes: readonly number[] = [],
  endCode?: number,
  optional = false,
): EventCommandBlockMetadata => ({
  kind: "structured",
  ...(optional ? { optional: true } : {}),
  ...(continuationCodes.length ? { continuationCodes } : {}),
  ...(branchCodes.length ? { branchCodes } : {}),
  ...(endCode === undefined ? {} : { endCode })
});

const multiline = (continuationCodes: readonly number[]): EventCommandBlockMetadata => ({
  kind: "multiline",
  continuationCodes
});

const child = (kind: "continuation" | "terminator", parentCode: number): EventCommandBlockMetadata => ({
  kind,
  parentCode
});

export const STANDARD_EVENT_COMMAND_CODES: readonly number[] = Object.freeze([
  101, 102, 103, 104, 105, 121, 122, 123, 124, 111, 112, 113, 115, 117, 118, 119, 108,
  125, 126, 127, 128, 129, 311, 312, 326, 313, 314, 315, 316, 317, 318, 319, 320, 321, 324, 325,
  201, 202, 203, 204, 205, 206, 211, 216, 217, 212, 213, 214, 231, 232, 233, 234, 235, 230,
  221, 222, 223, 224, 225, 236, 241, 242, 243, 244, 245, 246, 249, 250, 251, 261,
  301, 302, 303, 351, 352, 353, 354, 132, 133, 139, 140, 134, 135, 136, 137, 138, 322, 323,
  281, 282, 283, 284, 285, 331, 332, 342, 333, 334, 335, 336, 337, 339, 340, 355, 356
]);

export const STANDARD_EVENT_COMMAND_DEFINITIONS: readonly EventCommandDefinition[] = Object.freeze([
  command(101, "Show Text", "Message", [string(0, "faceName"), integer(1, "faceIndex", 0, 7), choice(2, "background", [0, 1, 2]), choice(3, "positionType", [0, 1, 2])], ["", 0, 0, 2], { block: multiline([401]) }),
  command(102, "Show Choices", "Message", [stringArray(0, "choices"), integer(1, "cancelType", -2), integer(2, "defaultType", -1), choice(3, "positionType", [0, 1, 2]), choice(4, "background", [0, 1, 2])], [["Yes", "No"], 0, 0, 2, 0], { parameterMode: "min", block: structured([], [402, 403], 404) }),
  command(103, "Input Number", "Message", [integer(0, "variableId", 1), integer(1, "maxDigits", 1, 8)], [1, 1]),
  command(104, "Select Item", "Message", [integer(0, "variableId", 1), choice(1, "itemType", [1, 2, 3, 4])], [1, 2]),
  command(105, "Show Scrolling Text", "Message", [integer(0, "speed", 1, 8), boolean(1, "noFastForward")], [2, false], { block: multiline([405]) }),

  command(121, "Control Switches", "Game Progression", [integer(0, "startSwitchId", 1), integer(1, "endSwitchId", 1), choice(2, "value", ON_OFF)], [1, 1, 0]),
  command(122, "Control Variables", "Game Progression", [integer(0, "startVariableId", 1), integer(1, "endVariableId", 1), choice(2, "operation", OPERATION), choice(3, "operandType", OPERAND), any(4, "operand"), optionalAny(5, "operandExtraA"), optionalAny(6, "operandExtraB")], [1, 1, 0, 0, 0], { parameterMode: "min" }),
  command(123, "Control Self Switch", "Game Progression", [choice(0, "selfSwitch", ["A", "B", "C", "D"]), choice(1, "value", ON_OFF)], ["A", 0]),
  command(124, "Control Timer", "Game Progression", [
    choice(0, "operation", [0, 1]),
    { ...integer(1, "seconds", 0), optional: true },
  ], [0, 60], { parameterMode: "min" }),

  command(111, "Conditional Branch", "Flow Control", [choice(0, "conditionType", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), any(1, "operandA"), optionalAny(2, "operandB"), optionalAny(3, "operandC"), optionalAny(4, "operandD")], [0, 1, 0], { parameterMode: "min", block: structured([], [411], 412) }),
  command(112, "Loop", "Flow Control", [], [], { block: structured([], [], 413) }),
  command(113, "Break Loop", "Flow Control"),
  command(115, "Exit Event Processing", "Flow Control"),
  command(117, "Common Event", "Flow Control", [integer(0, "commonEventId", 1)], [1]),
  command(118, "Label", "Flow Control", [string(0, "label")], ["Label"]),
  command(119, "Jump to Label", "Flow Control", [string(0, "label")], ["Label"]),
  command(108, "Comment", "Flow Control", [string(0, "text")], ["comment"], { block: multiline([408]) }),

  command(125, "Change Gold", "Party", operandParameters(), [0, 0, 50]),
  command(126, "Change Items", "Party", [integer(0, "itemId", 1), ...operandParameters(1)], [1, 0, 0, 1]),
  command(127, "Change Weapons", "Party", [integer(0, "weaponId", 1), ...operandParameters(1), boolean(4, "includeEquipment")], [1, 0, 0, 1, false]),
  command(128, "Change Armors", "Party", [integer(0, "armorId", 1), ...operandParameters(1), boolean(4, "includeEquipment")], [1, 0, 0, 1, false]),
  command(129, "Change Party Member", "Party", [integer(0, "actorId", 1), choice(1, "operation", INCREASE_DECREASE), boolean(2, "initialize")], [1, 0, false]),

  command(311, "Change HP", "Actor", [...actorTargetParameters(), ...operandParameters(2), boolean(5, "allowDeath")], [0, 1, 0, 0, 0, false]),
  command(312, "Change MP", "Actor", [...actorTargetParameters(), ...operandParameters(2)], [0, 1, 0, 0, 0]),
  command(326, "Change TP", "Actor", [...actorTargetParameters(), ...operandParameters(2)], [0, 1, 0, 0, 0]),
  command(313, "Change State", "Actor", [...actorTargetParameters(), choice(2, "operation", INCREASE_DECREASE), integer(3, "stateId", 1)], [0, 1, 0, 1]),
  command(314, "Recover All", "Actor", actorTargetParameters(), [0, 1]),
  command(315, "Change EXP", "Actor", [...actorTargetParameters(), ...operandParameters(2), boolean(5, "showLevelUp")], [0, 1, 0, 0, 0, false]),
  command(316, "Change Level", "Actor", [...actorTargetParameters(), ...operandParameters(2), boolean(5, "showLevelUp")], [0, 1, 0, 0, 0, false]),
  command(317, "Change Parameter", "Actor", [...actorTargetParameters(), choice(2, "parameterId", [0, 1, 2, 3, 4, 5, 6, 7]), ...operandParameters(3)], [0, 1, 0, 0, 0, 0]),
  command(318, "Change Skill", "Actor", [...actorTargetParameters(), choice(2, "operation", INCREASE_DECREASE), integer(3, "skillId", 1)], [0, 1, 0, 1]),
  command(319, "Change Equipment", "Actor", [integer(0, "actorId", 1), integer(1, "equipTypeId", 0), integer(2, "itemId", 0)], [1, 0, 0]),
  command(320, "Change Name", "Actor", [integer(0, "actorId", 1), string(1, "name")], [1, ""]),
  command(321, "Change Class", "Actor", [integer(0, "actorId", 1), integer(1, "classId", 1), boolean(2, "keepExp")], [1, 1, false]),
  command(324, "Change Nickname", "Actor", [integer(0, "actorId", 1), string(1, "nickname")], [1, ""]),
  command(325, "Change Profile", "Actor", [integer(0, "actorId", 1), string(1, "profile")], [1, ""]),

  command(201, "Transfer Player", "Movement", [choice(0, "locationType", LOCATION_OPERAND), integer(1, "mapIdOrVariableId", 0), integer(2, "xOrVariableId", 0), integer(3, "yOrVariableId", 0), choice(4, "direction", DIRECTION), choice(5, "fadeType", [0, 1, 2])], [0, 1, 0, 0, 2, 0]),
  command(202, "Set Vehicle Location", "Movement", [choice(0, "vehicleType", VEHICLE), choice(1, "locationType", LOCATION_OPERAND), integer(2, "mapIdOrVariableId", 0), integer(3, "xOrVariableId", 0), integer(4, "yOrVariableId", 0)], [0, 0, 1, 0, 0]),
  command(203, "Set Event Location", "Movement", [integer(0, "characterId", -1), choice(1, "locationType", [0, 1, 2]), integer(2, "xOrVariableIdOrCharacterId", 0), integer(3, "yOrVariableId", 0), choice(4, "direction", DIRECTION)], [0, 0, 0, 0, 0], { parameterMode: "min" }),
  command(204, "Scroll Map", "Movement", [choice(0, "direction", [2, 4, 6, 8]), integer(1, "distance", 1), integer(2, "speed", 1, 6), boolean(3, "wait")], [2, 1, 4, false]),
  command(205, "Set Movement Route", "Movement", [integer(0, "characterId", -1), moveRoute(1, "route")], [0, { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false }], { block: multiline([505]) }),
  command(206, "Get on/off Vehicle", "Movement"),

  command(211, "Change Transparency", "Character", [choice(0, "value", ON_OFF)], [0]),
  command(216, "Change Player Followers", "Character", [choice(0, "value", ON_OFF)], [0]),
  command(217, "Gather Followers", "Character"),
  command(212, "Show Animation", "Character", [integer(0, "characterId", -1), integer(1, "animationId", 1), boolean(2, "wait")], [0, 1, true]),
  command(213, "Show Balloon Icon", "Character", [integer(0, "characterId", -1), integer(1, "balloonId", 1, 10), boolean(2, "wait")], [0, 1, true]),
  command(214, "Erase Event", "Character"),

  command(231, "Show Picture", "Picture", picturePlacementParameters(true), [1, "", 0, 0, 0, 0, 100, 100, 255, 0]),
  command(232, "Move Picture", "Picture", [...picturePlacementParameters(false), integer(10, "duration", 0), boolean(11, "wait")], [1, 0, 0, 0, 0, 0, 100, 100, 255, 0, 60, true], { parameterMode: "min" }),
  command(233, "Rotate Picture", "Picture", [integer(0, "pictureId", 1), numberParam(1, "speed")], [1, 0]),
  command(234, "Tint Picture", "Picture", [integer(0, "pictureId", 1), tone(1, "tone"), integer(2, "duration", 0), boolean(3, "wait")], [1, emptyTone, 60, true]),
  command(235, "Erase Picture", "Picture", [integer(0, "pictureId", 1)], [1]),
  command(230, "Wait", "Timing", [integer(0, "frames", 1)], [60]),

  command(221, "Fadeout Screen", "Screen"),
  command(222, "Fadein Screen", "Screen"),
  command(223, "Tint Screen", "Screen", [tone(0, "tone"), integer(1, "duration", 0), boolean(2, "wait")], [emptyTone, 60, true]),
  command(224, "Flash Screen", "Screen", [color(0, "color"), integer(1, "duration", 0), boolean(2, "wait")], [flashColor, 30, true]),
  command(225, "Shake Screen", "Screen", [integer(0, "power", 1, 9), integer(1, "speed", 1, 9), integer(2, "duration", 0), boolean(3, "wait")], [5, 5, 30, true]),
  command(236, "Set Weather Effect", "Screen", [choice(0, "type", ["none", "rain", "storm", "snow"]), integer(1, "power", 0, 9), integer(2, "duration", 0), boolean(3, "wait")], ["none", 5, 60, true]),

  command(241, "Play BGM", "Audio/Video", [audio(0, "bgm")], [audioDefault]),
  command(242, "Fadeout BGM", "Audio/Video", [integer(0, "seconds", 0)], [10]),
  command(243, "Save BGM", "Audio/Video"),
  command(244, "Replay BGM", "Audio/Video"),
  command(245, "Play BGS", "Audio/Video", [audio(0, "bgs")], [audioDefault]),
  command(246, "Fadeout BGS", "Audio/Video", [integer(0, "seconds", 0)], [10]),
  command(249, "Play ME", "Audio/Video", [audio(0, "me")], [audioDefault]),
  command(250, "Play SE", "Audio/Video", [audio(0, "se")], [audioDefault]),
  command(251, "Stop SE", "Audio/Video"),
  command(261, "Play Movie", "Audio/Video", [string(0, "movieName")], [""]),

  command(301, "Battle Processing", "Scene Control", [choice(0, "troopSource", [0, 1, 2]), integer(1, "troopIdOrVariableId", 0), boolean(2, "canEscape"), boolean(3, "canLose")], [0, 1, true, false], { block: structured([], [601, 602, 603], 604, true) }),
  command(302, "Shop Processing", "Scene Control", [choice(0, "goodsType", [0, 1, 2]), integer(1, "itemId", 1), choice(2, "priceType", [0, 1]), integer(3, "price", 0), boolean(4, "purchaseOnly")], [0, 1, 0, 0, false], { block: multiline([605]) }),
  command(303, "Name Input Processing", "Scene Control", [integer(0, "actorId", 1), integer(1, "maxCharacters", 1, 16)], [1, 8]),
  command(351, "Open Menu Screen", "Scene Control"),
  command(352, "Open Save Screen", "Scene Control"),
  command(353, "Game Over", "Scene Control"),
  command(354, "Return to Title Screen", "Scene Control"),

  command(132, "Change Battle BGM", "System Settings", [audio(0, "bgm")], [audioDefault]),
  command(133, "Change Victory ME", "System Settings", [audio(0, "me")], [audioDefault]),
  command(139, "Change Defeat ME", "System Settings", [audio(0, "me")], [audioDefault]),
  command(140, "Change Vehicle BGM", "System Settings", [choice(0, "vehicleType", VEHICLE), audio(1, "bgm")], [0, audioDefault]),
  command(134, "Change Save Access", "System Settings", [choice(0, "value", ENABLE_DISABLE)], [0]),
  command(135, "Change Menu Access", "System Settings", [choice(0, "value", ENABLE_DISABLE)], [0]),
  command(136, "Change Encounter", "System Settings", [choice(0, "value", ENABLE_DISABLE)], [0]),
  command(137, "Change Formation Access", "System Settings", [choice(0, "value", ENABLE_DISABLE)], [0]),
  command(138, "Change Window Color", "System Settings", [color(0, "color")], [emptyTone]),
  command(322, "Change Actor Images", "System Settings", [integer(0, "actorId", 1), string(1, "characterName"), integer(2, "characterIndex", 0, 7), string(3, "faceName"), integer(4, "faceIndex", 0, 7), string(5, "battlerName")], [1, "", 0, "", 0, ""]),
  command(323, "Change Vehicle Image", "System Settings", [choice(0, "vehicleType", VEHICLE), string(1, "characterName"), integer(2, "characterIndex", 0, 7)], [0, "", 0]),

  command(281, "Change Map Name Display", "Map", [choice(0, "value", ON_OFF)], [0]),
  command(282, "Change Tileset", "Map", [integer(0, "tilesetId", 1)], [1]),
  command(283, "Change Battle Back", "Map", [string(0, "battleback1Name"), string(1, "battleback2Name")], ["", ""]),
  command(284, "Change Parallax", "Map", [string(0, "parallaxName"), boolean(1, "loopX"), boolean(2, "loopY"), numberParam(3, "sx"), numberParam(4, "sy")], ["", false, false, 0, 0]),
  command(285, "Get Location Info", "Map", [integer(0, "variableId", 1), choice(1, "infoType", [0, 1, 2, 3, 4, 5]), choice(2, "locationType", LOCATION_OPERAND), integer(3, "xOrVariableId", 0), integer(4, "yOrVariableId", 0)], [1, 0, 0, 0, 0]),

  command(331, "Change Enemy HP", "Battle", enemyOperandParameters(true), [-1, 0, 0, 0, false]),
  command(332, "Change Enemy MP", "Battle", enemyOperandParameters(false), [-1, 0, 0, 0]),
  command(342, "Change Enemy TP", "Battle", enemyOperandParameters(false), [-1, 0, 0, 0]),
  command(333, "Change Enemy State", "Battle", [integer(0, "enemyIndex", -1), choice(1, "operation", INCREASE_DECREASE), integer(2, "stateId", 1)], [-1, 0, 1]),
  command(334, "Enemy Recover All", "Battle", [integer(0, "enemyIndex", -1)], [-1]),
  command(335, "Enemy Appear", "Battle", [integer(0, "enemyIndex", 0)], [0]),
  command(336, "Enemy Transform", "Battle", [integer(0, "enemyIndex", 0), integer(1, "enemyId", 1)], [0, 1]),
  command(337, "Show Battle Animation", "Battle", [integer(0, "enemyIndex", -1), integer(1, "animationId", 1), boolean(2, "mirror")], [-1, 1, false]),
  command(339, "Force Action", "Battle", [choice(0, "battlerType", [0, 1]), integer(1, "battlerIndex", 0), integer(2, "skillId", 1), integer(3, "targetIndex", -2)], [0, 0, 1, -1]),
  command(340, "Abort Battle", "Battle"),

  command(355, "Script", "Advanced", [string(0, "line")], [""], { block: multiline([655]) }),
  command(356, "Plugin Command", "Advanced", [string(0, "command")], [""])
]);

export const STRUCTURAL_EVENT_COMMAND_DEFINITIONS: readonly EventCommandDefinition[] = Object.freeze([
  command(0, "End of List", "Structural", [], [], { standard: false }),
  command(401, "Text Line", "Message", [string(0, "text")], [""], { standard: false, block: child("continuation", 101) }),
  command(402, "When Choice", "Message", [integer(0, "choiceIndex", 0), string(1, "choiceText")], [0, ""], { standard: false, block: child("continuation", 102) }),
  command(403, "When Cancel", "Message", [optionalAny(0, "choiceIndex"), optionalAny(1, "choiceText")], [], { parameterMode: "min", standard: false, block: child("continuation", 102) }),
  command(404, "End Choices", "Message", [], [], { standard: false, block: child("terminator", 102) }),
  command(405, "Scrolling Text Line", "Message", [string(0, "text")], [""], { standard: false, block: child("continuation", 105) }),
  command(408, "Comment Line", "Flow Control", [string(0, "text")], [""], { standard: false, block: child("continuation", 108) }),
  command(411, "Else", "Flow Control", [], [], { standard: false, block: child("continuation", 111) }),
  command(412, "End Branch", "Flow Control", [], [], { standard: false, block: child("terminator", 111) }),
  command(413, "Repeat Above", "Flow Control", [], [], { standard: false, block: child("terminator", 112) }),
  command(505, "Movement Route Step", "Movement", [moveRouteCommand(0, "moveRouteCommand")], [{ code: 0, parameters: [] }], { standard: false, block: child("continuation", 205) }),
  command(601, "If Win", "Scene Control", [], [], { standard: false, block: child("continuation", 301) }),
  command(602, "If Escape", "Scene Control", [], [], { standard: false, block: child("continuation", 301) }),
  command(603, "If Lose", "Scene Control", [], [], { standard: false, block: child("continuation", 301) }),
  command(604, "End Battle", "Scene Control", [], [], { standard: false, block: child("terminator", 301) }),
  command(605, "Shop Goods Line", "Scene Control", [choice(0, "goodsType", [0, 1, 2]), integer(1, "itemId", 1), choice(2, "priceType", [0, 1]), integer(3, "price", 0)], [0, 1, 0, 0], { standard: false, block: child("continuation", 302) }),
  command(655, "Script Line", "Advanced", [string(0, "line")], [""], { standard: false, block: child("continuation", 355) })
]);

const MZ_STANDARD_OVERRIDES = new Map<number, EventCommandDefinition>([
  [101, command(101, "Show Text", "Message", [
    string(0, "faceName"),
    integer(1, "faceIndex", 0),
    choice(2, "background", [0, 1, 2]),
    choice(3, "positionType", [0, 1, 2]),
    string(4, "speakerName")
  ], ["", 0, 0, 2, ""], { block: multiline([401]) })],
  [104, command(104, "Select Item", "Message", [integer(0, "variableId", 1), choice(1, "itemType", [1, 2, 3, 4])], [1, 2])],
  [232, command(232, "Move Picture", "Picture", [
    ...picturePlacementParameters(false),
    integer(10, "duration", 0),
    boolean(11, "wait"),
    choice(12, "easingType", [0, 1, 2, 3])
  ], [1, 0, 0, 0, 0, 0, 100, 100, 255, 0, 60, true, 0])],
  [285, command(285, "Get Location Info", "Map", [
    integer(0, "variableId", 1),
    choice(1, "infoType", [0, 1, 2, 3, 4, 5, 6]),
    choice(2, "locationType", LOCATION_OPERAND),
    integer(3, "xOrVariableId", 0),
    integer(4, "yOrVariableId", 0)
  ], [1, 0, 0, 0, 0])],
  [322, command(322, "Change Actor Images", "System Settings", [
    integer(0, "actorId", 1),
    string(1, "faceName"),
    integer(2, "faceIndex", 0, 7),
    string(3, "characterName"),
    integer(4, "characterIndex", 0, 7),
    string(5, "battlerName")
  ], [1, "", 0, "", 0, ""])],
  [337, command(337, "Show Battle Animation", "Battle", [
    integer(0, "enemyIndex", -1),
    integer(1, "animationId", 1),
    { ...boolean(2, "includeEntireTroop"), optional: true }
  ], [-1, 1], { parameterMode: "min" })]
]);

export const MZ_STANDARD_EVENT_COMMAND_CODES: readonly number[] = Object.freeze([
  ...STANDARD_EVENT_COMMAND_CODES.filter((code) => code !== 356),
  109,
  357
]);

export const MZ_STANDARD_EVENT_COMMAND_DEFINITIONS: readonly EventCommandDefinition[] = Object.freeze([
  ...STANDARD_EVENT_COMMAND_DEFINITIONS
    .filter((definition) => definition.code !== 356)
    .map((definition) => MZ_STANDARD_OVERRIDES.get(definition.code) ?? definition),
  command(109, "Skip", "Flow Control", [], [], { block: structured([], [], 0) }),
  command(357, "Plugin Command", "Advanced", [
    string(0, "pluginName"),
    string(1, "commandName"),
    string(2, "displayName"),
    stringRecord(3, "arguments")
  ], ["", "", "", {}], { block: multiline([657]) })
]);

export const MZ_STRUCTURAL_EVENT_COMMAND_DEFINITIONS: readonly EventCommandDefinition[] = Object.freeze([
  ...STRUCTURAL_EVENT_COMMAND_DEFINITIONS,
  command(657, "Plugin Command Argument", "Advanced", [string(0, "argument")], [""], {
    standard: false,
    block: child("continuation", 357)
  })
]);

export const ALL_EVENT_COMMAND_DEFINITIONS: readonly EventCommandDefinition[] = Object.freeze([
  ...STANDARD_EVENT_COMMAND_DEFINITIONS,
  ...STRUCTURAL_EVENT_COMMAND_DEFINITIONS
]);

const definitionByCode = new Map<number, EventCommandDefinition>(
  ALL_EVENT_COMMAND_DEFINITIONS.map((definition) => [definition.code, definition])
);

export const MZ_ALL_EVENT_COMMAND_DEFINITIONS: readonly EventCommandDefinition[] = Object.freeze([
  ...MZ_STANDARD_EVENT_COMMAND_DEFINITIONS,
  ...MZ_STRUCTURAL_EVENT_COMMAND_DEFINITIONS
]);

const mzDefinitionByCode = new Map<number, EventCommandDefinition>(
  MZ_ALL_EVENT_COMMAND_DEFINITIONS.map((definition) => [definition.code, definition])
);

const definitionsByEngine: Readonly<Record<RpgMakerEngine, ReadonlyMap<number, EventCommandDefinition>>> = Object.freeze({
  "rpg-maker-mv": definitionByCode,
  "rpg-maker-mz": mzDefinitionByCode
});

export const EVENT_COMMAND_BLOCK_PAIRINGS: Readonly<Record<number, { continuations?: readonly number[]; terminator?: number }>> = Object.freeze(
  Object.fromEntries(
    ALL_EVENT_COMMAND_DEFINITIONS
      .filter((definition) => definition.block.continuationCodes?.length || definition.block.branchCodes?.length || definition.block.endCode !== undefined)
      .map((definition) => [
        definition.code,
        {
          continuations: [...(definition.block.continuationCodes || []), ...(definition.block.branchCodes || [])],
          ...(definition.block.endCode === undefined ? {} : { terminator: definition.block.endCode })
        }
      ])
  )
);

export const EVENT_COMMAND_BLOCK_HEAD_CODES: ReadonlySet<number> = Object.freeze(new Set(Object.keys(EVENT_COMMAND_BLOCK_PAIRINGS).map(Number)));
export const EVENT_COMMAND_CONTINUATION_CODES: ReadonlySet<number> = Object.freeze(
  new Set(
    STRUCTURAL_EVENT_COMMAND_DEFINITIONS
      .filter((definition) => definition.block.kind === "continuation" || definition.block.kind === "terminator")
      .map((definition) => definition.code)
  )
);

export const MZ_EVENT_COMMAND_BLOCK_PAIRINGS: Readonly<Record<number, { continuations?: readonly number[]; terminator?: number }>> =
  buildBlockPairings(MZ_ALL_EVENT_COMMAND_DEFINITIONS);
export const MZ_EVENT_COMMAND_BLOCK_HEAD_CODES: ReadonlySet<number> = Object.freeze(new Set(Object.keys(MZ_EVENT_COMMAND_BLOCK_PAIRINGS).map(Number)));
export const MZ_EVENT_COMMAND_CONTINUATION_CODES: ReadonlySet<number> = Object.freeze(
  new Set(
    MZ_STRUCTURAL_EVENT_COMMAND_DEFINITIONS
      .filter((definition) => definition.block.kind === "continuation" || definition.block.kind === "terminator")
      .map((definition) => definition.code)
  )
);

assertRegistryIntegrity();

export function eventCommandDefinitions(engine: RpgMakerEngine = "rpg-maker-mv"): readonly EventCommandDefinition[] {
  return engine === "rpg-maker-mz" ? MZ_ALL_EVENT_COMMAND_DEFINITIONS : ALL_EVENT_COMMAND_DEFINITIONS;
}

export function eventCommandBlockPairings(
  engine: RpgMakerEngine = "rpg-maker-mv"
): Readonly<Record<number, { continuations?: readonly number[]; terminator?: number }>> {
  return engine === "rpg-maker-mz" ? MZ_EVENT_COMMAND_BLOCK_PAIRINGS : EVENT_COMMAND_BLOCK_PAIRINGS;
}

export function eventCommandBlockHeadCodes(engine: RpgMakerEngine = "rpg-maker-mv"): ReadonlySet<number> {
  return engine === "rpg-maker-mz" ? MZ_EVENT_COMMAND_BLOCK_HEAD_CODES : EVENT_COMMAND_BLOCK_HEAD_CODES;
}

export function eventCommandContinuationCodes(engine: RpgMakerEngine = "rpg-maker-mv"): ReadonlySet<number> {
  return engine === "rpg-maker-mz" ? MZ_EVENT_COMMAND_CONTINUATION_CODES : EVENT_COMMAND_CONTINUATION_CODES;
}

export function eventCommandDefinition(code: number, engine: RpgMakerEngine = "rpg-maker-mv"): EventCommandDefinition | undefined {
  return definitionsByEngine[engine].get(code);
}

export function isKnownEventCommandCode(code: number, engine: RpgMakerEngine = "rpg-maker-mv"): boolean {
  return definitionsByEngine[engine].has(code);
}

export function defaultEventCommandParameters(code: number, engine: RpgMakerEngine = "rpg-maker-mv"): unknown[] {
  const definition = eventCommandDefinition(code, engine);
  if (!definition) throw new Error(`Unknown ${engineLabel(engine)} event command code ${code}`);
  return clone(Array.from(definition.defaultParameters));
}

export function validateEventCommandBasic(
  commandValue: unknown,
  label = "eventCommand",
  engine: RpgMakerEngine = "rpg-maker-mv"
): asserts commandValue is RawEventCommand {
  if (!commandValue || typeof commandValue !== "object" || Array.isArray(commandValue)) {
    throw new Error(`${label} must be an object with code/indent/parameters`);
  }
  const commandObject = commandValue as RawEventCommand;
  if (!Number.isInteger(commandObject.code) || commandObject.code < 0) {
    throw new Error(`${label}.code must be a non-negative integer`);
  }
  if (!Number.isInteger(commandObject.indent) || commandObject.indent < 0) {
    throw new Error(`${label}.indent must be a non-negative integer`);
  }
  if (!Array.isArray(commandObject.parameters)) {
    throw new Error(`${label}.parameters must be an array`);
  }
  const definition = eventCommandDefinition(commandObject.code, engine);
  if (!definition) {
    if (engine === "rpg-maker-mv") {
      throw new Error(`${label}.code ${commandObject.code} is not a standard RPG Maker MV event command code`);
    }
    throw new Error(`${label}.code ${commandObject.code} is not valid for RPG Maker MZ`);
  }
  validateEventCommandParameters(definition, commandObject.parameters, label);
}

export function validateEventCommandList(
  commandList: unknown,
  label = "eventCommandList",
  engine: RpgMakerEngine = "rpg-maker-mv"
): asserts commandList is RawEventCommand[] {
  if (!Array.isArray(commandList)) throw new Error(`${label} must be an array`);
  if (commandList.length === 0) throw new Error(`${label} must end with code 0 at indent 0`);

  const openBlocks: Array<{ headCode: number; indent: number; terminatorCode: number }> = [];
  for (let index = 0; index < commandList.length; index += 1) {
    const commandLabel = `${label}[${index}]`;
    validateEventCommandBasic(commandList[index], commandLabel, engine);
    const current = commandList[index] as RawEventCommand;

    if (current.code === 0) {
      if (index === commandList.length - 1) {
        if (current.indent !== 0) throw new Error(`${commandLabel} final code 0 must use indent 0`);
        const unclosed = openBlocks[openBlocks.length - 1];
        if (unclosed) {
          throw new Error(
            `${label} block head code ${unclosed.headCode} at indent ${unclosed.indent} requires terminator code ${unclosed.terminatorCode} before end`,
          );
        }
      } else if (
        openBlocks.length
        && openBlocks[openBlocks.length - 1].terminatorCode === 0
        && current.indent === openBlocks[openBlocks.length - 1].indent
      ) {
        openBlocks.pop();
      } else {
        const expectedIndent = openBlocks.length ? openBlocks[openBlocks.length - 1].indent + 1 : 0;
        if (current.indent !== expectedIndent) {
          throw new Error(`${commandLabel} internal code 0 must use indent ${expectedIndent}; got ${current.indent}`);
        }
      }
      continue;
    }

    const definition = eventCommandDefinition(current.code, engine)!;
    if (definition.block.kind === "continuation" || definition.block.kind === "terminator") {
      validateStructuralCommand(commandList, index, current, definition, openBlocks, label, engine);
      continue;
    }

    const expectedIndent = openBlocks.length ? openBlocks[openBlocks.length - 1].indent + 1 : 0;
    if (current.indent !== expectedIndent) {
      throw new Error(`${commandLabel} must use indent ${expectedIndent}; got ${current.indent}`);
    }

    if (definition.block.kind === "structured" && startsStructuredBlock(commandList, index, current, definition)) {
      const terminatorCode = definition.block.endCode;
      if (terminatorCode === undefined) {
        throw new Error(`${commandLabel} structured block head code ${current.code} has no registered terminator`);
      }
      openBlocks.push({ headCode: current.code, indent: current.indent, terminatorCode });
    }
  }

  const last = commandList[commandList.length - 1] as RawEventCommand;
  if (last.code !== 0 || last.indent !== 0) throw new Error(`${label} must end with code 0 at indent 0`);
}

function validateStructuralCommand(
  commandList: unknown[],
  index: number,
  current: RawEventCommand,
  definition: EventCommandDefinition,
  openBlocks: Array<{ headCode: number; indent: number; terminatorCode: number }>,
  label: string,
  engine: RpgMakerEngine,
): void {
  const commandLabel = `${label}[${index}]`;
  const parentCode = definition.block.parentCode;
  if (parentCode === undefined) throw new Error(`${commandLabel} structural command has no registered parent`);
  const parent = eventCommandDefinition(parentCode, engine)!;

  if (parent.block.kind === "multiline") {
    const previous = index > 0 ? commandList[index - 1] : undefined;
    const previousCommand = previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous as Partial<RawEventCommand>
      : null;
    const allowedPreviousCodes = new Set([parentCode, ...(parent.block.continuationCodes ?? [])]);
    if (
      !previousCommand
      || !allowedPreviousCodes.has(Number(previousCommand.code))
      || previousCommand.indent !== current.indent
    ) {
      throw new Error(
        `${commandLabel} continuation code ${current.code} requires head code ${parentCode} at the same indent`,
      );
    }
    return;
  }

  const open = openBlocks[openBlocks.length - 1];
  if (!open || open.headCode !== parentCode || open.indent !== current.indent) {
    throw new Error(
      `${commandLabel} ${definition.block.kind} code ${current.code} requires open head code ${parentCode} at indent ${current.indent}`,
    );
  }
  if (definition.block.kind === "terminator") openBlocks.pop();
}

export function validateEventCommandParameters(definition: EventCommandDefinition, parameters: unknown[], label = `eventCommand:${definition.code}`): void {
  const expectedLength = definition.parameters.length
    ? Math.max(...definition.parameters.filter((parameter) => !parameter.optional).map((parameter) => parameter.index)) + 1
    : 0;
  if (definition.parameterMode === "exact" && parameters.length !== expectedLength) {
    throw new Error(`${label}.parameters for code ${definition.code} must have ${expectedLength} value(s); got ${parameters.length}`);
  }
  if (definition.parameterMode === "min" && parameters.length < expectedLength) {
    throw new Error(`${label}.parameters for code ${definition.code} must have at least ${expectedLength} value(s); got ${parameters.length}`);
  }
  for (const schema of definition.parameters) {
    if (schema.index >= parameters.length) {
      if (schema.optional) continue;
      throw new Error(`${label}.parameters[${schema.index}] (${schema.name}) is required`);
    }
    validateParameter(schema, parameters[schema.index], `${label}.parameters[${schema.index}]`);
  }
  validateVariantParameterShape(definition.code, parameters, label);
}

function startsStructuredBlock(
  commandList: unknown[],
  index: number,
  current: RawEventCommand,
  definition: EventCommandDefinition,
): boolean {
  if (!definition.block.optional) return true;
  const nextValue = commandList[index + 1];
  if (!nextValue || typeof nextValue !== "object" || Array.isArray(nextValue)) return false;
  const next = nextValue as Partial<RawEventCommand>;
  if (next.indent !== current.indent) return false;
  const structuralCodes = new Set([
    ...(definition.block.branchCodes ?? []),
    ...(definition.block.endCode === undefined ? [] : [definition.block.endCode]),
  ]);
  return structuralCodes.has(Number(next.code));
}

const CONDITIONAL_BRANCH_PARAMETER_LENGTHS: Readonly<Record<number, readonly number[]>> = Object.freeze({
  0: [3],
  1: [5],
  2: [3],
  3: [3],
  4: [3, 4],
  5: [3, 4],
  6: [3],
  7: [3],
  8: [2],
  9: [3],
  10: [3],
  11: [3],
  12: [2],
  13: [2],
});
const ACTOR_TARGET_EVENT_CODES = new Set([311, 312, 313, 314, 315, 316, 317, 318, 326]);

function validateVariantParameterShape(code: number, parameters: unknown[], label: string): void {
  if (code === 111) {
    const conditionType = Number(parameters[0]);
    const allowedLengths = CONDITIONAL_BRANCH_PARAMETER_LENGTHS[conditionType];
    if (allowedLengths && !allowedLengths.includes(parameters.length)) {
      throw new Error(
        `${label}.parameters for conditional branch type ${conditionType} must have ${allowedLengths.join(" or ")} value(s); got ${parameters.length}`,
      );
    }
  }
  if (code === 124) {
    const operation = Number(parameters[0]);
    const allowedLengths = operation === 0 ? [2] : [1, 2];
    if (!allowedLengths.includes(parameters.length)) {
      throw new Error(
        `${label}.parameters for timer operation ${operation} must have ${allowedLengths.join(" or ")} value(s); got ${parameters.length}`,
      );
    }
  }
  if (code === 403) {
    const validLegacyShape = parameters.length === 2
      && Number.isInteger(parameters[0])
      && parameters[1] === null;
    if (parameters.length !== 0 && !validLegacyShape) {
      throw new Error(`${label}.parameters for cancel branch must be empty or [integer, null]`);
    }
  }
  if (ACTOR_TARGET_EVENT_CODES.has(code) && Number(parameters[0]) === 1 && Number(parameters[1]) < 1) {
    throw new Error(`${label}.parameters[1] (actorVariableId) must be >= 1 when actorTargetType is 1`);
  }
}

function validateParameter(schema: EventCommandParameterSchema, value: unknown, label: string): void {
  if (schema.type === "any") return;
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${label} (${schema.name}) must be an integer`);
    if (schema.min !== undefined && (value as number) < schema.min) throw new Error(`${label} (${schema.name}) must be >= ${schema.min}`);
    if (schema.max !== undefined && (value as number) > schema.max) throw new Error(`${label} (${schema.name}) must be <= ${schema.max}`);
    return;
  }
  if (schema.type === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} (${schema.name}) must be a number`);
    if (schema.min !== undefined && (value as number) < schema.min) throw new Error(`${label} (${schema.name}) must be >= ${schema.min}`);
    if (schema.max !== undefined && (value as number) > schema.max) throw new Error(`${label} (${schema.name}) must be <= ${schema.max}`);
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw new Error(`${label} (${schema.name}) must be a string`);
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${label} (${schema.name}) must be a boolean`);
    return;
  }
  if (schema.type === "enum") {
    if (!schema.enumValues?.includes(value as never)) throw new Error(`${label} (${schema.name}) must be one of ${schema.enumValues?.join(", ")}`);
    return;
  }
  if (schema.type === "stringArray") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`${label} (${schema.name}) must be an array of strings`);
    }
    return;
  }
  if (schema.type === "stringRecord") {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every((item) => typeof item === "string")) {
      throw new Error(`${label} (${schema.name}) must be an object with string values`);
    }
    return;
  }
  if (schema.type === "audio") {
    validateAudio(value, label);
    return;
  }
  if (schema.type === "tone" || schema.type === "color") {
    validateNumberTuple(value, schema.type === "tone" ? 4 : 4, label, schema.name);
    return;
  }
  if (schema.type === "moveRoute") {
    validateMoveRoute(value, label);
    return;
  }
  if (schema.type === "moveRouteCommand") {
    validateMoveRouteCommandBasic(value, label);
  }
}

function validateAudio(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an RPG Maker MV audio object`);
  const audioValue = value as { name?: unknown; volume?: unknown; pitch?: unknown; pan?: unknown };
  if (typeof audioValue.name !== "string") throw new Error(`${label}.name must be a string`);
  for (const key of ["volume", "pitch", "pan"] as const) {
    if (!Number.isFinite(audioValue[key])) throw new Error(`${label}.${key} must be a number`);
  }
}

function validateNumberTuple(value: unknown, length: number, label: string, name: string): void {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => Number.isFinite(item))) {
    throw new Error(`${label} (${name}) must be a ${length}-number array`);
  }
}

function validateMoveRoute(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an RPG Maker MV move route object`);
  const route = value as { list?: unknown; repeat?: unknown; skippable?: unknown; wait?: unknown };
  if (!Array.isArray(route.list)) throw new Error(`${label}.list must be an array`);
  for (let index = 0; index < route.list.length; index += 1) {
    validateMoveRouteCommandBasic(route.list[index], `${label}.list[${index}]`);
  }
  for (const key of ["repeat", "skippable", "wait"] as const) {
    if (typeof route[key] !== "boolean") throw new Error(`${label}.${key} must be a boolean`);
  }
}

function assertRegistryIntegrity(): void {
  if (STANDARD_EVENT_COMMAND_DEFINITIONS.length !== STANDARD_EVENT_COMMAND_CODES.length) {
    throw new Error(`RMMV event command registry must cover 105 standard commands; got ${STANDARD_EVENT_COMMAND_DEFINITIONS.length}`);
  }
  const standardCodes = STANDARD_EVENT_COMMAND_DEFINITIONS.map((definition) => definition.code);
  if (new Set(standardCodes).size !== standardCodes.length) throw new Error("RMMV event command registry has duplicate standard codes");
  for (const code of STANDARD_EVENT_COMMAND_CODES) {
    if (!definitionByCode.has(code)) throw new Error(`RMMV event command registry is missing standard code ${code}`);
  }
  const allCodes = ALL_EVENT_COMMAND_DEFINITIONS.map((definition) => definition.code);
  if (new Set(allCodes).size !== allCodes.length) throw new Error("RMMV event command registry has duplicate codes");

  if (MZ_STANDARD_EVENT_COMMAND_DEFINITIONS.length !== MZ_STANDARD_EVENT_COMMAND_CODES.length) {
    throw new Error(`RPG Maker MZ event command registry must cover 106 standard commands; got ${MZ_STANDARD_EVENT_COMMAND_DEFINITIONS.length}`);
  }
  const mzStandardCodes = MZ_STANDARD_EVENT_COMMAND_DEFINITIONS.map((definition) => definition.code);
  if (new Set(mzStandardCodes).size !== mzStandardCodes.length) throw new Error("RPG Maker MZ event command registry has duplicate standard codes");
  for (const code of MZ_STANDARD_EVENT_COMMAND_CODES) {
    if (!mzDefinitionByCode.has(code)) throw new Error(`RPG Maker MZ event command registry is missing standard code ${code}`);
  }
  const mzAllCodes = MZ_ALL_EVENT_COMMAND_DEFINITIONS.map((definition) => definition.code);
  if (new Set(mzAllCodes).size !== mzAllCodes.length) throw new Error("RPG Maker MZ event command registry has duplicate codes");
}

function buildBlockPairings(
  definitions: readonly EventCommandDefinition[]
): Readonly<Record<number, { continuations?: readonly number[]; terminator?: number }>> {
  return Object.freeze(
    Object.fromEntries(
      definitions
        .filter((definition) => definition.block.continuationCodes?.length || definition.block.branchCodes?.length || definition.block.endCode !== undefined)
        .map((definition) => [
          definition.code,
          {
            continuations: [...(definition.block.continuationCodes || []), ...(definition.block.branchCodes || [])],
            ...(definition.block.endCode === undefined ? {} : { terminator: definition.block.endCode })
          }
        ])
    )
  );
}

function engineLabel(engine: RpgMakerEngine): string {
  return engine === "rpg-maker-mz" ? "RPG Maker MZ" : "RPG Maker MV";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
