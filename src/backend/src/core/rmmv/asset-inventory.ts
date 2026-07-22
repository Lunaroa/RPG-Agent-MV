import fs from "fs";
import path from "path";
import { exists, readJson } from "./json.ts";
import { resolveDataDir } from "./project-scanner.ts";

const AUDIO_DIRS: string[] = ["bgm", "bgs", "me", "se"];
const IMAGE_DIRS: string[] = ["animations", "battlebacks1", "battlebacks2", "characters", "enemies", "faces", "parallaxes", "pictures", "sv_actors", "sv_enemies", "system", "tilesets", "titles1", "titles2"];
const AUDIO_EXTENSIONS: Set<string> = new Set([".ogg", ".m4a", ".rpgmvo", ".rpgmvm"]);
const IMAGE_EXTENSIONS: Set<string> = new Set([".png", ".jpg", ".jpeg", ".webp", ".rpgmvp"]);

interface AssetBucket {
  dir: string;
  exists: boolean;
  count: number;
  names: string[];
  files: string[];
}

interface AnimationEntry {
  id: number;
  name: string;
  kind: "particle" | "mv-compatible";
  effectName: string;
  animation1Name: string;
  animation2Name: string;
  missingSheets: string[];
  missingEffects: string[];
}

interface AssetInventoryResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  audioRoot: string;
  imageRoot: string;
  summary: {
    audio: Record<string, { exists: boolean; count: number }>;
    images: Record<string, { exists: boolean; count: number }>;
    effects: { exists: boolean; count: number };
    animations: { total: number; named: number; withMissingSheets: number; withMissingEffects: number };
  };
  audio: Record<string, AssetBucket>;
  images: Record<string, AssetBucket>;
  effects: AssetBucket;
  animations: AnimationEntry[];
}

export interface AssetInventoryOptions {
  tolerateAnimationReadFailure?: boolean;
}

export function buildAssetInventory(projectRoot: string, options: AssetInventoryOptions = {}): AssetInventoryResult {
  const root: string = path.resolve(projectRoot);
  const dataDir: string = resolveDataDir(root);
  const wwwRoot: string = path.dirname(dataDir);
  const audioRoot: string = path.join(wwwRoot, "audio");
  const imageRoot: string = path.join(wwwRoot, "img");
  const effectRoot: string = path.join(wwwRoot, "effects");
  const animations: AnimationEntry[] = readAnimations(dataDir, options.tolerateAnimationReadFailure === true);
  const audio: Record<string, AssetBucket> = {} as Record<string, AssetBucket>;
  const images: Record<string, AssetBucket> = {} as Record<string, AssetBucket>;
  for (const folder of AUDIO_DIRS) audio[folder] = listAssets(path.join(audioRoot, folder), AUDIO_EXTENSIONS);
  for (const folder of IMAGE_DIRS) images[folder] = listAssets(path.join(imageRoot, folder), IMAGE_EXTENSIONS);
  const effects = listAssets(effectRoot, new Set([".efkefc"]));
  const animationsWithSheetStatus: AnimationEntry[] = animations.map((animation) => ({
    ...animation,
    missingSheets: [animation.animation1Name, animation.animation2Name]
      .filter(Boolean)
      .filter((name) => !hasNamedAsset(images.animations, name)),
    missingEffects: animation.effectName && !hasNamedAsset(effects, animation.effectName)
      ? [animation.effectName]
      : [],
  }));

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    audioRoot,
    imageRoot,
    summary: {
      audio: summarizeBuckets(audio),
      images: summarizeBuckets(images),
      effects: { exists: effects.exists, count: effects.count },
      animations: {
        total: animationsWithSheetStatus.length,
        named: animationsWithSheetStatus.filter((animation) => animation.name).length,
        withMissingSheets: animationsWithSheetStatus.filter((animation) => animation.missingSheets.length).length,
        withMissingEffects: animationsWithSheetStatus.filter((animation) => animation.missingEffects.length).length,
      }
    },
    audio,
    images,
    effects,
    animations: animationsWithSheetStatus
  };
}

interface RMMVAnimation {
  id: number;
  name?: string;
  animation1Name?: string;
  animation2Name?: string;
  effectName?: string;
}

function readAnimations(dataDir: string, tolerateReadFailure: boolean): AnimationEntry[] {
  const filePath: string = path.join(dataDir, "Animations.json");
  if (!exists(filePath)) return [];
  let records: RMMVAnimation[];
  try {
    const value = readJson(filePath);
    if (!Array.isArray(value)) throw new Error("Animations.json must contain an array.");
    records = value as RMMVAnimation[];
  } catch (error) {
    if (!tolerateReadFailure) throw error;
    return [];
  }
  return records
    .filter(Boolean)
    .map((animation) => ({
      id: animation.id,
      name: animation.name || "",
      kind: animation.effectName ? "particle" : "mv-compatible",
      effectName: animation.effectName || "",
      animation1Name: animation.animation1Name || "",
      animation2Name: animation.animation2Name || "",
      missingSheets: [],
      missingEffects: []
    }));
}

function listAssets(dir: string, extensions: Set<string>): AssetBucket {
  if (!fs.existsSync(dir)) return { dir, exists: false, count: 0, names: [], files: [] };
  const files: string[] = listFilesRecursively(dir)
    .filter((name) => extensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const names: string[] = Array.from(new Set(files.map((file) => file.slice(0, -path.extname(file).length)))).sort((a, b) => a.localeCompare(b));
  return { dir, exists: true, count: names.length, names, files };
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

function summarizeBuckets(buckets: Record<string, AssetBucket>): Record<string, { exists: boolean; count: number }> {
  return Object.fromEntries(Object.entries(buckets).map(([name, bucket]) => [name, {
    exists: bucket.exists,
    count: bucket.count
  }]));
}

export function hasAudio(inventory: AssetInventoryResult, folder: string, name: string): boolean {
  return hasNamedAsset(inventory.audio && inventory.audio[folder], name);
}

export function hasImage(inventory: AssetInventoryResult, folder: string, name: string): boolean {
  return hasNamedAsset(inventory.images && inventory.images[folder], name);
}

export function findAnimation(inventory: AssetInventoryResult, id: number): AnimationEntry | null {
  return (inventory.animations || []).find((animation) => animation.id === id) || null;
}

function hasNamedAsset(bucket: AssetBucket | undefined | null, name: string): boolean {
  if (!name) return true;
  return Boolean(bucket && bucket.exists && bucket.names.includes(name));
}
