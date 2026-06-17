import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface PluginSummary {
  occurrences: number;
  commandGroups: number;
  installedPlugins: number;
  pluginFiles: number;
}

interface InstalledPlugin {
  parseError?: string;
  status?: boolean;
  name?: string;
  parameterCount?: number;
}

interface CommandShape {
  count: number;
  shape?: string;
}

interface CommandExample {
  location: string;
  raw: string;
}

interface CommandGroup {
  commandName: string;
  count: number;
  shapes: CommandShape[];
  examples: CommandExample[];
}

interface PluginInventory {
  generatedAt: string;
  projectRoot: string;
  summary: PluginSummary;
  installedPlugins: InstalledPlugin[];
  groups: CommandGroup[];
}

function writePluginInventoryOutputs(inventory: PluginInventory, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "plugin-inventory.json"), inventory);
  fs.writeFileSync(path.join(outDir, "plugin-inventory.md"), renderPluginInventoryReport(inventory), "utf8");
}

function renderPluginInventoryReport(inventory: PluginInventory): string {
  const lines = [];
  lines.push("# RPG Maker MV Plugin Command Inventory");
  lines.push("");
  lines.push(`Generated: ${inventory.generatedAt}`);
  lines.push(`Project: ${inventory.projectRoot}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Plugin command occurrences: ${inventory.summary.occurrences}`);
  lines.push(`- Command groups: ${inventory.summary.commandGroups}`);
  lines.push(`- Installed plugin entries: ${inventory.summary.installedPlugins}`);
  lines.push(`- Plugin JS files: ${inventory.summary.pluginFiles}`);
  lines.push("");
  lines.push("## Installed Plugins");
  lines.push("");
  if (!inventory.installedPlugins.length) {
    lines.push("No `www/js/plugins.js` entries found.");
  } else {
    for (const plugin of inventory.installedPlugins.slice(0, 120)) {
      if (plugin.parseError) lines.push(`- [parse-error] ${plugin.parseError}`);
      else lines.push(`- ${plugin.status ? "ON" : "OFF"} ${plugin.name || "(unnamed)"} parameters=${plugin.parameterCount}`);
    }
    if (inventory.installedPlugins.length > 120) {
      lines.push(`- ... ${inventory.installedPlugins.length - 120} more plugin entries omitted. See plugin-inventory.json.`);
    }
  }
  lines.push("");
  lines.push("## Command Groups");
  lines.push("");
  if (!inventory.groups.length) {
    lines.push("No plugin commands found in event command lists.");
  } else {
    for (const group of inventory.groups.slice(0, 120)) {
      lines.push(`### ${group.commandName}`);
      lines.push("");
      lines.push(`Count: ${group.count}`);
      lines.push("");
      lines.push("Shapes:");
      for (const shape of group.shapes.slice(0, 8)) {
        lines.push(`- ${shape.count}x ${shape.shape || "(no args)"}`);
      }
      lines.push("");
      lines.push("Examples:");
      for (const example of group.examples.slice(0, 5)) {
        lines.push(`- ${example.location}: \`${example.raw.replace(/`/g, "\\`")}\``);
      }
      lines.push("");
    }
    if (inventory.groups.length > 120) {
      lines.push(`... ${inventory.groups.length - 120} more command groups omitted. See plugin-inventory.json.`);
    }
  }
  lines.push("## Review Guidance");
  lines.push("");
  lines.push("- Prefer existing command shapes over inventing new plugin command syntax.");
  lines.push("- Treat commands with no matching examples as project-specific manual-review risks.");
  lines.push("- Inspect the owning plugin before changing command order, arguments, or timing.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export { writePluginInventoryOutputs };
