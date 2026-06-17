import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface AssetFolderSummary {
  exists: boolean;
  count?: number;
}

interface AnimationSummary {
  total: number;
  named: number;
  withMissingSheets: number;
}

interface AssetSummary {
  audio: Record<string, AssetFolderSummary>;
  images: Record<string, AssetFolderSummary>;
  animations: AnimationSummary;
}

interface AssetBucket {
  exists: boolean;
  dir: string;
  names: string[];
}

interface AnimationEntry {
  id: number;
  name?: string;
  animation1Name?: string;
  animation2Name?: string;
  missingSheets?: string[];
}

interface AssetInventory {
  generatedAt: string;
  projectRoot: string;
  summary: AssetSummary;
  audio: Record<string, AssetBucket>;
  images: Record<string, AssetBucket>;
  animations: AnimationEntry[];
}

function writeAssetInventoryOutputs(inventory: AssetInventory, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "asset-inventory.json"), inventory);
  fs.writeFileSync(path.join(outDir, "asset-inventory.md"), renderAssetInventory(inventory), "utf8");
}

function renderAssetInventory(inventory: AssetInventory): string {
  const lines = [];
  lines.push("# RPG Maker MV Asset Inventory");
  lines.push("");
  lines.push(`Generated: ${inventory.generatedAt}`);
  lines.push(`Project: ${inventory.projectRoot}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [folder, summary] of Object.entries(inventory.summary.audio)) {
    lines.push(`- audio/${folder}: ${summary.exists ? summary.count : "missing folder"}`);
  }
  for (const [folder, summary] of Object.entries(inventory.summary.images)) {
    lines.push(`- img/${folder}: ${summary.exists ? summary.count : "missing folder"}`);
  }
  lines.push(`- Animations: ${inventory.summary.animations.total} total, ${inventory.summary.animations.named} named, ${inventory.summary.animations.withMissingSheets} with missing sheets`);
  lines.push("");
  lines.push("## Audio");
  lines.push("");
  for (const [folder, bucket] of Object.entries(inventory.audio)) {
    lines.push(`### audio/${folder}`);
    lines.push("");
    appendBucket(lines, bucket, "audio asset");
  }
  lines.push("## Images");
  lines.push("");
  for (const [folder, bucket] of Object.entries(inventory.images)) {
    lines.push(`### img/${folder}`);
    lines.push("");
    appendBucket(lines, bucket, "image asset");
  }
  lines.push("## Animations");
  lines.push("");
  if (!inventory.animations.length) {
    lines.push("No Animations.json entries found.");
  } else {
    for (const animation of inventory.animations.slice(0, 120)) {
      const sheets = [animation.animation1Name, animation.animation2Name].filter(Boolean).join(", ") || "no sheets";
      const missing = animation.missingSheets && animation.missingSheets.length ? ` missing=${animation.missingSheets.join(", ")}` : "";
      lines.push(`- ${animation.id}: ${animation.name || "(unnamed)"} (${sheets})${missing}`);
    }
    if (inventory.animations.length > 120) lines.push(`- ... ${inventory.animations.length - 120} more animations omitted. See asset-inventory.json.`);
  }
  lines.push("");
  lines.push("## Review Guidance");
  lines.push("");
  lines.push("- Use asset names exactly as shown here, without file extensions, in RPG Maker MV commands.");
  lines.push("- `play-se` must reference an asset under `audio/se`.");
  lines.push("- Text face names must reference `img/faces`; event character images must reference `img/characters`.");
  lines.push("- Animation commands should use a valid Animations.json ID, and its sheets should exist under `img/animations`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function appendBucket(lines: string[], bucket: AssetBucket, label: string): void {
  if (!bucket.exists) {
    lines.push(`Missing folder: ${bucket.dir}`);
    lines.push("");
    return;
  }
  if (!bucket.names.length) {
    lines.push(`No ${label}s found.`);
    lines.push("");
    return;
  }
  for (const name of bucket.names.slice(0, 80)) lines.push(`- ${name}`);
  if (bucket.names.length > 80) lines.push(`- ... ${bucket.names.length - 80} more ${label}s omitted. See asset-inventory.json.`);
  lines.push("");
}

export { writeAssetInventoryOutputs };
