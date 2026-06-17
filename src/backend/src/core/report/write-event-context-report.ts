import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface EventContextMap {
  id: number;
  name?: string;
}

interface EventContextEvent {
  id: number;
  name?: string;
  x: number;
  y: number;
  pageCount: number;
  pages: EventPage[];
}

interface EventPageCondition {
  [key: string]: unknown;
}

interface EventPage {
  pageNumber: number;
  trigger?: string;
  priority?: string;
  conditions?: EventPageCondition[];
  commands?: EventCommandSummary;
}

interface EventCommandSummary {
  rawCommandCount?: number;
  textPreview?: string[];
  comments?: string[];
  switchWrites?: { names: string[]; value: unknown }[];
  variableWrites?: { names: string[]; operation: string }[];
  selfSwitchWrites?: { name: string; value: unknown }[];
  transfers?: { mode: string; mapId?: number; mapVariableId?: number }[];
  pluginCommands?: string[];
  scriptCalls?: number;
  movementRoutes?: number;
  commonEvents?: { name: string }[];
}

interface EventCoordinate {
  tileClass: string;
  inBounds: boolean;
  occupiedBy: EventOccupant[];
}

interface EventOccupant {
  id: number;
  name?: string;
  possibleBlocking: boolean;
}

interface PageOrder {
  rule: string;
  currentHighestPage: number;
  appendedPageNumber: number;
  risk: string;
}

interface EventAnchor {
  id: number;
  x: number;
  y: number;
  tileClass: string;
  description: string;
}

interface EventFinding {
  severity: string;
  code: string;
  message: string;
}

interface EventContext {
  generatedAt: string;
  project: string;
  map: EventContextMap;
  event: EventContextEvent;
  coordinate: EventCoordinate;
  pageOrder: PageOrder;
  anchors: EventAnchor[];
  findings: EventFinding[];
  reviewerChecklist: string[];
}

function writeEventContextOutputs(context: EventContext, outDir: string): { rendered: string } {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "event-context.json"), context);
  const rendered = renderEventContext(context);
  fs.writeFileSync(path.join(outDir, "event-context.md"), rendered, "utf8");
  return { rendered };
}

function renderEventContext(context: EventContext): string {
  const lines = [];
  lines.push("# RPG Maker MV Event Context");
  lines.push("");
  lines.push(`Generated: ${context.generatedAt}`);
  lines.push(`Project: ${context.project}`);
  lines.push(`Map: ${context.map.id}:${context.map.name || "(unnamed)"}`);
  lines.push(`Event: ${context.event.id}:${context.event.name || "(unnamed)"}`);
  lines.push(`Position: (${context.event.x},${context.event.y}) ${context.coordinate.tileClass}`);
  lines.push(`Pages: ${context.event.pageCount}`);
  lines.push("");
  lines.push("## Page Order");
  lines.push("");
  lines.push(`- Rule: ${context.pageOrder.rule}`);
  lines.push(`- Current highest page: ${context.pageOrder.currentHighestPage}`);
  lines.push(`- Appended page number: ${context.pageOrder.appendedPageNumber}`);
  lines.push(`- Risk: ${context.pageOrder.risk}`);
  lines.push("");
  lines.push("## Existing Pages");
  lines.push("");
  if (!context.event.pages.length) {
    lines.push("No pages on this event.");
  } else {
    for (const page of context.event.pages) appendPage(lines, page);
  }
  lines.push("");
  lines.push("## Coordinate");
  lines.push("");
  lines.push(`- In bounds: ${context.coordinate.inBounds ? "yes" : "no"}`);
  lines.push(`- Tile class: ${context.coordinate.tileClass}`);
  if (context.coordinate.occupiedBy.length) {
    for (const occupant of context.coordinate.occupiedBy) {
      lines.push(`- Occupant: ${occupant.id}:${occupant.name || "(unnamed)"} possibleBlocking=${occupant.possibleBlocking ? "yes" : "no"}`);
    }
  }
  lines.push("");
  lines.push("## Related Anchors");
  lines.push("");
  if (!context.anchors.length) {
    lines.push("No related anchors.");
  } else {
    for (const anchor of context.anchors.slice(0, 80)) {
      lines.push(`- ${anchor.id}: (${anchor.x},${anchor.y}) ${anchor.tileClass} - ${anchor.description}`);
    }
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (!context.findings.length) {
    lines.push("No existing event findings.");
  } else {
    for (const finding of context.findings.slice(0, 120)) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`);
    }
  }
  lines.push("");
  lines.push("## Reviewer Checklist");
  lines.push("");
  for (const item of context.reviewerChecklist) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function appendPage(lines: string[], page: EventPage): void {
  lines.push(`### Page ${page.pageNumber}`);
  lines.push("");
  lines.push(`- Trigger: ${page.trigger || "(unknown)"}`);
  lines.push(`- Priority: ${page.priority || "(unknown)"}`);
  if (page.conditions && page.conditions.length) {
    for (const condition of page.conditions) lines.push(`- Condition: ${condition}`);
  } else {
    lines.push("- Conditions: none");
  }
  appendCommandSummary(lines, page.commands || {});
  lines.push("");
}

function appendCommandSummary(lines: string[], commands: EventCommandSummary): void {
  if (commands.rawCommandCount !== undefined) lines.push(`- Raw commands: ${commands.rawCommandCount}`);
  for (const text of commands.textPreview || []) lines.push(`- Text: ${text}`);
  for (const comment of commands.comments || []) lines.push(`- Comment: ${comment}`);
  for (const write of commands.switchWrites || []) lines.push(`- Switch write: ${write.names.join(", ")} = ${write.value}`);
  for (const write of commands.variableWrites || []) lines.push(`- Variable write: ${write.names.join(", ")} ${write.operation}`);
  for (const write of commands.selfSwitchWrites || []) lines.push(`- Self switch: ${write.name} = ${write.value}`);
  for (const transfer of commands.transfers || []) lines.push(`- Transfer: ${transfer.mode} map=${transfer.mapId || transfer.mapVariableId}`);
  for (const command of commands.pluginCommands || []) lines.push(`- Plugin command: ${command}`);
  if (commands.scriptCalls) lines.push(`- Script calls: ${commands.scriptCalls}`);
  if (commands.movementRoutes) lines.push(`- Movement routes: ${commands.movementRoutes}`);
  if (commands.commonEvents) {
    for (const commonEvent of commands.commonEvents) lines.push(`- Common event: ${commonEvent.name}`);
  }
}

export { writeEventContextOutputs };
