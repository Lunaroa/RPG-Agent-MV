import path from "path";
import { isEmptyCommonEventSlot } from "./common-event-slot.ts";
import { readJson } from "./json.ts";
import { resolveDataDir, scanProject } from "./project-scanner.ts";

interface StateSlotsOptions {
  switches?: number;
  variables?: number;
  commonEvents?: number;
  minSwitchId?: number;
  minVariableId?: number;
  allowAppendStateNames?: boolean;
}

interface UsageEntry {
  conditions: number;
  writes: number;
  calls: number;
  total: number;
}

interface SlotCandidate {
  id: number;
  usage: UsageEntry;
  reason: string;
  staleSwitchId?: number;
}

interface NamedSlotResult {
  totalSlots: number;
  named: number;
  empty: number;
  usedUnnamed: number;
  appendable: number;
  candidateCount: number;
  candidates: SlotCandidate[];
  blockedEmptySlots: SlotCandidate[];
}

interface CommonEventSlotResult {
  totalSlots: number;
  named: number;
  empty: number;
  usedEmpty: number;
  unnamedOccupied: number;
  candidateCount: number;
  candidates: SlotCandidate[];
  blockedEmptySlots: SlotCandidate[];
}

interface SlotFamilySummary {
  totalSlots: number;
  named: number;
  empty: number;
  usedUnnamed: number;
  usedEmpty: number;
  unnamedOccupied: number;
  appendable: number;
  candidateCount: number;
  shownCandidates: number;
  shownBlockedEmptySlots: number;
}

interface ScanIndex {
  maps?: { events?: { pages?: { conditionSignature?: { switches?: number[]; variable?: { id: number } }; commands?: { switchWrites?: { from: number; to: number }[]; variableWrites?: { from: number; to: number }[]; commonEvents?: { id: number }[] } }[] }[] }[];
  commonEvents?: { switchId?: number; commands?: { switchWrites?: { from: number; to: number }[]; variableWrites?: { from: number; to: number }[]; commonEvents?: { id: number }[] } }[];
}

interface StateSlotsResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  requested: {
    switches: number;
    variables: number;
    commonEvents: number;
    minSwitchId: number;
    minVariableId: number;
    allowAppendStateNames: boolean;
  };
  summary: {
    switches: SlotFamilySummary;
    variables: SlotFamilySummary;
    commonEvents: SlotFamilySummary;
  };
  candidates: {
    switches: SlotCandidate[];
    variables: SlotCandidate[];
    commonEvents: SlotCandidate[];
  };
  blockedEmptySlots: {
    switches: SlotCandidate[];
    variables: SlotCandidate[];
    commonEvents: SlotCandidate[];
  };
  reviewNotes: string[];
}

export function analyzeStateSlots(projectRoot: string, options: StateSlotsOptions = {}): StateSlotsResult {
  const root: string = path.resolve(projectRoot);
  const dataDir: string = resolveDataDir(root);
  const system = readJson(path.join(dataDir, "System.json")) as { switches?: string[]; variables?: string[] };
  const commonEvents = readJson(path.join(dataDir, "CommonEvents.json")) as unknown[];
  const index = scanProject(root) as unknown as ScanIndex;
  const usage = buildUsage(index);
  const requested = {
    switches: positiveInteger(options.switches, 10),
    variables: positiveInteger(options.variables, 10),
    commonEvents: positiveInteger(options.commonEvents, 10),
    minSwitchId: positiveInteger(options.minSwitchId, 1),
    minVariableId: positiveInteger(options.minVariableId, 1),
    allowAppendStateNames: Boolean(options.allowAppendStateNames)
  };

  const switches: NamedSlotResult = analyzeNamedSlots(system.switches || [], usage.switches, {
    limit: requested.switches,
    minId: requested.minSwitchId,
    allowAppend: requested.allowAppendStateNames
  });
  const variables: NamedSlotResult = analyzeNamedSlots(system.variables || [], usage.variables, {
    limit: requested.variables,
    minId: requested.minVariableId,
    allowAppend: requested.allowAppendStateNames
  });
  const commonEventSlots: CommonEventSlotResult = analyzeCommonEventSlots(commonEvents || [], usage.commonEvents, requested.commonEvents);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    requested,
    summary: {
      switches: summarizeSlotFamily(switches),
      variables: summarizeSlotFamily(variables),
      commonEvents: summarizeSlotFamily(commonEventSlots)
    },
    candidates: {
      switches: switches.candidates,
      variables: variables.candidates,
      commonEvents: commonEventSlots.candidates
    },
    blockedEmptySlots: {
      switches: switches.blockedEmptySlots,
      variables: variables.blockedEmptySlots,
      commonEvents: commonEventSlots.blockedEmptySlots
    },
    reviewNotes: [
      "Use these IDs as candidates, not as automatic approval.",
      "Named slots are excluded even if no usage was found.",
      "Empty but referenced slots are excluded because runtime state may already depend on them.",
      "Re-run mcp__rmmv__RmmvReadContext action=stateSlots immediately before writing a patch if another agent or human changed the project."
    ]
  };
}

interface AnalyzeNamedSlotsOptions {
  limit: number;
  minId: number;
  allowAppend: boolean;
}

function analyzeNamedSlots(names: string[], usageMap: Map<number, UsageEntry>, options: AnalyzeNamedSlotsOptions): NamedSlotResult {
  const limit: number = options.limit;
  const minId: number = options.minId || 1;
  const candidates: SlotCandidate[] = [];
  const blockedEmptySlots: SlotCandidate[] = [];
  let appendable = 0;
  let named = 0;
  let empty = 0;
  let usedUnnamed = 0;
  for (let id = 1; id < names.length; id += 1) {
    const name: string = names[id] || "";
    const usage: UsageEntry = normalizedUsage(usageMap.get(id));
    if (name) {
      named += 1;
      continue;
    }
    empty += 1;
    if (usage.total > 0) {
      usedUnnamed += 1;
      if (id >= minId) pushLimited(blockedEmptySlots, { id, usage, reason: "empty-name-but-referenced" }, limit);
    } else {
      if (id >= minId) pushLimited(candidates, { id, usage, reason: "empty-name-and-no-indexed-usage" }, limit);
    }
  }
  if (options.allowAppend) {
    let id: number = Math.max(minId, names.length);
    while (candidates.length < limit) {
      candidates.push({
        id,
        usage: normalizedUsage(),
        reason: "outside-current-range-appendable"
      });
      appendable += 1;
      id += 1;
    }
  }
  return {
    totalSlots: Math.max(0, names.length - 1),
    named,
    empty,
    usedUnnamed,
    appendable,
    candidateCount: Math.max(0, candidates.length),
    candidates,
    blockedEmptySlots
  };
}

function analyzeCommonEventSlots(commonEvents: unknown[], usageMap: Map<number, UsageEntry>, limit: number): CommonEventSlotResult {
  const candidates: SlotCandidate[] = [];
  const blockedEmptySlots: SlotCandidate[] = [];
  let named = 0;
  let empty = 0;
  let usedEmpty = 0;
  let unnamedOccupied = 0;
  for (let id = 1; id < commonEvents.length; id += 1) {
    const slot = commonEvents[id] as { name?: string; switchId?: number } | null;
    const usage: UsageEntry = normalizedUsage(usageMap.get(id));
    if (slot && slot.name) {
      named += 1;
      continue;
    }
    if (isEmptyCommonEventSlot(slot, id)) {
      empty += 1;
      const candidate: SlotCandidate = {
        id,
        usage,
        staleSwitchId: slot && slot.switchId ? slot.switchId : undefined,
        reason: "empty-common-event-and-no-indexed-calls"
      };
      if (usage.total > 0) {
        usedEmpty += 1;
        pushLimited(blockedEmptySlots, { ...candidate, reason: "empty-common-event-but-referenced" }, limit);
      } else {
        pushLimited(candidates, candidate, limit);
      }
      continue;
    }
    unnamedOccupied += 1;
  }
  return {
    totalSlots: Math.max(0, commonEvents.length - 1),
    named,
    empty,
    usedEmpty,
    unnamedOccupied,
    candidateCount: empty - usedEmpty,
    candidates,
    blockedEmptySlots
  };
}

interface UsageMap {
  switches: Map<number, UsageEntry>;
  variables: Map<number, UsageEntry>;
  commonEvents: Map<number, UsageEntry>;
}

function buildUsage(index: ScanIndex): UsageMap {
  const usage: UsageMap = {
    switches: new Map(),
    variables: new Map(),
    commonEvents: new Map()
  };
  for (const map of index.maps || []) {
    for (const event of map.events || []) {
      for (const page of event.pages || []) collectPageUsage(page, usage);
    }
  }
  for (const event of index.commonEvents || []) {
    if (event.switchId) incrementUsage(usage.switches, event.switchId, "conditions");
    collectCommandUsage(event.commands || {} as { switchWrites?: { from: number; to: number }[]; variableWrites?: { from: number; to: number }[]; commonEvents?: { id: number }[] }, usage);
  }
  return usage;
}

interface PageData {
  conditionSignature?: { switches?: number[]; variable?: { id: number } };
  commands?: { switchWrites?: { from: number; to: number }[]; variableWrites?: { from: number; to: number }[]; commonEvents?: { id: number }[] };
}

function collectPageUsage(page: PageData, usage: UsageMap): void {
  const signature = page.conditionSignature || {};
  for (const id of signature.switches || []) incrementUsage(usage.switches, id, "conditions");
  if (signature.variable) incrementUsage(usage.variables, signature.variable.id, "conditions");
  collectCommandUsage(page.commands || {} as { switchWrites?: { from: number; to: number }[]; variableWrites?: { from: number; to: number }[]; commonEvents?: { id: number }[] }, usage);
}

interface CommandData {
  switchWrites?: { from: number; to: number }[];
  variableWrites?: { from: number; to: number }[];
  commonEvents?: { id: number }[];
}

function collectCommandUsage(commands: CommandData, usage: UsageMap): void {
  for (const item of commands.switchWrites || []) {
    for (let id = item.from; id <= item.to; id += 1) incrementUsage(usage.switches, id, "writes");
  }
  for (const item of commands.variableWrites || []) {
    for (let id = item.from; id <= item.to; id += 1) incrementUsage(usage.variables, id, "writes");
  }
  for (const item of commands.commonEvents || []) incrementUsage(usage.commonEvents, item.id, "calls");
}

function incrementUsage(map: Map<number, UsageEntry>, id: number, key: keyof UsageEntry): void {
  if (!Number.isInteger(id) || id <= 0) return;
  const entry: UsageEntry = map.get(id) || { conditions: 0, writes: 0, calls: 0, total: 0 };
  entry[key] = (entry[key] || 0) + 1;
  entry.total += 1;
  map.set(id, entry);
}

function normalizedUsage(usage?: UsageEntry): UsageEntry {
  return usage || { conditions: 0, writes: 0, calls: 0, total: 0 };
}

function summarizeSlotFamily(result: NamedSlotResult | CommonEventSlotResult): SlotFamilySummary {
  return {
    totalSlots: result.totalSlots,
    named: result.named,
    empty: result.empty,
    usedUnnamed: (result as NamedSlotResult).usedUnnamed || 0,
    usedEmpty: (result as CommonEventSlotResult).usedEmpty || 0,
    unnamedOccupied: (result as CommonEventSlotResult).unnamedOccupied || 0,
    appendable: (result as NamedSlotResult).appendable || 0,
    candidateCount: result.candidateCount,
    shownCandidates: result.candidates.length,
    shownBlockedEmptySlots: result.blockedEmptySlots.length
  };
}

function pushLimited(list: unknown[], value: unknown, limit: number): void {
  if (list.length < limit) list.push(value);
}

function positiveInteger(value: number | undefined | null, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const number: number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
