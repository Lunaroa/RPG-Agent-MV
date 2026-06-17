import fs from "fs";
import path from "path";

export function readJson(filePath: string): unknown {
  const raw: string = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: string = `${JSON.stringify(data, null, 2)}\n`;
  const tmpPath: string = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, payload, "utf8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameError) {
      fs.copyFileSync(tmpPath, filePath);
      try { fs.unlinkSync(tmpPath); } catch (e) { console.warn('[json] Failed to delete temp file:', tmpPath, e); }
    }
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch (e) { console.warn('[json] Failed to delete temp file:', tmpPath, e); }
    throw error;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const aArr: boolean = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (!deepEqual(arrA[i], arrB[i])) return false;
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA: string[] = Object.keys(objA);
  const keysB: string[] = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!deepEqual(objA[key], objB[key])) return false;
  }
  return true;
}

function detectMapJsonStyle(text: string): "pretty" | "compact" {
  return /^\{\s*\n\s{2}"/.test(text) ? "pretty" : "compact";
}

interface MapJsonData {
  data?: unknown;
  [key: string]: unknown;
}

function serializeMapJson(data: MapJsonData, style: "pretty" | "compact"): string {
  if (style === "pretty") {
    const marker = "__RMMV_COMPACT_MAP_DATA__";
    const payload = { ...data, data: marker };
    return JSON.stringify(payload, null, 2).replace(`"${marker}"`, JSON.stringify(data.data || []));
  }
  return JSON.stringify(data);
}

export function writeMapJson(filePath: string, data: MapJsonData): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existingText: string | null = null;
  let style: "pretty" | "compact" = "compact";
  if (fs.existsSync(filePath)) {
    existingText = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    style = detectMapJsonStyle(existingText);
    try {
      if (deepEqual(JSON.parse(existingText), data)) {
        return;
      }
    } catch (e) {
      // existing file is malformed; fall through and overwrite
      console.warn('[json] Existing map JSON is malformed, will overwrite:', filePath, e);
    }
  }
  const text: string = serializeMapJson(data, style);
  const finalText: string = `${text}\n`;
  if (existingText === finalText) return;
  fs.writeFileSync(filePath, finalText, "utf8");
}

export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export const _internal = { deepEqual, detectMapJsonStyle, serializeMapJson };
