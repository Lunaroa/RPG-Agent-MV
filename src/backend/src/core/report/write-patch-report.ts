import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface PatchOperationBase {
  op: string;
  [key: string]: unknown;
}

interface PatchReport {
  mode?: string;
  writesProject?: boolean;
  sourceProject?: string;
  outputProject?: string;
  projectRoot: string;
  dataDir: string;
  operations: PatchOperationBase[];
}

interface PatchImage {
  characterName?: string;
  characterIndex?: number;
  tileId?: number;
}

function writePatchReport(report: PatchReport, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "patch-report.json"), report);
  fs.writeFileSync(path.join(outDir, "patch-report.md"), renderPatchReport(report), "utf8");
}

function renderPatchReport(report: PatchReport): string {
  const lines = [];
  lines.push("# RPG Maker MV Patch Report");
  lines.push("");
  lines.push(`Mode: ${report.mode || "apply"}`);
  lines.push(`Writes project: ${report.writesProject === false ? "no" : "yes"}`);
  lines.push(`Source project: ${report.sourceProject || "(in-place)"}`);
  lines.push(`Output project: ${report.outputProject || report.projectRoot}`);
  lines.push(`Data: ${report.dataDir}`);
  lines.push("");
  lines.push("## Operations");
  lines.push("");
  for (const operation of report.operations) {
    if (operation.op === "add-map") {
      lines.push(`- Added map ${operation.mapId}:${operation.mapName} (${operation.width}x${operation.height}) with tileset ${operation.tilesetId}, ${operation.events} event(s), and ${operation.tileEdits} tile edit(s).`);
    } else if (operation.op === "add-map-event") {
      lines.push(`- Added event ${operation.eventId}:${operation.eventName} to map ${operation.mapId}:${operation.mapName} at (${operation.x},${operation.y}) with ${operation.pages} page(s).`);
    } else if (operation.op === "add-event-page") {
      lines.push(`- Added page ${operation.pageNumber} to event ${operation.eventId}:${operation.eventName} on map ${operation.mapId}:${operation.mapName} at (${operation.x},${operation.y}).`);
    } else if (operation.op === "add-common-event") {
      const switchText = operation.switchId ? ` using trigger switch ${operation.switchId}` : "";
      lines.push(`- Added common event ${operation.commonEventId}:${operation.commonEventName} trigger=${operation.trigger}${switchText} with ${operation.commands} command(s).`);
    } else if (operation.op === "name-switch" || operation.op === "name-variable") {
      const label = operation.op === "name-switch" ? "switch" : "variable";
      const action = operation.renamed ? `Renamed ${label}` : `Named empty ${label}`;
      lines.push(`- ${action} ${operation.id} from ${operation.beforeName || "(empty)"} to ${operation.afterName}.`);
    } else if (operation.op === "set-system-option") {
      lines.push(`- Set System.json ${operation.key} from ${operation.beforeValue} to ${operation.afterValue}.`);
    } else if (operation.op === "set-event-page-image") {
      const before = describeImage(operation.beforeImage as PatchImage | null | undefined);
      const after = describeImage(operation.afterImage as PatchImage | null | undefined);
      lines.push(`- Set event image on map ${operation.mapId}:${operation.mapName} event ${operation.eventId}:${operation.eventName} page ${operation.pageNumber} from ${before} to ${after}.`);
    } else if (operation.op === "set-map-tiles") {
      lines.push(`- Edited ${operation.edits} tile(s) on map ${operation.mapId}:${operation.mapName}; ${operation.changed} changed value(s).`);
    } else {
      lines.push(`- ${operation.op}`);
    }
  }
  lines.push("");
  lines.push("## Required Follow-Up");
  lines.push("");
  lines.push("- Run `scan` on the output project.");
  lines.push("- Run `diff` between the original scan and the output project.");
  lines.push("- Review every breaking or review-level semantic change before accepting the patch.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function describeImage(image: PatchImage | null | undefined): string {
  if (!image) return "(none)";
  if (image.characterName) return `${image.characterName}#${image.characterIndex}`;
  if (image.tileId) return `tile ${image.tileId}`;
  return "(blank)";
}

export { writePatchReport };
