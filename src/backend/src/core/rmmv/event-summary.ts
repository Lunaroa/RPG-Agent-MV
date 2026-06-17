const TRIGGERS: Record<number, string> = {
  0: "action-button",
  1: "player-touch",
  2: "event-touch",
  3: "autorun",
  4: "parallel"
};

const PRIORITIES: Record<number, string> = {
  0: "below-characters",
  1: "same-as-characters",
  2: "above-characters"
};

interface PageConditions {
  switch1Valid?: boolean;
  switch1Id?: number;
  switch2Valid?: boolean;
  switch2Id?: number;
  variableValid?: boolean;
  variableId?: number;
  variableValue?: number;
  selfSwitchValid?: boolean;
  selfSwitchCh?: string;
  itemValid?: boolean;
  itemId?: number;
  actorValid?: boolean;
  actorId?: number;
}

interface ConditionSignature {
  requirementCount: number;
  switches: number[];
  variable?: { id: number; min: number };
  selfSwitch?: string;
  itemId?: number;
  actorId?: number;
}

interface CommandFacts {
  comments: string[];
  textPreview: string[];
  choices: string[];
  switchWrites: SwitchWrite[];
  variableWrites: VariableWrite[];
  selfSwitchWrites: SelfSwitchWrite[];
  transfers: TransferSummary[];
  commonEvents: { id: number; name: string | null }[];
  pluginCommands: string[];
  scriptCalls: number;
  movementRoutes: number;
  waits: number[];
  fades: string[];
  audio: string[];
  pictures: number;
  battles: number;
  shops: number;
  rawCommandCount?: number;
}

interface SwitchWrite {
  from: number;
  to: number;
  value: string;
  names: (string | null)[];
}

interface VariableWrite {
  from: number;
  to: number;
  operation: string;
  operand: VariableOperand;
  names: (string | null)[];
}

interface SelfSwitchWrite {
  name: string;
  value: string;
}

interface TransferSummary {
  mode: string;
  mapId?: number;
  x?: number;
  y?: number;
  direction?: number;
  fadeType?: number;
  mapVariableId?: number;
  xVariableId?: number;
  yVariableId?: number;
}

interface VariableOperand {
  kind: string;
  value?: unknown;
  min?: number;
  max?: number;
}

interface RMMVCommand {
  code: number;
  parameters?: unknown[];
}

interface RMMVPageConditions {
  switch1Valid?: boolean;
  switch1Id?: number;
  switch2Valid?: boolean;
  switch2Id?: number;
  variableValid?: boolean;
  variableId?: number;
  variableValue?: number;
  selfSwitchValid?: boolean;
  selfSwitchCh?: string;
  itemValid?: boolean;
  itemId?: number;
  actorValid?: boolean;
  actorId?: number;
}

interface RMMVPage {
  conditions?: RMMVPageConditions;
  trigger?: number;
  priorityType?: number;
  list?: RMMVCommand[];
  image?: { characterName?: string; tileId?: number };
  moveType?: number;
  walkAnime?: boolean;
  stepAnime?: boolean;
  directionFix?: boolean;
  through?: boolean;
}

function nameAt(list: string[] | null | undefined, id: number, fallbackPrefix?: string): string | null {
  if (!id && id !== 0) return null;
  const name: string | null = Array.isArray(list) ? list[id] : null;
  return name ? `${id}:${name}` : `${id}:${fallbackPrefix || "unnamed"}`;
}

function summarizeConditions(conditions: PageConditions | undefined, names: { switches: string[]; variables: string[] }): string[] {
  if (!conditions) return [];
  const result: string[] = [];
  if (conditions.switch1Valid) {
    result.push(`switch ${nameAt(names.switches, conditions.switch1Id!, "unnamed-switch")} is ON`);
  }
  if (conditions.switch2Valid) {
    result.push(`switch ${nameAt(names.switches, conditions.switch2Id!, "unnamed-switch")} is ON`);
  }
  if (conditions.variableValid) {
    result.push(`variable ${nameAt(names.variables, conditions.variableId!, "unnamed-variable")} >= ${conditions.variableValue}`);
  }
  if (conditions.selfSwitchValid) {
    result.push(`self switch ${conditions.selfSwitchCh} is ON`);
  }
  if (conditions.itemValid) {
    result.push(`party has item ${conditions.itemId}`);
  }
  if (conditions.actorValid) {
    result.push(`actor ${conditions.actorId} is in party`);
  }
  return result;
}

function conditionSignature(conditions: PageConditions | undefined): ConditionSignature {
  const signature: ConditionSignature = {
    requirementCount: 0,
    switches: []
  };
  if (!conditions) return signature;
  if (conditions.switch1Valid) {
    signature.switches.push(conditions.switch1Id!);
    signature.requirementCount += 1;
  }
  if (conditions.switch2Valid) {
    signature.switches.push(conditions.switch2Id!);
    signature.requirementCount += 1;
  }
  if (conditions.variableValid) {
    signature.variable = {
      id: conditions.variableId!,
      min: conditions.variableValue!
    };
    signature.requirementCount += 1;
  }
  if (conditions.selfSwitchValid) {
    signature.selfSwitch = conditions.selfSwitchCh;
    signature.requirementCount += 1;
  }
  if (conditions.itemValid) {
    signature.itemId = conditions.itemId;
    signature.requirementCount += 1;
  }
  if (conditions.actorValid) {
    signature.actorId = conditions.actorId;
    signature.requirementCount += 1;
  }
  signature.switches = Array.from(new Set(signature.switches)).sort((a, b) => a - b);
  return signature;
}

function pushLimited(list: unknown[], value: unknown, limit: number): void {
  if (value === undefined || value === null || value === "") return;
  if (list.length < limit) list.push(value);
}

function summarizeCommandList(commands: RMMVCommand[], names: { switches: string[]; variables: string[]; commonEvents: string[] }): CommandFacts {
  const facts: CommandFacts = {
    comments: [],
    textPreview: [],
    choices: [],
    switchWrites: [],
    variableWrites: [],
    selfSwitchWrites: [],
    transfers: [],
    commonEvents: [],
    pluginCommands: [],
    scriptCalls: 0,
    movementRoutes: 0,
    waits: [],
    fades: [],
    audio: [],
    pictures: 0,
    battles: 0,
    shops: 0,
    rawCommandCount: Array.isArray(commands) && commands.length ? commands.length : undefined
  };

  for (const command of commands || []) {
    const code: number = command && command.code;
    const p: unknown[] = command && Array.isArray(command.parameters) ? command.parameters : [];

    switch (code) {
      case 101:
        pushLimited(facts.textPreview, textHeader(p), 8);
        break;
      case 401:
        pushLimited(facts.textPreview, String(p[0] || "").trim(), 8);
        break;
      case 102:
        pushLimited(facts.choices, ((p[0] || []) as unknown[]).join(" / "), 8);
        break;
      case 108:
      case 408:
        pushLimited(facts.comments, String(p[0] || "").trim(), 8);
        break;
      case 117:
        facts.commonEvents.push({
          id: p[0] as number,
          name: nameAt(names.commonEvents, p[0] as number, "unnamed-common-event")
        });
        break;
      case 121:
        facts.switchWrites.push({
          from: p[0] as number,
          to: p[1] as number,
          value: p[2] === 0 ? "ON" : "OFF",
          names: rangeNames(names.switches, p[0] as number, p[1] as number, "unnamed-switch")
        });
        break;
      case 122:
        facts.variableWrites.push({
          from: p[0] as number,
          to: p[1] as number,
          operation: variableOperation(p[2] as number),
          operand: variableOperand(p, names),
          names: rangeNames(names.variables, p[0] as number, p[1] as number, "unnamed-variable")
        });
        break;
      case 123:
        facts.selfSwitchWrites.push({
          name: p[0] as string,
          value: p[1] === 0 ? "ON" : "OFF"
        });
        break;
      case 201:
        facts.transfers.push(summarizeTransfer(p));
        break;
      case 205:
        facts.movementRoutes += 1;
        break;
      case 221:
        facts.fades.push("fadeout");
        break;
      case 222:
        facts.fades.push("fadein");
        break;
      case 230:
        facts.waits.push(Number(p[0] || 0));
        break;
      case 231:
      case 232:
      case 233:
      case 234:
      case 235:
        facts.pictures += 1;
        break;
      case 241:
      case 245:
      case 249:
      case 250:
        pushLimited(facts.audio, audioName(p), 8);
        break;
      case 301:
        facts.battles += 1;
        break;
      case 302:
        facts.shops += 1;
        break;
      case 355:
        facts.scriptCalls += 1;
        break;
      case 356:
        pushLimited(facts.pluginCommands, String(p[0] || "").trim(), 12);
        break;
      default:
        break;
    }
  }

  return compactObject(facts) as CommandFacts;
}

function textHeader(parameters: unknown[]): string {
  const face: string = parameters[0] ? `face=${parameters[0]}` : "no-face";
  return `[message ${face}]`;
}

function audioName(parameters: unknown[]): string {
  const audio = parameters[0];
  if (audio && typeof audio === "object") return (audio as { name?: string }).name || "(unnamed audio)";
  return "(audio)";
}

function summarizeTransfer(parameters: unknown[]): TransferSummary {
  const mode: string = parameters[0] === 0 ? "direct" : "variables";
  if (mode === "direct") {
    return {
      mode,
      mapId: parameters[1] as number,
      x: parameters[2] as number,
      y: parameters[3] as number,
      direction: parameters[4] as number,
      fadeType: parameters[5] as number
    };
  }
  return {
    mode,
    mapVariableId: parameters[1] as number,
    xVariableId: parameters[2] as number,
    yVariableId: parameters[3] as number,
    direction: parameters[4] as number,
    fadeType: parameters[5] as number
  };
}

function variableOperation(code: number): string {
  return ["set", "add", "subtract", "multiply", "divide", "mod"][code] || `op-${code}`;
}

function variableOperand(parameters: unknown[], names: { variables: string[] }): VariableOperand {
  const mode: number = parameters[3] as number;
  if (mode === 0) return { kind: "constant", value: parameters[4] };
  if (mode === 1) return { kind: "variable", value: nameAt(names.variables, parameters[4] as number, "unnamed-variable") };
  if (mode === 2) return { kind: "random", min: parameters[4] as number, max: parameters[5] as number };
  if (mode === 3) return { kind: "game-data", value: parameters.slice(4) };
  if (mode === 4) return { kind: "script", value: "script-expression" };
  return { kind: `mode-${mode}`, value: parameters.slice(4) };
}

function rangeNames(list: string[], from: number, to: number, fallbackPrefix: string): (string | null)[] {
  const result: (string | null)[] = [];
  const start: number = Number(from || 0);
  const end: number = Number(to || from || 0);
  for (let id = start; id <= end && result.length < 12; id += 1) {
    result.push(nameAt(list, id, fallbackPrefix));
  }
  if (end - start + 1 > result.length) result.push(`... ${end - start + 1 - result.length} more`);
  return result;
}

interface PageSummary {
  pageNumber?: number;
  conditions?: string[];
  conditionSignature?: ConditionSignature;
  trigger?: string;
  priority?: string;
  hasGraphic?: boolean;
  moveType?: number;
  walkAnime?: boolean;
  stepAnime?: boolean;
  directionFix?: boolean;
  through?: boolean;
  commands?: CommandFacts;
}

export function summarizePage(page: RMMVPage, pageNumber: number, names: { switches: string[]; variables: string[]; commonEvents: string[] }): PageSummary {
  const conditions: string[] = summarizeConditions(page.conditions, names);
  const signature: ConditionSignature = conditionSignature(page.conditions);
  const commands: CommandFacts = summarizeCommandList(page.list || [], names);
  return compactObject({
    pageNumber,
    conditions: conditions.length ? conditions : undefined,
    conditionSignature: signature,
    trigger: TRIGGERS[page.trigger!] || `trigger-${page.trigger}`,
    priority: PRIORITIES[page.priorityType!] || `priority-${page.priorityType}`,
    hasGraphic: page.image && (page.image.characterName || page.image.tileId! > 0) ? true : undefined,
    moveType: page.moveType || undefined,
    walkAnime: page.walkAnime ? true : undefined,
    stepAnime: page.stepAnime ? true : undefined,
    directionFix: page.directionFix ? true : undefined,
    through: page.through ? true : undefined,
    commands
  }) as PageSummary;
}

function compactObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compactObject).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (!value || typeof value !== "object") {
    if (value === false || value === "" || value === null || value === undefined) return undefined;
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const compacted = compactObject(child);
    if (compacted !== undefined) result[key] = compacted;
  }
  return Object.keys(result).length ? result : undefined;
}
