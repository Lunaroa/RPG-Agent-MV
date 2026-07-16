import fs from "fs";
import path from "path";
import { exists, readJson } from "./json.ts";
import { resolveRmmvLayout } from "./rmmv-layout.ts";

interface PluginOccurrence {
  source: string;
  mapId?: number;
  mapName?: string;
  eventId?: number;
  eventName?: string;
  pageNumber?: number;
  commonEventId?: number;
  commonEventName?: string;
  raw: string;
  commandName: string;
  args: string[];
  shape: string;
}

interface PluginGroup {
  commandName: string;
  count: number;
  shapes: { shape: string; count: number }[];
  examples: { location: string; raw: string }[];
}

interface InstalledPlugin {
  name: string;
  status: boolean;
  description: string;
  parameterCount: number;
  parseError?: string;
}

interface PluginInventoryResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  installedPlugins: InstalledPlugin[];
  pluginFiles: string[];
  summary: {
    occurrences: number;
    commandGroups: number;
    installedPlugins: number;
    pluginFiles: number;
  };
  groups: PluginGroup[];
  occurrences: PluginOccurrence[];
}

export function buildPluginInventory(projectRoot: string): PluginInventoryResult {
  const root: string = path.resolve(projectRoot);
  const layout = resolveRmmvLayout(root);
  const dataDir: string = layout.dataDir;
  const mapInfos = readJson(path.join(dataDir, "MapInfos.json")) as unknown[];
  const commonEvents: unknown[] = exists(path.join(dataDir, "CommonEvents.json"))
    ? readJson(path.join(dataDir, "CommonEvents.json")) as unknown[]
    : [];
  const installedPlugins: InstalledPlugin[] = readInstalledPlugins(layout.resourceRoot);
  const pluginFiles: string[] = listPluginFiles(layout.resourceRoot);
  const occurrences: PluginOccurrence[] = [
    ...collectMapPluginCommands(dataDir, mapInfos),
    ...collectCommonEventPluginCommands(commonEvents)
  ];
  const groups: PluginGroup[] = groupOccurrences(occurrences);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    installedPlugins,
    pluginFiles,
    summary: {
      occurrences: occurrences.length,
      commandGroups: groups.length,
      installedPlugins: installedPlugins.length,
      pluginFiles: pluginFiles.length
    },
    groups,
    occurrences
  };
}

interface MapInfoEntry {
  id: number;
  name?: string;
}

interface RMMVMapEvent {
  id: number;
  name?: string;
  pages?: { list?: RMMVCommand[] }[];
}

interface RMMVCommand {
  code: number;
  parameters?: unknown[];
}

interface RMMVMap {
  events: RMMVMapEvent[];
}

function collectMapPluginCommands(dataDir: string, mapInfos: unknown[]): PluginOccurrence[] {
  const result: PluginOccurrence[] = [];
  for (const info of (mapInfos || []) as MapInfoEntry[]) {
    if (!info) continue;
    const mapFile: string = path.join(dataDir, `Map${String(info.id).padStart(3, "0")}.json`);
    if (!exists(mapFile)) continue;
    const map = readJson(mapFile) as RMMVMap;
    for (const event of map.events || []) {
      if (!event) continue;
      (event.pages || []).forEach((page, pageIndex) => {
        collectCommandsFromList(page.list || [], {
          source: "map",
          mapId: info.id,
          mapName: info.name || "",
          eventId: event.id,
          eventName: event.name || "",
          pageNumber: pageIndex + 1
        }, result);
      });
    }
  }
  return result;
}

interface RMMVCommonEvent {
  id: number;
  name?: string;
  list?: RMMVCommand[];
}

function collectCommonEventPluginCommands(commonEvents: unknown[]): PluginOccurrence[] {
  const result: PluginOccurrence[] = [];
  for (const event of (commonEvents || []) as RMMVCommonEvent[]) {
    if (!event) continue;
    collectCommandsFromList(event.list || [], {
      source: "common-event",
      commonEventId: event.id,
      commonEventName: event.name || ""
    }, result);
  }
  return result;
}

interface LocationBase {
  source: string;
  mapId?: number;
  mapName?: string;
  eventId?: number;
  eventName?: string;
  pageNumber?: number;
  commonEventId?: number;
  commonEventName?: string;
}

function collectCommandsFromList(commands: RMMVCommand[], location: LocationBase, result: PluginOccurrence[]): void {
  for (const command of commands || []) {
    if (!command || (command.code !== 356 && command.code !== 357)) continue;
    const parameters = command.parameters || [];
    const raw = command.code === 357
      ? structuredMZPluginCommand(parameters)
      : String(parameters[0] || "").trim();
    if (!raw) continue;
    const parsed = command.code === 357 ? parseMZPluginCommand(parameters) : parsePluginCommand(raw);
    result.push({
      ...location,
      raw,
      commandName: parsed.commandName,
      args: parsed.args,
      shape: parsed.shape
    });
  }
}

function structuredMZPluginCommand(parameters: unknown[]): string {
  const plugin = String(parameters[0] || "");
  const command = String(parameters[1] || "");
  const args = isRecord(parameters[3]) ? parameters[3] : {};
  return `${plugin}:${command}${Object.keys(args).length ? ` ${JSON.stringify(args)}` : ""}`.trim();
}

function parseMZPluginCommand(parameters: unknown[]): { commandName: string; args: string[]; shape: string } {
  const plugin = String(parameters[0] || "");
  const command = String(parameters[1] || "");
  const args = isRecord(parameters[3])
    ? Object.entries(parameters[3]).map(([key, value]) => `${key}=${String(value)}`)
    : [];
  return {
    commandName: `${plugin}:${command}`,
    args,
    shape: args.map((entry) => entry.replace(/=.*/, "=<value>")).join(" "),
  };
}

export function parsePluginCommand(raw: string): { commandName: string; args: string[]; shape: string } {
  const tokens: string[] = raw.split(/\s+/).filter(Boolean);
  const commandName: string = tokens[0] || "(empty)";
  const args: string[] = tokens.slice(1);
  return {
    commandName,
    args,
    shape: args.map(normalizeToken).join(" ")
  };
}

function normalizeToken(token: string): string {
  if (/^-?\d+(\.\d+)?$/.test(token)) return "<number>";
  if (/^-?\d+,-?\d+$/.test(token)) return "<point>";
  if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(token)) return token.replace(/:.+$/, ":<value>");
  if (/^\\[A-Za-z]+\[/.test(token)) return "<escape-text>";
  if (token.length > 24) return "<text>";
  return token;
}

function groupOccurrences(occurrences: PluginOccurrence[]): PluginGroup[] {
  const byName = new Map<string, { commandName: string; count: number; shapes: Map<string, number>; examples: { location: string; raw: string }[] }>();
  for (const occurrence of occurrences) {
    const group = byName.get(occurrence.commandName) || {
      commandName: occurrence.commandName,
      count: 0,
      shapes: new Map<string, number>(),
      examples: [] as { location: string; raw: string }[]
    };
    group.count += 1;
    group.shapes.set(occurrence.shape, (group.shapes.get(occurrence.shape) || 0) + 1);
    if (group.examples.length < 8) group.examples.push(terseOccurrence(occurrence));
    byName.set(occurrence.commandName, group);
  }

  return Array.from(byName.values())
    .map((group) => ({
      commandName: group.commandName,
      count: group.count,
      shapes: Array.from(group.shapes.entries())
        .map(([shape, count]) => ({ shape, count }))
        .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape)),
      examples: group.examples
    }))
    .sort((a, b) => b.count - a.count || a.commandName.localeCompare(b.commandName));
}

function terseOccurrence(occurrence: PluginOccurrence): { location: string; raw: string } {
  if (occurrence.source === "map") {
    return {
      location: `map ${occurrence.mapId}:${occurrence.mapName} event ${occurrence.eventId}:${occurrence.eventName || "(unnamed)"} page ${occurrence.pageNumber}`,
      raw: occurrence.raw
    };
  }
  return {
    location: `common event ${occurrence.commonEventId}:${occurrence.commonEventName || "(unnamed)"}`,
    raw: occurrence.raw
  };
}

function readInstalledPlugins(resourceRoot: string): InstalledPlugin[] {
  const filePath: string = path.join(resourceRoot, "js", "plugins.js");
  if (!exists(filePath)) return [];
  const raw: string = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const start: number = raw.indexOf("[");
  const end: number = raw.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return [{ name: "", status: false, description: "", parameterCount: 0, parseError: "Cannot locate $plugins array in plugins.js" }];
  }
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as { name?: string; status?: boolean; description?: string; parameters?: Record<string, unknown> }[];
    return data
      .filter(Boolean)
      .map((entry) => ({
        name: entry.name || "",
        status: Boolean(entry.status),
        description: entry.description || "",
        parameterCount: entry.parameters ? Object.keys(entry.parameters).length : 0
      }));
  } catch (error) {
    return [{ name: "", status: false, description: "", parameterCount: 0, parseError: (error as Error).message }];
  }
}

function listPluginFiles(resourceRoot: string): string[] {
  const dir: string = path.join(resourceRoot, "js", "plugins");
  if (!exists(dir)) return [];
  return listFilesRecursively(dir)
    .filter((name) => name.toLowerCase().endsWith(".js"))
    .sort();
}

function listFilesRecursively(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  visit(root, "");
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
