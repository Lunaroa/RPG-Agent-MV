import fs from "fs";
import path from "path";
import { readJson } from "./json.ts";
import { toolLogger } from "../file-log.ts";
import {
  validateEventCommandBasic,
  EVENT_COMMAND_BLOCK_PAIRINGS
} from "./event-command-registry.ts";

const log = toolLogger("event-page-compiler");

const TRIGGERS: Record<string, number> = {
  "action-button": 0,
  "player-touch": 1,
  "event-touch": 2,
  autorun: 3,
  parallel: 4
};

const PRIORITIES: Record<string, number> = {
  "below-characters": 0,
  "same-as-characters": 1,
  "above-characters": 2
};

const MOVE_CODES: Record<string, number> = {
  down: 1,
  left: 2,
  right: 3,
  up: 4
};

const TURN_CODES: Record<string, number> = {
  down: 16,
  left: 17,
  right: 18,
  up: 19
};

/**
 * 编译器认得的全部命令 `kind`（单一真相源）。
 * 必须与 `appendCommand` 的 switch 分支保持同步：新增/删除一个 case 时同步改这里。
 * validate 阶段 import 此集合做白名单校验，使「能验证通过」与「能编译放置」对齐，
 * 避免写错 kind（如 `show-text`）一路绿灯、拖到放置才 fail-fast。
 */
export const KNOWN_COMMAND_KINDS: ReadonlySet<string> = new Set([
  "comment",
  "text",
  "switch",
  "variable",
  "self-switch",
  "wait",
  "move-route",
  "fadeout",
  "fadein",
  "screen-tint",
  "screen-flash",
  "screen-shake",
  "play-se",
  "show-animation",
  "show-balloon",
  "change-gold",
  "change-items",
  "transfer",
  "common-event",
  "plugin",
  "conditional-branch",
  "choice",
  "loop",
  "battle",
  "shop",
  "break-loop",
  "raw-command",
  "mv-command"
]);

/**
 * 常见错写 → 正确 kind 的别名表。
 * 既用于校验报错里的「你是不是想写 X」提示，**也由 `normalizeCommands` 在编译/注册前真正应用**，
 * 把大模型自由发挥的 kind 命名机械归一到编译器认得的规范名（确定性，不靠模型自律）。
 * 条目来自 RPG Maker 编辑器/引擎叫法（如 Show Text）与本项目契约命名的差异，以及实测两个模型的产出变体。
 */
export const COMMAND_KIND_ALIASES: Readonly<Record<string, string>> = {
  "show-text": "text",
  showtext: "text",
  message: "text",
  "show-message": "text",
  "show-choices": "choice",
  choices: "choice",
  "control-switch": "switch",
  "control-switches": "switch",
  "control-variable": "variable",
  "control-variables": "variable",
  "control-self-switch": "self-switch",
  "set-self-switch": "self-switch",
  selfswitch: "self-switch",
  "conditional-branch-else": "conditional-branch",
  "if": "conditional-branch",
  "transfer-player": "transfer",
  "play-sound": "play-se",
  "play-sound-effect": "play-se",
  balloon: "show-balloon",
  "show-bubble": "show-balloon",
  "give-gold": "change-gold",
  "gain-gold": "change-gold",
  "add-gold": "change-gold",
  "change-money": "change-gold",
  "give-item": "change-items",
  "gain-item": "change-items",
  "add-item": "change-items",
  "change-item": "change-items"
};

/** 头顶气泡的文字写法 → balloonId（模型爱写 `bubble:"..."`，归一到整数 id）。 */
const BALLOON_TEXT_TO_ID: Readonly<Record<string, number>> = {
  "!": 1,
  "！": 1,
  "?": 2,
  "？": 2,
  "♪": 3,
  "♥": 4,
  "♡": 4,
  "...": 8,
  "…": 8,
  "。。。": 8
};

interface NormalizeResult {
  commands: CommandSpec[];
  changed: string[];
}

/**
 * 编译前的确定性归一化：把模型常见的 kind / 字段变体重写成编译器规范形态。
 * 治的是「演出/语气已够好，但 command 结构自由发挥导致编译不过」这类纯机械问题。
 * 覆盖（均来自实测）：
 *  - kind 别名（见 COMMAND_KIND_ALIASES），含 set-self-switch / control-* / change-money 等；
 *  - 独立的 when/branch 兄弟节点 → 折叠进前一个 choice 的对应分支 commands；
 *  - 字段级：face→faceName/faceIndex、play-se.sound.*→扁平、show-balloon.bubble→balloonId、
 *    choice.cancel→cancelType、self-switch.switch→name、change-gold.amount→value、
 *    change-gold/items.operation(add/gain/+/0 等)→increase|decrease 等。
 * changed 收集做了哪些重写，供调用方在 hint 里回显。
 */
export function normalizeCommands(commands: unknown): NormalizeResult {
  const changed: string[] = [];
  const out = normalizeCommandArray(commands, changed);
  const deduped = [...new Set(changed)];
  if (deduped.length) {
    log.warn(`命令归一化修正了 ${deduped.length} 处：${deduped.join('; ')}`);
  }
  return { commands: out, changed: deduped };
}

function resolveKindAlias(kind: unknown): string | undefined {
  return typeof kind === "string" ? (COMMAND_KIND_ALIASES[kind] || kind) : undefined;
}

function normalizeCommandArray(commands: unknown, changed: string[]): CommandSpec[] {
  if (!Array.isArray(commands)) return commands as CommandSpec[];
  // 第一遍：把 when/branch/case 兄弟节点折叠进前一个 choice。
  const folded: Record<string, unknown>[] = [];
  for (const raw of commands) {
    const cmd = raw as Record<string, unknown>;
    const kind = cmd && typeof cmd === "object" ? cmd.kind : undefined;
    if ((kind === "when" || kind === "branch" || kind === "case") && folded.length) {
      const prev = folded[folded.length - 1];
      if (resolveKindAlias(prev.kind) === "choice") {
        foldWhenIntoChoice(prev, cmd, changed);
        continue;
      }
    }
    folded.push(cmd);
  }
  // 第二遍：逐条做 kind/字段归一并递归。
  return folded.map((cmd) => normalizeOneCommand(cmd, changed));
}

function foldWhenIntoChoice(choiceCmd: Record<string, unknown>, whenCmd: Record<string, unknown>, changed: string[]): void {
  if (!Array.isArray(choiceCmd.choices)) choiceCmd.choices = [];
  const choices = choiceCmd.choices as unknown[];
  // 把字符串选项升级成 { text, commands } 形态，便于挂分支命令。
  for (let i = 0; i < choices.length; i += 1) {
    if (typeof choices[i] === "string") choices[i] = { text: choices[i] };
  }
  let idx = -1;
  const ref = whenCmd.choice ?? whenCmd.branch ?? whenCmd.index ?? whenCmd.value;
  if (typeof ref === "number") {
    // 实测模型用 1-based（两个选项写 1、2）；>=1 视为 1-based。
    idx = ref >= 1 ? ref - 1 : ref;
  } else if (typeof ref === "string") {
    idx = choices.findIndex((c) => (typeof c === "object" && c && (c as { text?: string }).text === ref) || c === ref);
  }
  if (idx < 0 || idx >= choices.length) idx = choices.length ? Math.min(Math.max(idx, 0), choices.length - 1) : 0;
  if (!choices[idx] || typeof choices[idx] !== "string" && typeof choices[idx] !== "object") choices[idx] = { text: "" };
  if (typeof choices[idx] === "string") choices[idx] = { text: choices[idx] };
  const target = choices[idx] as { commands?: unknown[] };
  const incoming = Array.isArray(whenCmd.commands) ? (whenCmd.commands as unknown[]) : [];
  target.commands = [...(Array.isArray(target.commands) ? target.commands : []), ...incoming];
  changed.push(`fold ${String(whenCmd.kind)}→choice.choices[${idx}]`);
}

function normalizeOneCommand(raw: unknown, changed: string[]): CommandSpec {
  if (!raw || typeof raw !== "object") return raw as CommandSpec;
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const original = next.kind;
  const canonical = resolveKindAlias(next.kind);
  if (canonical && canonical !== original) {
    next.kind = canonical;
    changed.push(`${String(original)}→${canonical}`);
  }
  normalizeFields(next, canonical, changed);
  // 递归归一嵌套命令。
  if (canonical === "choice" && Array.isArray(next.choices)) {
    next.choices = (next.choices as unknown[]).map((c) => {
      if (c && typeof c === "object" && Array.isArray((c as { commands?: unknown }).commands)) {
        return { ...(c as object), commands: normalizeCommandArray((c as { commands: unknown }).commands, changed) };
      }
      return c;
    });
    if (Array.isArray(next.cancelCommands)) {
      next.cancelCommands = normalizeCommandArray(next.cancelCommands, changed);
    }
  } else if (canonical === "conditional-branch") {
    if (Array.isArray(next.then)) next.then = normalizeCommandArray(next.then, changed);
    if (Array.isArray(next.commands)) next.commands = normalizeCommandArray(next.commands, changed);
    if (Array.isArray(next.else)) next.else = normalizeCommandArray(next.else, changed);
  } else if (canonical === "loop" && Array.isArray(next.commands)) {
    next.commands = normalizeCommandArray(next.commands, changed);
  } else if (canonical === "battle") {
    if (Array.isArray(next.onWin)) next.onWin = normalizeCommandArray(next.onWin, changed);
    if (Array.isArray(next.onEscape)) next.onEscape = normalizeCommandArray(next.onEscape, changed);
    if (Array.isArray(next.onLose)) next.onLose = normalizeCommandArray(next.onLose, changed);
  } else if (canonical === "shop" && Array.isArray(next.goods)) {
    next.goods = normalizeCommandArray(next.goods, changed);
  }
  return next as CommandSpec;
}

function rename(obj: Record<string, unknown>, from: string, to: string, changed: string[]): void {
  if (obj[from] !== undefined && obj[to] === undefined) {
    obj[to] = obj[from];
    changed.push(`${from}→${to}`);
  }
  delete obj[from];
}

/** 模型常把增减写成 add/gain/+ 或 RMMV 内部 0/1，归一到 increase/decrease。 */
const AMOUNT_OPERATION_INCREASE = new Set([
  "increase", "add", "gain", "give", "+", "plus", "inc", "up", "增加", "加",
]);
const AMOUNT_OPERATION_DECREASE = new Set([
  "decrease", "remove", "lose", "take", "subtract", "sub", "-", "minus", "dec", "reduce", "down", "减少", "减",
]);

function normalizeAmountOperation(operation: unknown, changed?: string[], label?: string): string | undefined {
  if (operation === undefined || operation === null) return undefined;
  if (typeof operation === "string" && operation.trim() === "") return undefined;
  if (typeof operation === "boolean") {
    const result = operation ? "increase" : "decrease";
    const note = `${label || 'amount'}.operation(boolean:${operation})→${result}`;
    log.warn(`静默修正: ${note}`);
    if (changed && label) changed.push(note);
    return result;
  }
  if (typeof operation === "number") {
    if (operation === 0) {
      const note = `${label || 'amount'}.operation(number:0)→increase (RMMV内部编码)`;
      log.warn(`静默修正: ${note}`);
      return "increase";
    }
    if (operation === 1) {
      const note = `${label || 'amount'}.operation(number:1)→decrease (RMMV内部编码)`;
      log.warn(`静默修正: ${note}`);
      return "decrease";
    }
    return undefined;
  }
  if (operation && typeof operation === "object") {
    const nested = operation as { op?: unknown; type?: unknown; mode?: unknown; operation?: unknown };
    const inner = nested.operation ?? nested.op ?? nested.type ?? nested.mode;
    if (inner !== undefined) return normalizeAmountOperation(inner, changed, label);
    return undefined;
  }
  const raw = String(operation).trim();
  const key = raw.toLowerCase();
  if (key === "0") return "increase";
  if (key === "1") return "decrease";
  if (key === "increase" || key === "decrease") return key;
  if (AMOUNT_OPERATION_INCREASE.has(key) || AMOUNT_OPERATION_INCREASE.has(raw)) {
    const note = `${label || 'amount'}.operation("${raw}")→increase`;
    log.warn(`静默修正: ${note}`);
    if (changed && label) changed.push(note);
    return "increase";
  }
  if (AMOUNT_OPERATION_DECREASE.has(key) || AMOUNT_OPERATION_DECREASE.has(raw)) {
    const note = `${label || 'amount'}.operation("${raw}")→decrease`;
    log.warn(`静默修正: ${note}`);
    if (changed && label) changed.push(note);
    return "decrease";
  }
  return raw;
}

function normalizeAmountCommandFields(cmd: Record<string, unknown>, kind: string, changed: string[]): void {
  if (cmd.value === undefined && cmd.amount !== undefined) rename(cmd, "amount", "value", changed);
  if (cmd.operation === undefined && cmd.op !== undefined) rename(cmd, "op", "operation", changed);
  if (kind === "change-items" && cmd.itemId === undefined && Number.isInteger(cmd.item as number)) {
    rename(cmd, "item", "itemId", changed);
  }
  if (cmd.operation !== undefined) {
    const normalized = normalizeAmountOperation(cmd.operation, changed, kind);
    if (normalized === undefined) delete cmd.operation;
    else cmd.operation = normalized;
  }
}

function normalizeFields(cmd: Record<string, unknown>, kind: string | undefined, changed: string[]): void {
  switch (kind) {
    case "text": {
      if (cmd.face !== undefined) {
        if (typeof cmd.face === "string") {
          rename(cmd, "face", "faceName", changed);
        } else if (cmd.face && typeof cmd.face === "object") {
          const face = cmd.face as { characterName?: string; name?: string; faceName?: string; index?: number; faceIndex?: number };
          if (cmd.faceName === undefined) cmd.faceName = face.faceName ?? face.characterName ?? face.name ?? "";
          if (cmd.faceIndex === undefined && Number.isInteger(face.faceIndex ?? face.index)) cmd.faceIndex = face.faceIndex ?? face.index;
          delete cmd.face;
          changed.push("face{}→faceName/faceIndex");
        }
      }
      if (cmd.faceName === undefined && typeof cmd.characterName === "string") rename(cmd, "characterName", "faceName", changed);
      if (cmd.faceIndex === undefined && Number.isInteger(cmd.index as number)) rename(cmd, "index", "faceIndex", changed);
      return;
    }
    case "self-switch":
      if (cmd.name === undefined) {
        if (typeof cmd.switch === "string") rename(cmd, "switch", "name", changed);
        else if (typeof cmd.selfSwitch === "string") rename(cmd, "selfSwitch", "name", changed);
      } else {
        delete cmd.switch;
        delete cmd.selfSwitch;
      }
      return;
    case "switch":
    case "variable":
      if (cmd.id === undefined) {
        if (Array.isArray(cmd.target) && Number.isInteger((cmd.target as number[])[0])) {
          cmd.id = (cmd.target as number[])[0];
          changed.push("target[]→id");
        } else if (Number.isInteger(cmd.switchId as number)) rename(cmd, "switchId", "id", changed);
        else if (Number.isInteger(cmd.variableId as number)) rename(cmd, "variableId", "id", changed);
        else if (typeof cmd.switch === "number") rename(cmd, "switch", "id", changed);
      }
      delete cmd.target;
      return;
    case "play-se":
      if (cmd.sound && typeof cmd.sound === "object") {
        const s = cmd.sound as { name?: string; volume?: number; pitch?: number; pan?: number };
        if (cmd.name === undefined && typeof s.name === "string") cmd.name = s.name;
        if (cmd.volume === undefined && s.volume !== undefined) cmd.volume = s.volume;
        if (cmd.pitch === undefined && s.pitch !== undefined) cmd.pitch = s.pitch;
        if (cmd.pan === undefined && s.pan !== undefined) cmd.pan = s.pan;
        delete cmd.sound;
        changed.push("play-se.sound{}→flat");
      }
      return;
    case "show-balloon":
      if (cmd.balloonId === undefined) {
        if (typeof cmd.bubble === "string" && BALLOON_TEXT_TO_ID[cmd.bubble] !== undefined) {
          cmd.balloonId = BALLOON_TEXT_TO_ID[cmd.bubble];
          delete cmd.bubble;
          changed.push("bubble→balloonId");
        } else if (typeof cmd.balloon === "number") rename(cmd, "balloon", "balloonId", changed);
        else if (typeof cmd.balloon === "string" && BALLOON_TEXT_TO_ID[cmd.balloon] !== undefined) {
          cmd.balloonId = BALLOON_TEXT_TO_ID[cmd.balloon];
          delete cmd.balloon;
          changed.push("balloon→balloonId");
        }
      }
      return;
    case "choice":
      if (cmd.cancelType === undefined && cmd.cancel !== undefined) rename(cmd, "cancel", "cancelType", changed);
      if (cmd.defaultType === undefined && cmd.default !== undefined) rename(cmd, "default", "defaultType", changed);
      return;
    case "change-gold":
    case "change-items":
      normalizeAmountCommandFields(cmd, kind!, changed);
      return;
    default:
      return;
  }
}

interface CompiledCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

interface CompiledPage {
  conditions: CompiledConditions;
  directionFix: boolean;
  image: CompiledImage;
  list: CompiledCommand[];
  moveFrequency: number;
  moveRoute: { list: { code: number; parameters: unknown[] }[]; repeat: boolean; skippable: boolean; wait: boolean };
  moveSpeed: number;
  moveType: number;
  priorityType: number;
  stepAnime: boolean;
  through: boolean;
  trigger: number;
  walkAnime: boolean;
}

interface CompiledConditions {
  actorId: number;
  actorValid: boolean;
  itemId: number;
  itemValid: boolean;
  selfSwitchCh: string;
  selfSwitchValid: boolean;
  switch1Id: number;
  switch1Valid: boolean;
  switch2Id: number;
  switch2Valid: boolean;
  variableId: number;
  variableValid: boolean;
  variableValue: number;
}

interface CompiledImage {
  tileId: number;
  characterName: string;
  direction: number;
  pattern: number;
  characterIndex: number;
}

interface PageSpec {
  trigger?: string;
  priority?: string;
  conditions?: PageConditionsSpec;
  directionFix?: boolean;
  image?: ImageSpec;
  commands?: CommandSpec[];
  moveFrequency?: number;
  moveSpeed?: number;
  stepAnime?: boolean;
  through?: boolean;
  walkAnime?: boolean;
}

interface PageConditionsSpec {
  switchIds?: number[];
  variable?: { id: number; min: number };
  selfSwitch?: string;
}

interface ImageSpec {
  characterName?: string;
  tileId?: number;
  direction?: number;
  pattern?: number;
  characterIndex?: number;
}

interface CommandSpec {
  kind: string;
  [key: string]: unknown;
}

interface RawCommandSpec extends CommandSpec {
  kind: "raw-command" | "mv-command";
  code: number;
  indent: number;
  parameters: unknown[];
  reason?: string;
}

interface RawCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

interface DecompiledRange {
  start: number;
  end: number;
}

interface MoveRouteRawStep {
  code: number;
  parameters: unknown[];
}

interface PatchContext {
  plannedMaps?: Map<number, unknown>;
}

export function compilePage(page: PageSpec, system: unknown, dataDir: string, context?: PatchContext): CompiledPage {
  const trigger: string = page.trigger || "action-button";
  const priority: string = page.priority || "same-as-characters";
  if (TRIGGERS[trigger] === undefined) throw new Error(`Unsupported page trigger: ${trigger}`);
  if (PRIORITIES[priority] === undefined) throw new Error(`Unsupported page priority: ${priority}`);

  return {
    conditions: compileConditions(page.conditions || {}),
    directionFix: Boolean(page.directionFix),
    image: compileImage(page.image || {}),
    list: compileCommands(page.commands || [], system, dataDir, context),
    moveFrequency: page.moveFrequency || 3,
    moveRoute: {
      list: [{ code: 0, parameters: [] }],
      repeat: true,
      skippable: false,
      wait: false
    },
    moveSpeed: page.moveSpeed || 3,
    moveType: 0,
    priorityType: PRIORITIES[priority],
    stepAnime: Boolean(page.stepAnime),
    through: Boolean(page.through),
    trigger: TRIGGERS[trigger],
    walkAnime: page.walkAnime === undefined ? true : Boolean(page.walkAnime)
  };
}

function compileConditions(conditions: PageConditionsSpec): CompiledConditions {
  const result: CompiledConditions = {
    actorId: 1,
    actorValid: false,
    itemId: 1,
    itemValid: false,
    selfSwitchCh: "A",
    selfSwitchValid: false,
    switch1Id: 1,
    switch1Valid: false,
    switch2Id: 1,
    switch2Valid: false,
    variableId: 1,
    variableValid: false,
    variableValue: 0
  };

  if (conditions.switchIds !== undefined) {
    if (!Array.isArray(conditions.switchIds) || conditions.switchIds.length > 2) {
      throw new Error("conditions.switchIds must contain one or two switch IDs");
    }
    conditions.switchIds.forEach((id, index) => {
      assertInteger(id, `conditions.switchIds[${index}]`, 1);
      if (index === 0) {
        result.switch1Valid = true;
        result.switch1Id = id;
      } else {
        result.switch2Valid = true;
        result.switch2Id = id;
      }
    });
  }

  if (conditions.variable !== undefined) {
    assertInteger(conditions.variable.id, "conditions.variable.id", 1);
    assertInteger(conditions.variable.min, "conditions.variable.min", 0);
    result.variableValid = true;
    result.variableId = conditions.variable.id;
    result.variableValue = conditions.variable.min;
  }

  if (conditions.selfSwitch !== undefined) {
    if (!["A", "B", "C", "D"].includes(conditions.selfSwitch)) {
      throw new Error("conditions.selfSwitch must be A, B, C, or D");
    }
    result.selfSwitchValid = true;
    result.selfSwitchCh = conditions.selfSwitch;
  }

  return result;
}

export function compileImage(image: ImageSpec): CompiledImage {
  if (!image || typeof image !== "object" || Array.isArray(image)) throw new Error("page.image must be an object");
  const characterName: string = image.characterName === undefined ? "" : image.characterName;
  if (typeof characterName !== "string") throw new Error("page.image.characterName must be a string");
  validateImageName(characterName, "page.image.characterName");
  return {
    tileId: optionalInteger(image.tileId, "page.image.tileId", 0, 0, Infinity),
    characterName,
    direction: optionalDirection(image.direction, "page.image.direction", 2),
    pattern: optionalInteger(image.pattern, "page.image.pattern", 1, 0, 2),
    characterIndex: optionalInteger(image.characterIndex, "page.image.characterIndex", 0, 0, 7)
  };
}

export function validateImageName(characterName: string, label: string): void {
  if (!characterName) return;
  if (/[\\/:]/.test(characterName) || characterName.includes("..")) {
    throw new Error(`${label} must be an asset basename under img/characters`);
  }
}

export function compileCommands(commands: CommandSpec[], system: unknown, dataDir: string, context?: PatchContext): CompiledCommand[] {
  if (!Array.isArray(commands)) throw new Error("page.commands must be an array");
  const { commands: normalized, changed } = normalizeCommands(commands);
  if (changed.length) {
    log.warn(`[compile] 编译前归一化修正了 ${changed.length} 处命令`);
  }
  const list: CompiledCommand[] = [];
  for (const command of normalized) {
    appendCommand(list, command, system, dataDir, 0, context);
  }
  if (list.length === 0 || list[list.length - 1]?.code !== 0) {
    list.push({ code: 0, indent: 0, parameters: [] });
  }
  return list;
}

export interface DecompileOptions {
  onUnsupportedReason?: (reason: string) => void;
}

function emitUnsupportedReason(reason: string, options?: DecompileOptions): void {
  if (options?.onUnsupportedReason) {
    options.onUnsupportedReason(reason);
  }
}

/**
 * 将 RPG Maker 原始命令流反编译为可编辑 AST。未能结构化解析的片段保留为 raw-command，
 * 并附带 reason，避免用错误的高层结构伪装。
 */
export function decompileCommands(rawCommands: unknown, options: DecompileOptions = {}): CommandSpec[] {
  if (!Array.isArray(rawCommands)) {
    throw new Error("rawCommands must be an array.");
  }
  const result: CommandSpec[] = [];
  for (let i = 0; i < rawCommands.length; i += 1) {
    const decompiled = decompileCommand(rawCommands, i, rawCommands.length - 1, options);
    result.push(decompiled.command);
    i = decompiled.nextIndex - 1;
  }
  return result;
}

function decompileCommand(rawCommands: unknown[], index: number, hardEnd: number, options: DecompileOptions): { command: CommandSpec; nextIndex: number } {
  const current = asRawCommand(rawCommands[index]);
  if (!current) {
    emitUnsupportedReason(`Command at index ${index} is not a raw command object.`, options);
    return {
      command: {
        kind: "raw-command",
        code: 0,
        indent: 0,
        parameters: [],
        reason: `Command at index ${index} is not a raw command object.`,
      },
      nextIndex: index + 1
    };
  }
  try {
    const range = resolveBlockRange(rawCommands, index, hardEnd, options);
    if (requiresTerminator(current.code) && !rangeHasTerminator(rawCommands, range, current.code)) {
      const reason = `Command code ${String(current.code)} at index ${index} is missing its terminator.`;
      return { command: toRawNode(current, options, reason), nextIndex: index + 1 };
    }
    if (range.end === range.start) {
      switch (current.code) {
        case 0:
          return { command: toRawNode(current, options), nextIndex: index + 1 };
        case 101:
          return { command: decompileShowText(current, rawCommands, range, options), nextIndex: range.end + 1 };
        case 108:
          return { command: decompileComment(current, rawCommands, range, options), nextIndex: range.end + 1 };
        case 117:
          return { command: decompileCommonEvent(current, options), nextIndex: range.end + 1 };
        case 205:
          return { command: decompileMoveRoute(current, rawCommands, range), nextIndex: range.end + 1 };
        case 356:
          return { command: decompilePlugin(current, options), nextIndex: range.end + 1 };
        case 111:
        case 112:
        case 102:
        case 301:
        case 302:
          return { command: decompileCommandByRange(current, rawCommands, index, range, hardEnd, options), nextIndex: range.end + 1 };
        default:
          return { command: toRawNode(current, options, `Unsupported command code ${String(current.code)} at index ${index}.`), nextIndex: index + 1 };
      }
    }
    switch (current.code) {
      case 101:
        return { command: decompileShowText(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 108:
        return { command: decompileComment(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 111:
        return { command: decompileConditionalBranch(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 112:
        return { command: decompileLoop(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 102:
        return { command: decompileChoice(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 301:
        return { command: decompileBattle(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 302:
        return { command: decompileShop(current, rawCommands, range, options), nextIndex: range.end + 1 };
      case 117:
        return { command: decompileCommonEvent(current, options), nextIndex: range.end + 1 };
      case 205:
        return { command: decompileMoveRoute(current, rawCommands, range), nextIndex: range.end + 1 };
      case 356:
        return { command: decompilePlugin(current, options), nextIndex: range.end + 1 };
      default:
        return { command: toRawNode(current, options, `Unsupported command code ${String(current.code)} at index ${index} inside block range.`), nextIndex: index + 1 };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unsupported command structure.";
    emitUnsupportedReason(reason, options);
    return { command: toRawNode(current, options, reason), nextIndex: index + 1 };
  }
}

function decompileShowText(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  const lines: string[] = [];
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const nested = asRawCommand(rawCommands[i]);
    if (!nested) {
      emitUnsupportedReason(`show-text nested command at index ${i} is invalid.`, options);
      return { kind: "text", text: "" };
    }
    if (nested.code === 401 && nested.indent === command.indent) {
      const text = nested.parameters[0];
      lines.push(typeof text === "string" ? text : JSON.stringify(text));
      continue;
    }
    if (nested.code === 108 && nested.indent === command.indent && nested.parameters.length > 0) {
      continue;
    }
    if (nested.indent < command.indent) {
      break;
    }
    if (nested.code === 0 && nested.indent === 0 && i === range.end) {
      break;
    }
    if (nested.code !== 401 && nested.code !== 408 && nested.code !== 0) {
      emitUnsupportedReason(`show-text contains unsupported nested command code ${nested.code} at index ${i}.`, options);
      return { kind: "text", text: lines.join("\n") };
    }
  }
  return {
    kind: "text",
    text: lines.join("\n"),
    faceName: command.parameters[0],
    faceIndex: command.parameters[1],
    background: command.parameters[2],
    position: command.parameters[3]
  };
}

function decompileComment(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  const lines: string[] = [];
  const first = command.parameters[0];
  if (typeof first === "string") {
    lines.push(first);
  } else if (first !== undefined) {
    emitUnsupportedReason(`comment first line is not a string at indent ${command.indent}.`, options);
    lines.push(String(first));
  }
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const nested = asRawCommand(rawCommands[i]);
    if (!nested) continue;
    if (nested.code === 408 && nested.indent === command.indent) {
      if (typeof nested.parameters[0] === "string") lines.push(nested.parameters[0]);
      else if (nested.parameters[0] !== undefined) lines.push(String(nested.parameters[0]));
      continue;
    }
    if (nested.code === 0 && nested.indent === 0 && i === range.end) break;
    if (nested.code !== 408 && nested.code !== 0 && nested.indent >= command.indent) {
      emitUnsupportedReason(`comment contains unsupported nested command code ${nested.code} at index ${i}.`, options);
    }
  }
  return { kind: "comment", text: lines.join("\n") };
}

function decompileCommonEvent(command: RawCommand, options: DecompileOptions): CommandSpec {
  const commonEventId = command.parameters[0];
  if (typeof commonEventId !== "number" || !Number.isInteger(commonEventId) || commonEventId < 1) {
    emitUnsupportedReason(`common-event requires integer id >= 1, got ${String(command.parameters[0])}.`, options);
  }
  return { kind: "common-event", id: commonEventId };
}

function decompilePlugin(command: RawCommand, options: DecompileOptions): CommandSpec {
  if (typeof command.parameters[0] !== "string") {
    emitUnsupportedReason(`plugin.command must be a string, got ${typeof command.parameters[0]}.`, options);
  }
  return { kind: "plugin", command: command.parameters[0] };
}

function decompileConditionalBranch(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  const condition = decompileBranchConditionParameters(command.parameters);
  const then: CommandSpec[] = [];
  const elseCommands: CommandSpec[] = [];
  let target: CommandSpec[] = then;
  let hasElse = false;
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const nested = asRawCommand(rawCommands[i]);
    if (!nested) continue;
    if (nested.code === 411 && nested.indent === command.indent) {
      target = elseCommands;
      hasElse = true;
      continue;
    }
    if (nested.code === 412 && nested.indent === command.indent) {
      break;
    }
    if (nested.indent <= command.indent) {
      continue;
    }
    const parsed = decompileCommand(rawCommands as unknown[], i, range.end, options);
    target.push(parsed.command);
    i = parsed.nextIndex - 1;
  }
  return {
    kind: "conditional-branch",
    condition,
    then,
    commands: then,
    else: elseCommands.length || hasElse ? elseCommands : undefined,
    hasElse
  } as CommandSpec;
}

function decompileLoop(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  const nested: CommandSpec[] = [];
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const nestedRaw = asRawCommand(rawCommands[i]);
    if (!nestedRaw) continue;
    if (nestedRaw.code === 413 && nestedRaw.indent === command.indent) {
      break;
    }
    if (nestedRaw.indent <= command.indent) {
      continue;
    }
    const parsed = decompileCommand(rawCommands as unknown[], i, range.end, options);
    nested.push(parsed.command);
    i = parsed.nextIndex - 1;
  }
  return { kind: "loop", commands: nested };
}

function decompileBattle(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  if (!Array.isArray(command.parameters) || command.parameters.length < 2) {
    throw new Error(`battle requires at least troopSource and troopId, got ${String(command.parameters?.length)}`);
  }
  const branchOnWin: CommandSpec[] = [];
  const branchOnEscape: CommandSpec[] = [];
  const branchOnLose: CommandSpec[] = [];
  let target: CommandSpec[] = branchOnWin;
  let hasWinBranch = false;
  let hasEscapeBranch = false;
  let hasLoseBranch = false;
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const nested = asRawCommand(rawCommands[i]);
    if (!nested) continue;
    if (nested.code === 601 && nested.indent === command.indent) {
      target = branchOnWin;
      hasWinBranch = true;
      continue;
    }
    if (nested.code === 602 && nested.indent === command.indent) {
      target = branchOnEscape;
      hasEscapeBranch = true;
      continue;
    }
    if (nested.code === 603 && nested.indent === command.indent) {
      target = branchOnLose;
      hasLoseBranch = true;
      continue;
    }
    if (nested.code === 604 && nested.indent === command.indent) {
      break;
    }
    if (nested.code === 604 && nested.indent > command.indent) {
      continue;
    }
    if (nested.indent <= command.indent) {
      continue;
    }
    const parsed = decompileCommand(rawCommands as unknown[], i, range.end, options);
    target.push(parsed.command);
    i = parsed.nextIndex - 1;
  }
  const result: CommandSpec = {
    kind: "battle",
    troopSource: command.parameters[0],
    troopId: command.parameters[1],
    canEscape: command.parameters[2],
    canLose: command.parameters[3],
    onWin: branchOnWin.length || hasWinBranch ? branchOnWin : undefined,
    onEscape: branchOnEscape.length || hasEscapeBranch ? branchOnEscape : undefined,
    onLose: branchOnLose.length || hasLoseBranch ? branchOnLose : undefined,
    hasWinBranch,
    hasEscapeBranch,
    hasLoseBranch
  };
  return result;
}

interface ShopGoodSpec {
  goodsType?: unknown;
  itemId?: unknown;
  priceType?: unknown;
  price?: unknown;
}

function decompileShop(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  const headGoods: ShopGoodSpec = {
    goodsType: command.parameters[0],
    itemId: command.parameters[1],
    priceType: command.parameters[2],
    price: command.parameters[3]
  };
  const goods: ShopGoodSpec[] = [headGoods];
  if (range.end > range.start) {
    for (let i = range.start + 1; i <= range.end; i += 1) {
      const nested = asRawCommand(rawCommands[i]);
      if (!nested) continue;
      if (nested.code === 605 && nested.indent === command.indent) {
        if (!Array.isArray(nested.parameters)) {
          emitUnsupportedReason(`shop continuation at index ${i} has invalid parameters.`, options);
          continue;
        }
        goods.push({
          goodsType: nested.parameters[0],
          itemId: nested.parameters[1],
          priceType: nested.parameters[2],
          price: nested.parameters[3]
        });
        continue;
      }
      if (nested.indent <= command.indent) {
        continue;
      }
      emitUnsupportedReason(`shop contains unsupported nested command code ${nested.code} at index ${i}.`, options);
    }
  }
  const purchaseOnly = command.parameters[4];
  return {
    kind: "shop",
    goods,
    purchaseOnly,
    goodsType: headGoods.goodsType,
    itemId: headGoods.itemId,
    priceType: headGoods.priceType,
    price: headGoods.price
  };
}

function decompileMoveRoute(command: RawCommand, rawCommands: unknown[], range: DecompiledRange): CommandSpec {
  if (!Array.isArray(command.parameters) || command.parameters.length < 2) {
    throw new Error("move-route requires [target, route] parameters");
  }
  const moveTarget = command.parameters[0];
  const routeContainer = command.parameters[1] as { list?: unknown[]; repeat?: boolean; skippable?: boolean; wait?: boolean };
  if (!routeContainer || typeof routeContainer !== "object" || !Array.isArray(routeContainer.list)) {
    throw new Error("move-route route field is invalid");
  }
  const route: MoveRouteItem[] = [];
  const rawRoute = routeContainer.list as unknown[];
  for (let i = 0; i < rawRoute.length; i += 1) {
    const step = rawRoute[i];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error("move-route step must be object.");
    }
    const s = step as { code?: unknown; parameters?: unknown[] };
    const code = s.code;
    const parameters = Array.isArray(s.parameters) ? s.parameters : [];
    if (!Number.isInteger(code)) {
      throw new Error("move-route step code must be integer.");
    }
    if (code === 0) continue;
    if (code === 15) {
      route.push({ kind: "wait", frames: parameters[0] as number });
      continue;
    }
    if (code === 29) {
      route.push({ kind: "speed", value: parameters[0] as number });
      continue;
    }
    if (code === 30) {
      route.push({ kind: "frequency", value: parameters[0] as number });
      continue;
    }
    if (code === 37 || code === 38) {
      route.push({ kind: "through", value: code === 37 });
      continue;
    }
    const directionFromCode = Object.entries(MOVE_CODES).find((entry) => entry[1] === code)?.[0];
    if (directionFromCode) {
      route.push({ kind: "move", direction: directionFromCode, steps: 1 });
      continue;
    }
    const turnFromCode = Object.entries(TURN_CODES).find((entry) => entry[1] === code)?.[0];
    if (turnFromCode) {
      route.push({ kind: "turn", direction: turnFromCode });
      continue;
    }
    throw new Error(`Unsupported move-route step code ${String(code)}.`);
  }
  return {
    kind: "move-route",
    target: moveTarget,
    repeat: routeContainer.repeat,
    skippable: routeContainer.skippable,
    wait: routeContainer.wait,
    continuationCommands: rangeContainsCode(rawCommands, range, command.indent, 505),
    route
  };
}

function decompileBranchConditionParameters(parameters: unknown[]): BranchCondition {
  if (!Array.isArray(parameters) || parameters.length < 1) {
    throw new Error("conditional-branch lacks parameters.");
  }
  const conditionType = parameters[0];
  if (conditionType === 0) {
    return {
      kind: "switch",
      id: parameters[1] as number,
      value: parameters[2] === 1 ? false : true
    };
  }
  if (conditionType === 1) {
    const value = parameters[3];
    return {
      kind: "variable",
      id: parameters[1] as number,
      operator: ["===", ">=", "<=", ">", "<", "!=="][parameters[4] as number],
      value
    };
  }
  if (conditionType === 2) {
    return {
      kind: "self-switch",
      name: parameters[1] as string,
      value: parameters[2] === 1 ? false : true
    };
  }
  throw new Error(`Unsupported conditional-branch type ${String(conditionType)}.`);
}

function decompileCommandByRange(
  command: RawCommand,
  rawCommands: unknown[],
  index: number,
  range: DecompiledRange,
  hardEnd: number,
  options: DecompileOptions
): CommandSpec {
  switch (command.code) {
    case 111:
      return decompileConditionalBranch(command, rawCommands, range, options);
    case 112:
      return decompileLoop(command, rawCommands, range, options);
    case 102:
      return decompileChoice(command, rawCommands, range, options);
    case 301:
      return decompileBattle(command, rawCommands, range, options);
    case 302:
      return decompileShop(command, rawCommands, range, options);
    default:
      throw new Error(`Unsupported block-like command code ${String(command.code)}.`);
  }
}

function decompileChoice(command: RawCommand, rawCommands: unknown[], range: DecompiledRange, options: DecompileOptions): CommandSpec {
  const choicesParam = command.parameters[0];
  if (!Array.isArray(choicesParam)) {
    throw new Error("choice choices must be an array.");
  }
  const choices: (string | { text: string; commands?: CommandSpec[]; })[] = choicesParam.map((choice) => {
    if (typeof choice === "string") return choice;
    if (choice && typeof choice === "object") {
      if (!("text" in choice)) return { text: "" };
      return { text: String((choice as { text?: unknown }).text || "") };
    }
    return String(choice);
  }).map((choice) => (typeof choice === "string" ? { text: choice, commands: [] } : { ...choice, commands: [] }));

  const cancelCommands: CommandSpec[] = [];
  const choicesByIndex: Array<{ text: string; commands: CommandSpec[] }> = choices.map((choice) => {
    const text = typeof choice === "string" ? choice : choice.text;
    return { text, commands: [] };
  });
  let currentChoice = 0;
  let inCancel = false;
  let hasCancelBranch = false;
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const nested = asRawCommand(rawCommands[i]);
    if (!nested) continue;
    if (nested.code === 402 && nested.indent === command.indent) {
      if (Number.isInteger(nested.parameters[0] as number)) {
        currentChoice = Number(nested.parameters[0]);
        inCancel = false;
      } else {
        throw new Error(`choice selector index must be integer at index ${i}.`);
      }
      continue;
    }
    if (nested.code === 403 && nested.indent === command.indent) {
      inCancel = true;
      hasCancelBranch = true;
      continue;
    }
    if (nested.code === 404 && nested.indent === command.indent) {
      break;
    }
    if (nested.indent <= command.indent) {
      continue;
    }
    const parsed = decompileCommand(rawCommands as unknown[], i, range.end, options);
    if (inCancel) {
      if (parsed.command.kind !== "raw-command" || parsed.command.reason === undefined || parsed.command.reason === "") {
        cancelCommands.push(parsed.command);
      } else {
        cancelCommands.push(parsed.command);
      }
    } else if (currentChoice >= 0 && currentChoice < choicesByIndex.length) {
      choicesByIndex[currentChoice].commands.push(parsed.command);
    }
    i = parsed.nextIndex - 1;
  }
  const result: CommandSpec = {
    kind: "choice",
    choices: choicesByIndex.map((entry) => ({ text: entry.text, commands: entry.commands })),
    cancelType: command.parameters[1],
    defaultType: command.parameters[2],
    positionType: command.parameters[3],
    background: command.parameters[4],
  };
  if (cancelCommands.length) {
    (result as ChoiceCommand).cancelCommands = cancelCommands;
  }
  if (hasCancelBranch) {
    (result as ChoiceCommand).hasCancelBranch = true;
    if (!cancelCommands.length) {
      (result as ChoiceCommand).cancelCommands = [];
    }
  }
  return result;
}

function toRawNode(command: RawCommand, options: DecompileOptions = {}, reason?: string): RawCommandSpec {
  if (reason) {
    emitUnsupportedReason(reason, options);
  }
  return {
    kind: "raw-command",
    code: command.code,
    indent: command.indent,
    parameters: cloneRawParameters(command.parameters),
    reason: reason || undefined
  };
}

function resolveBlockRange(rawCommands: unknown[], start: number, hardEnd: number, options: DecompileOptions): DecompiledRange {
  const current = asRawCommand(rawCommands[start]);
  if (!current) return { start, end: start };
  const pairing = EVENT_COMMAND_BLOCK_PAIRINGS[current.code];
  if (!pairing) return { start, end: start };
  const headIndent: number = current.indent;
  let end = start;
  for (let i = start + 1; i <= hardEnd; i += 1) {
    const command = asRawCommand(rawCommands[i]);
    if (!command) continue;
    if (pairing.continuations && pairing.continuations.includes(command.code) && command.indent === headIndent) {
      end = i;
      continue;
    }
    if (pairing.terminator !== undefined && command.code === pairing.terminator && command.indent === headIndent) {
      end = i;
      return { start, end };
    }
    if (command.indent > headIndent) {
      end = i;
      continue;
    }
    if (command.indent <= headIndent) {
      break;
    }
  }
  return { start, end };
}

function requiresTerminator(code: number): boolean {
  const pairing = EVENT_COMMAND_BLOCK_PAIRINGS[code];
  return pairing?.terminator !== undefined;
}

function rangeHasTerminator(rawCommands: unknown[], range: DecompiledRange, code: number): boolean {
  const pairing = EVENT_COMMAND_BLOCK_PAIRINGS[code];
  if (pairing?.terminator === undefined) return true;
  const head = asRawCommand(rawCommands[range.start]);
  if (!head) return false;
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const command = asRawCommand(rawCommands[i]);
    if (command && command.code === pairing.terminator && command.indent === head.indent) return true;
  }
  return false;
}

function rangeContainsCode(rawCommands: unknown[], range: DecompiledRange, indent: number, code: number): boolean {
  for (let i = range.start + 1; i <= range.end; i += 1) {
    const command = asRawCommand(rawCommands[i]);
    if (command && command.code === code && command.indent === indent) return true;
  }
  return false;
}

function asRawCommand(value: unknown): RawCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<RawCommand>;
  if (!Number.isInteger(candidate.code) || candidate.code === undefined) return null;
  if (!Number.isInteger(candidate.indent) || candidate.indent === undefined || candidate.indent < 0) return null;
  if (!Array.isArray(candidate.parameters)) return null;
  return {
    code: candidate.code,
    indent: candidate.indent,
    parameters: candidate.parameters
  };
}

function cloneRawParameters<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function appendCommand(list: CompiledCommand[], command: CommandSpec, system: unknown, dataDir: string, indent: number, context?: PatchContext): void {
  if (!command || typeof command !== "object") throw new Error("Each command must be an object");
  // 防御性 kind 归一：兜底未经注册归一化的编译路径（如 patch 直接编译）。
  const canonicalKind = COMMAND_KIND_ALIASES[command.kind];
  if (canonicalKind && canonicalKind !== command.kind) command = { ...command, kind: canonicalKind };
  switch (command.kind) {
    case "raw-command":
    case "mv-command":
      appendRawCommand(list, command as RawCommandSpec);
      return;
    case "comment":
      appendComment(list, command.text as string, indent);
      return;
    case "text":
      appendText(list, command as unknown as TextCommand, indent);
      return;
    case "switch":
      assertInteger(command.id as number, "switch.id", 1);
      list.push({ code: 121, indent, parameters: [command.id, command.id, command.value === false ? 1 : 0] });
      return;
    case "variable":
      assertInteger(command.id as number, "variable.id", 1);
      assertInteger(command.value as number, "variable.value", 0);
      list.push({ code: 122, indent, parameters: [command.id, command.id, 0, 0, command.value] });
      return;
    case "self-switch":
      if (!["A", "B", "C", "D"].includes(command.name as string)) throw new Error("self-switch.name must be A, B, C, or D");
      list.push({ code: 123, indent, parameters: [command.name, command.value === false ? 1 : 0] });
      return;
    case "wait":
      assertInteger(command.frames as number, "wait.frames", 1);
      list.push({ code: 230, indent, parameters: [command.frames] });
      return;
    case "move-route":
      appendMoveRoute(list, command as unknown as MoveRouteCommand, indent);
      return;
    case "fadeout":
      list.push({ code: 221, indent, parameters: [] });
      return;
    case "fadein":
      list.push({ code: 222, indent, parameters: [] });
      return;
    case "screen-tint":
      appendScreenTint(list, command as unknown as ScreenTintCommand, indent);
      return;
    case "screen-flash":
      appendScreenFlash(list, command as unknown as ScreenFlashCommand, indent);
      return;
    case "screen-shake":
      appendScreenShake(list, command as unknown as ScreenShakeCommand, indent);
      return;
    case "play-se":
      appendPlaySe(list, command as unknown as PlaySeCommand, indent);
      return;
    case "show-animation":
      appendShowAnimation(list, command as unknown as ShowAnimationCommand, indent);
      return;
    case "show-balloon":
      appendShowBalloon(list, command as unknown as ShowBalloonCommand, indent);
      return;
    case "change-gold":
      appendChangeGold(list, command as unknown as ChangeGoldCommand, indent);
      return;
    case "change-items":
      appendChangeItems(list, command as unknown as ChangeItemsCommand, indent);
      return;
    case "transfer":
      appendTransfer(list, command as unknown as TransferCommand, dataDir, indent, context);
      return;
    case "common-event":
      assertInteger(command.id as number, "common-event.id", 1);
      list.push({ code: 117, indent, parameters: [command.id] });
      return;
    case "plugin":
      if (!command.command || typeof command.command !== "string") throw new Error("plugin.command must be a non-empty string");
      list.push({ code: 356, indent, parameters: [command.command] });
      return;
    case "conditional-branch":
      appendConditionalBranch(list, command as unknown as ConditionalBranchCommand, system, dataDir, indent, context);
      return;
    case "choice":
      appendChoice(list, command as unknown as ChoiceCommand, system, dataDir, indent, context);
      return;
    case "loop":
      appendLoop(list, command as unknown as LoopCommand, system, dataDir, indent, context);
      return;
    case "battle":
      appendBattle(list, command as unknown as BattleCommand, system, dataDir, indent, context);
      return;
    case "shop":
      appendShop(list, command as unknown as ShopCommand, system, dataDir, indent);
      return;
    case "break-loop":
      list.push({ code: 113, indent, parameters: [] });
      return;
    default:
      throw new Error(`Unsupported command kind: ${command.kind}`);
  }
}

function appendRawCommand(list: CompiledCommand[], command: RawCommandSpec): void {
  const raw = {
    code: command.code,
    indent: command.indent,
    parameters: command.parameters
  };
  validateEventCommandBasic(raw, command.kind);
  list.push({
    code: raw.code,
    indent: raw.indent,
    parameters: JSON.parse(JSON.stringify(raw.parameters))
  });
}

interface MoveRouteCommand extends CommandSpec {
  route?: MoveRouteItem[];
  repeat?: boolean;
  skippable?: boolean;
  wait?: boolean;
  target?: unknown;
  continuationCommands?: boolean;
}

interface MoveRouteItem {
  kind: string;
  direction?: string;
  steps?: number;
  frames?: number;
  value?: unknown;
}

function appendMoveRoute(list: CompiledCommand[], command: MoveRouteCommand, indent: number): void {
  const routeCommands: CompiledCommand[] = compileMoveRouteCommands(command.route || []);
  const routeList = routeCommands.map((routeCommand) => toMoveRouteRawStep(routeCommand));
  list.push({
    code: 205,
    indent,
    parameters: [
      movementTargetId(command.target),
      {
        list: routeList,
        repeat: Boolean(command.repeat),
        skippable: Boolean(command.skippable),
        wait: command.wait !== false
      }
    ]
  });
  if (command.continuationCommands === true) {
    for (const routeCommand of routeList) {
      if (routeCommand.code !== 0) {
        list.push({ code: 505, indent, parameters: [cloneRawParameters(routeCommand)] });
      }
    }
  }
}

function toMoveRouteRawStep(command: CompiledCommand): MoveRouteRawStep {
  return {
    code: command.code,
    parameters: cloneRawParameters(command.parameters)
  };
}

function compileMoveRouteCommands(route: MoveRouteItem[]): CompiledCommand[] {
  if (!Array.isArray(route) || route.length === 0) throw new Error("move-route.route must be a non-empty array");
  const result: CompiledCommand[] = [];
  for (const item of route) {
    if (!item || typeof item !== "object") throw new Error("Each move-route item must be an object");
    if (item.kind === "move") {
      const code: number | undefined = MOVE_CODES[item.direction!];
      if (!code) throw new Error(`Unsupported move direction: ${item.direction}`);
      const steps: number = item.steps === undefined ? 1 : item.steps;
      assertInteger(steps, "move.steps", 1);
      for (let index = 0; index < steps; index += 1) result.push({ code, indent: 0, parameters: [] });
    } else if (item.kind === "turn") {
      const code: number | undefined = TURN_CODES[item.direction!];
      if (!code) throw new Error(`Unsupported turn direction: ${item.direction}`);
      result.push({ code, indent: 0, parameters: [] });
    } else if (item.kind === "wait") {
      assertInteger(item.frames!, "route.wait.frames", 1);
      result.push({ code: 15, indent: 0, parameters: [item.frames] });
    } else if (item.kind === "speed") {
      assertInteger(item.value as number, "route.speed.value", 1);
      result.push({ code: 29, indent: 0, parameters: [item.value] });
    } else if (item.kind === "frequency") {
      assertInteger(item.value as number, "route.frequency.value", 1);
      result.push({ code: 30, indent: 0, parameters: [item.value] });
    } else if (item.kind === "through") {
      result.push({ code: item.value === false ? 38 : 37, indent: 0, parameters: [] });
    } else {
      throw new Error(`Unsupported move-route item kind: ${item.kind}`);
    }
  }
  result.push({ code: 0, indent: 0, parameters: [] });
  return result;
}

function movementTargetId(target: unknown): number {
  if (target === undefined || target === "this-event" || target === 0) return 0;
  if (target === "player") return -1;
  if (Number.isInteger(target) && (target as number) > 0) return target as number;
  if (target && typeof target === "object" && Number.isInteger((target as { eventId?: number }).eventId) && (target as { eventId: number }).eventId > 0) return (target as { eventId: number }).eventId;
  throw new Error("move-route.target must be this-event, player, a positive event id, or { eventId }");
}

function appendComment(list: CompiledCommand[], text: string, indent: number): void {
  const lines: string[] = splitLines(text, "comment.text");
  let emitted = 0;
  lines.forEach((line) => {
    if (line.trim().startsWith("AIWF:")) return;
    list.push({ code: emitted === 0 ? 108 : 408, indent, parameters: [line] });
    emitted += 1;
  });
}

interface TextCommand extends CommandSpec {
  text?: string;
  faceName?: string;
  faceIndex?: number;
  background?: number;
  position?: number;
}

function appendText(list: CompiledCommand[], command: TextCommand, indent: number): void {
  const lines: string[] = splitLines(command.text || "", "text.text");
  list.push({
    code: 101,
    indent,
    parameters: [
      command.faceName || "",
      command.faceIndex || 0,
      command.background === undefined ? 0 : command.background,
      command.position === undefined ? 2 : command.position
    ]
  });
  for (const line of lines) {
    list.push({ code: 401, indent, parameters: [line] });
  }
}

interface ScreenTintCommand extends CommandSpec {
  tone?: { red?: number; green?: number; blue?: number; gray?: number };
  duration?: number;
  wait?: boolean;
}

function appendScreenTint(list: CompiledCommand[], command: ScreenTintCommand, indent: number): void {
  const tone = command.tone || {};
  const duration: number = command.duration === undefined ? 60 : command.duration;
  assertInteger(duration, "screen-tint.duration", 0);
  list.push({
    code: 223,
    indent,
    parameters: [
      [
        boundedInteger(tone.red || 0, "screen-tint.tone.red", -255, 255),
        boundedInteger(tone.green || 0, "screen-tint.tone.green", -255, 255),
        boundedInteger(tone.blue || 0, "screen-tint.tone.blue", -255, 255),
        boundedInteger(tone.gray || 0, "screen-tint.tone.gray", 0, 255)
      ],
      duration,
      command.wait !== false
    ]
  });
}

interface ScreenFlashCommand extends CommandSpec {
  color?: { red?: number; green?: number; blue?: number; intensity?: number };
  duration?: number;
  wait?: boolean;
}

function appendScreenFlash(list: CompiledCommand[], command: ScreenFlashCommand, indent: number): void {
  const color = command.color || {};
  const duration: number = command.duration === undefined ? 30 : command.duration;
  assertInteger(duration, "screen-flash.duration", 0);
  list.push({
    code: 224,
    indent,
    parameters: [
      [
        boundedInteger(color.red === undefined ? 255 : color.red, "screen-flash.color.red", 0, 255),
        boundedInteger(color.green === undefined ? 255 : color.green, "screen-flash.color.green", 0, 255),
        boundedInteger(color.blue === undefined ? 255 : color.blue, "screen-flash.color.blue", 0, 255),
        boundedInteger(color.intensity === undefined ? 170 : color.intensity, "screen-flash.color.intensity", 0, 255)
      ],
      duration,
      command.wait !== false
    ]
  });
}

interface ScreenShakeCommand extends CommandSpec {
  power?: number;
  speed?: number;
  duration?: number;
  wait?: boolean;
}

function appendScreenShake(list: CompiledCommand[], command: ScreenShakeCommand, indent: number): void {
  const duration: number = command.duration === undefined ? 30 : command.duration;
  list.push({
    code: 225,
    indent,
    parameters: [
      boundedInteger(command.power === undefined ? 5 : command.power, "screen-shake.power", 0, 9),
      boundedInteger(command.speed === undefined ? 5 : command.speed, "screen-shake.speed", 0, 9),
      boundedInteger(duration, "screen-shake.duration", 0, 999),
      command.wait !== false
    ]
  });
}

interface PlaySeCommand extends CommandSpec {
  name?: string;
  volume?: number;
  pitch?: number;
  pan?: number;
}

function appendPlaySe(list: CompiledCommand[], command: PlaySeCommand, indent: number): void {
  const name: string = splitLines(command.name || "", "play-se.name")[0];
  list.push({
    code: 250,
    indent,
    parameters: [
      {
        name,
        volume: boundedInteger(command.volume === undefined ? 90 : command.volume, "play-se.volume", 0, 100),
        pitch: boundedInteger(command.pitch === undefined ? 100 : command.pitch, "play-se.pitch", 50, 150),
        pan: boundedInteger(command.pan || 0, "play-se.pan", -100, 100)
      }
    ]
  });
}

interface ShowAnimationCommand extends CommandSpec {
  animationId?: number;
  target?: unknown;
  wait?: boolean;
}

function appendShowAnimation(list: CompiledCommand[], command: ShowAnimationCommand, indent: number): void {
  assertInteger(command.animationId!, "show-animation.animationId", 1);
  list.push({ code: 212, indent, parameters: [movementTargetId(command.target), command.animationId, command.wait !== false] });
}

interface ShowBalloonCommand extends CommandSpec {
  balloonId?: number;
  target?: unknown;
  wait?: boolean;
}

function appendShowBalloon(list: CompiledCommand[], command: ShowBalloonCommand, indent: number): void {
  assertInteger(command.balloonId!, "show-balloon.balloonId", 1);
  list.push({ code: 213, indent, parameters: [movementTargetId(command.target), command.balloonId, command.wait !== false] });
}

interface ChangeGoldCommand extends CommandSpec {
  operation?: string;
  value?: number;
}

/**
 * 把 `{ operation, value }` 解析成 RMMV 增减操作。value 允许写负数表示减少
 * （兼容模型常见写法），但 RMMV 命令的 operand 必须是非负整数。
 */
function resolveAmount(operation: unknown, value: number | undefined, label: string): { op: number; operand: number } {
  if (!Number.isInteger(value)) throw new Error(`${label}.value must be an integer`);
  const normalizedOp = normalizeAmountOperation(operation);
  let op: number;
  if (normalizedOp === undefined) {
    op = (value as number) < 0 ? 1 : 0;
  } else if (normalizedOp === "increase" || normalizedOp === "decrease") {
    op = normalizedOp === "increase" ? 0 : 1;
  } else {
    throw new Error(`${label}.operation must be "increase" or "decrease"`);
  }
  return { op, operand: Math.abs(value as number) };
}

function appendChangeGold(list: CompiledCommand[], command: ChangeGoldCommand, indent: number): void {
  const { op, operand } = resolveAmount(command.operation, command.value, "change-gold");
  list.push({ code: 125, indent, parameters: [op, 0, operand] });
}

interface ChangeItemsCommand extends CommandSpec {
  itemId?: number;
  operation?: string;
  value?: number;
}

function appendChangeItems(list: CompiledCommand[], command: ChangeItemsCommand, indent: number): void {
  assertInteger(command.itemId!, "change-items.itemId", 1);
  const { op, operand } = resolveAmount(command.operation, command.value, "change-items");
  list.push({ code: 126, indent, parameters: [command.itemId, op, 0, operand] });
}

interface TransferCommand extends CommandSpec {
  mapId?: number;
  x?: number;
  y?: number;
  direction?: number;
  fadeType?: number;
}

function appendTransfer(list: CompiledCommand[], command: TransferCommand, dataDir: string, indent: number, context?: PatchContext): void {
  assertInteger(command.mapId!, "transfer.mapId", 1);
  assertInteger(command.x!, "transfer.x", 0);
  assertInteger(command.y!, "transfer.y", 0);
  const mapFile: string = path.join(dataDir, `Map${String(command.mapId).padStart(3, "0")}.json`);
  let map: { width: number; height: number } | null = null;
  if (fs.existsSync(mapFile)) {
    map = readJson(mapFile) as { width: number; height: number };
  } else if (context && context.plannedMaps && context.plannedMaps.has(command.mapId as number)) {
    map = context.plannedMaps.get(command.mapId as number) as { width: number; height: number };
  } else {
    throw new Error(`transfer target map ${command.mapId} does not exist`);
  }
  if (command.x! >= map.width || command.y! >= map.height) {
    throw new Error(`transfer target (${command.x},${command.y}) is outside map ${command.mapId} bounds ${map.width}x${map.height}`);
  }
  list.push({
    code: 201,
    indent,
    parameters: [0, command.mapId, command.x, command.y, command.direction || 2, command.fadeType || 0]
  });
}

interface ConditionalBranchCommand extends CommandSpec {
  condition?: BranchCondition;
  then?: CommandSpec[];
  commands?: CommandSpec[];
  else?: CommandSpec[];
  hasElse?: boolean;
}

interface BranchCondition {
  kind?: string;
  id?: number;
  value?: unknown;
  operator?: string;
  name?: string;
}

function appendConditionalBranch(list: CompiledCommand[], command: ConditionalBranchCommand, system: unknown, dataDir: string, indent: number, context?: PatchContext): void {
  list.push({ code: 111, indent, parameters: compileBranchCondition(command.condition || {}) });
  appendNestedCommands(list, command.then || command.commands || [], system, dataDir, indent + 1, context);
  if ((Array.isArray(command.else) && command.else.length) || command.hasElse === true) {
    list.push({ code: 411, indent, parameters: [] });
    appendNestedCommands(list, command.else || [], system, dataDir, indent + 1, context);
  }
  list.push({ code: 412, indent, parameters: [] });
}

interface ChoiceCommand extends CommandSpec {
  choices?: (string | { text?: string; commands?: CommandSpec[] })[];
  cancelCommands?: CommandSpec[];
  hasCancelBranch?: boolean;
  cancelType?: number;
  defaultType?: number;
  positionType?: number;
  background?: number;
}

function appendChoice(list: CompiledCommand[], command: ChoiceCommand, system: unknown, dataDir: string, indent: number, context?: PatchContext): void {
  const choices: string[] = (command.choices || []).map((choice) => typeof choice === "string" ? choice : choice && choice.text).filter(Boolean) as string[];
  if (!choices.length) throw new Error("choice.choices must contain at least one choice");
  list.push({
    code: 102,
    indent,
    parameters: [
      choices,
      command.cancelType === undefined ? -1 : command.cancelType,
      command.defaultType === undefined ? 0 : command.defaultType,
      command.positionType === undefined ? 2 : command.positionType,
      command.background === undefined ? 0 : command.background
    ]
  });
  choices.forEach((choice, index) => {
    list.push({ code: 402, indent, parameters: [index, choice] });
    const source = command.choices![index];
    const branchCommands: CommandSpec[] = source && typeof source === "object" ? (source as { commands?: CommandSpec[] }).commands || [] : [];
    appendNestedCommands(list, branchCommands, system, dataDir, indent + 1, context);
  });
  if ((Array.isArray(command.cancelCommands) && command.cancelCommands.length) || command.hasCancelBranch === true) {
    list.push({ code: 403, indent, parameters: [] });
    appendNestedCommands(list, command.cancelCommands || [], system, dataDir, indent + 1, context);
  }
  list.push({ code: 404, indent, parameters: [] });
}

interface BattleCommandBranchSpec {
  onWin?: CommandSpec[];
  onEscape?: CommandSpec[];
  onLose?: CommandSpec[];
  hasWinBranch?: boolean;
  hasEscapeBranch?: boolean;
  hasLoseBranch?: boolean;
}

interface BattleCommand extends CommandSpec, BattleCommandBranchSpec {
  troopSource?: number;
  troopId?: number;
  canEscape?: boolean | number;
  canLose?: boolean | number;
}

function appendBattle(list: CompiledCommand[], command: BattleCommand, system: unknown, dataDir: string, indent: number, context?: PatchContext): void {
  const troopSource = asInteger(command.troopSource === undefined ? 0 : command.troopSource, "battle.troopSource", 0);
  const troopId = asInteger(command.troopId === undefined ? 1 : command.troopId, "battle.troopId", 0);
  list.push({
    code: 301,
    indent,
    parameters: [troopSource, troopId, toZeroOneFlag(command.canEscape, "battle.canEscape", true), toZeroOneFlag(command.canLose, "battle.canLose", false)]
  });

  if ((Array.isArray(command.onWin) && command.onWin.length) || command.hasWinBranch === true) {
    list.push({ code: 601, indent, parameters: [] });
    appendNestedCommands(list, command.onWin || [], system, dataDir, indent + 1, context);
  }
  if ((Array.isArray(command.onEscape) && command.onEscape.length) || command.hasEscapeBranch === true) {
    list.push({ code: 602, indent, parameters: [] });
    appendNestedCommands(list, command.onEscape || [], system, dataDir, indent + 1, context);
  }
  if ((Array.isArray(command.onLose) && command.onLose.length) || command.hasLoseBranch === true) {
    list.push({ code: 603, indent, parameters: [] });
    appendNestedCommands(list, command.onLose || [], system, dataDir, indent + 1, context);
  }
  list.push({ code: 604, indent, parameters: [] });
}

interface ShopGood {
  goodsType?: number;
  itemId?: number;
  priceType?: number;
  price?: number;
}

interface ShopCommand extends CommandSpec {
  purchaseOnly?: boolean | number;
  goods?: ShopGood[];
  goodsType?: number;
  itemId?: number;
  priceType?: number;
  price?: number;
}

function appendShop(list: CompiledCommand[], command: ShopCommand, _system: unknown, _dataDir: string, indent: number): void {
  const goodsLines: ShopGood[] = Array.isArray(command.goods) && command.goods.length
    ? command.goods
    : [
      {
        goodsType: command.goodsType as number,
        itemId: command.itemId as number,
        priceType: command.priceType as number,
        price: command.price as number
      }
    ];

  if (!goodsLines.length || !goodsLines.every((good) => good.goodsType !== undefined && good.itemId !== undefined && good.priceType !== undefined && good.price !== undefined)) {
    throw new Error("shop requires at least one goods entry with goodsType/itemId/priceType/price");
  }

  const head = goodsLines[0] as ShopGood;
  const headGoodsType = asInteger(head.goodsType, "shop.goodsType", 0);
  const headItemId = asInteger(head.itemId, "shop.itemId", 1);
  const headPriceType = asInteger(head.priceType, "shop.priceType", 0);
  const headPrice = asInteger(head.price, "shop.price", 0);
  list.push({
    code: 302,
    indent,
    parameters: [headGoodsType, headItemId, headPriceType, headPrice, toZeroOneFlag(command.purchaseOnly, "shop.purchaseOnly", false)]
  });

  for (let i = 1; i < goodsLines.length; i += 1) {
    const good = goodsLines[i];
    const goodsType = asInteger(good.goodsType, `shop.goods[${i}].goodsType`, 0);
    const itemId = asInteger(good.itemId, `shop.goods[${i}].itemId`, 1);
    const priceType = asInteger(good.priceType, `shop.goods[${i}].priceType`, 0);
    const price = asInteger(good.price, `shop.goods[${i}].price`, 0);
    list.push({
      code: 605,
      indent,
      parameters: [goodsType, itemId, priceType, price]
    });
  }
}

interface LoopCommand extends CommandSpec {
  commands?: CommandSpec[];
}

function appendLoop(list: CompiledCommand[], command: LoopCommand, system: unknown, dataDir: string, indent: number, context?: PatchContext): void {
  list.push({ code: 112, indent, parameters: [] });
  appendNestedCommands(list, command.commands || [], system, dataDir, indent + 1, context);
  list.push({ code: 413, indent, parameters: [] });
}

function appendNestedCommands(list: CompiledCommand[], commands: CommandSpec[], system: unknown, dataDir: string, indent: number, context?: PatchContext): void {
  if (!Array.isArray(commands)) throw new Error("Nested commands must be an array");
  for (const command of commands) appendCommand(list, command, system, dataDir, indent, context);
}

function compileBranchCondition(condition: BranchCondition): unknown[] {
  if (condition.kind === "switch") {
    assertInteger(condition.id!, "conditional-branch.switch.id", 1);
    return [0, condition.id, condition.value === false ? 1 : 0];
  }
  if (condition.kind === "variable") {
    assertInteger(condition.id!, "conditional-branch.variable.id", 1);
    assertInteger(condition.value as number, "conditional-branch.variable.value", 0);
    const operators: Record<string, number> = { "===": 0, ">=": 1, "<=": 2, ">": 3, "<": 4, "!==": 5 };
    const operator: number | undefined = operators[condition.operator || ">="];
    if (operator === undefined) throw new Error("conditional-branch.variable.operator must be ===, >=, <=, >, <, or !==");
    return [1, condition.id, 0, condition.value, operator];
  }
  if (condition.kind === "self-switch") {
    if (!["A", "B", "C", "D"].includes(condition.name!)) throw new Error("conditional-branch.self-switch.name must be A, B, C, or D");
    return [2, condition.name, condition.value === false ? 1 : 0];
  }
  throw new Error("conditional-branch.condition.kind must be switch, variable, or self-switch");
}

function splitLines(value: string, label: string): string[] {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.split(/\r?\n/);
}

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
}

function asInteger(value: number | undefined, label: string, min: number): number {
  assertInteger(value as number, label, min);
  return value as number;
}

function toZeroOneFlag(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  if (value === false) return false;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`${label} must be boolean or 0/1.`);
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalInteger(value: number | undefined | null, label: string, defaultValue: number, min: number, max: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalDirection(value: number | undefined | null, label: string, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (![2, 4, 6, 8].includes(value)) {
    throw new Error(`${label} must be one of 2, 4, 6, or 8`);
  }
  return value;
}
