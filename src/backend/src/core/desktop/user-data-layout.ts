import fs from "node:fs";
import path from "node:path";

import type { ProductLanguage } from "../../../../contract/i18n.ts";
import { getDatabase } from "../db/pool.ts";
import { backendText } from "../i18n/messages.ts";
import { PATHS } from "../workspace-paths.ts";
import { ensureOpencodeRuntimeAssets } from "../workflow/agent/opencode/runtime-assets.ts";

export const USER_DATA_LAYOUT_VERSION = 1;
export const USER_DATA_LAYOUT_MARKER = path.join("data", ".user-data-layout-v1.json");

export interface EnsureUserDataLayoutResult {
  installRoot: string;
  userDataRoot: string;
  migrated: string[];
  skipped: boolean;
}

interface UserDataLayoutMarker {
  version: number;
  migratedFromInstallRoot?: string;
  migratedAt: string;
  migratedPaths: string[];
}

function sameRoot(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function markerPath(userDataRoot: string): string {
  return path.join(path.resolve(userDataRoot), USER_DATA_LAYOUT_MARKER);
}

function readMarker(userDataRoot: string): UserDataLayoutMarker | null {
  const file = markerPath(userDataRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as UserDataLayoutMarker;
  } catch {
    return null;
  }
}

function writeMarker(userDataRoot: string, marker: UserDataLayoutMarker): void {
  const file = markerPath(userDataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

function pathExists(target: string): boolean {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function hasUserDatabase(root: string): boolean {
  return pathExists(path.join(root, PATHS.dataDb));
}

function hasLegacyRuntimeData(runtimeDir: string): boolean {
  if (!pathExists(runtimeDir)) return false;
  const markers = [
    "sessions",
    "project-registry.json",
    "agent-console-staging",
    "secrets",
    "console-settings.json",
    "rmmv.db",
  ];
  return markers.some((name) => pathExists(path.join(runtimeDir, name)));
}

function hasLegacyOpencodeData(opencodeDir: string): boolean {
  if (!pathExists(opencodeDir)) return false;
  const memoryDir = path.join(opencodeDir, "memory");
  if (pathExists(memoryDir) && fs.readdirSync(memoryDir).length > 0) return true;
  const skillsDir = path.join(opencodeDir, "skills");
  if (pathExists(skillsDir) && fs.readdirSync(skillsDir).length > 0) return true;
  const opencodeDb = path.join(opencodeDir, "runtime", "opencode.db");
  if (pathExists(opencodeDb) && fs.statSync(opencodeDb).size > 0) return true;
  const agentsMd = path.join(opencodeDir, "AGENTS.md");
  if (pathExists(agentsMd)) return true;
  return false;
}

function hasLegacyProjectsDir(projectsDir: string): boolean {
  if (!pathExists(projectsDir)) return false;
  return fs.readdirSync(projectsDir).some((entry) => entry !== "README.md");
}

function installHasLegacyUserData(installRoot: string): boolean {
  const root = path.resolve(installRoot);
  if (hasUserDatabase(root)) return true;
  if (hasLegacyRuntimeData(path.join(root, PATHS.runtimeRoot))) return true;
  if (hasLegacyOpencodeData(path.join(root, PATHS.OpencodeConfigDir))) return true;
  if (hasLegacyProjectsDir(path.join(root, "projects"))) return true;
  return false;
}

function movePath(source: string, dest: string, productLanguage?: ProductLanguage | null): void {
  if (!pathExists(source)) return;
  if (pathExists(dest)) {
    throw new Error(backendText("userData.migration.targetConflict", productLanguage, {
      destination: dest,
    }));
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(source, dest);
}

function moveTreeRelative(
  installRoot: string,
  userDataRoot: string,
  relativePath: string,
  migrated: string[],
  productLanguage?: ProductLanguage | null,
): void {
  const source = path.join(installRoot, relativePath);
  if (!pathExists(source)) return;
  const dest = path.join(userDataRoot, relativePath);
  if (pathExists(dest)) return;
  movePath(source, dest, productLanguage);
  migrated.push(relativePath.replace(/\\/g, "/"));
}

function moveDatabaseSidecars(
  installRoot: string,
  userDataRoot: string,
  migrated: string[],
  productLanguage?: ProductLanguage | null,
): void {
  const dbRel = PATHS.dataDb;
  const dbName = path.basename(dbRel);
  const dbDir = path.dirname(dbRel);
  for (const suffix of ["-wal", "-shm"]) {
    const rel = path.join(dbDir, `${dbName}${suffix}`);
    moveTreeRelative(installRoot, userDataRoot, rel, migrated, productLanguage);
  }
}

function migrateInstallUserData(
  installRoot: string,
  userDataRoot: string,
  productLanguage?: ProductLanguage | null,
): string[] {
  const migrated: string[] = [];
  const installDb = path.join(installRoot, PATHS.dataDb);
  const userDb = path.join(userDataRoot, PATHS.dataDb);
  if (pathExists(installDb) && pathExists(userDb)) {
    throw new Error(backendText("userData.migration.databaseConflict", productLanguage, {
      installDatabase: installDb,
      userDatabase: userDb,
    }));
  }

  if (pathExists(installDb) && !pathExists(userDb)) {
    moveTreeRelative(installRoot, userDataRoot, PATHS.dataDb, migrated, productLanguage);
    moveDatabaseSidecars(installRoot, userDataRoot, migrated, productLanguage);
  }

  const runtimeRel = PATHS.runtimeRoot;
  const installRuntime = path.join(installRoot, runtimeRel);
  const userRuntime = path.join(userDataRoot, runtimeRel);
  if (pathExists(installRuntime) && hasLegacyRuntimeData(installRuntime)) {
    if (!pathExists(userRuntime)) {
      moveTreeRelative(installRoot, userDataRoot, runtimeRel, migrated, productLanguage);
    }
  }

  const opencodeRel = PATHS.OpencodeConfigDir;
  const installOpencode = path.join(installRoot, opencodeRel);
  const userOpencode = path.join(userDataRoot, opencodeRel);
  if (pathExists(installOpencode) && hasLegacyOpencodeData(installOpencode)) {
    if (!pathExists(userOpencode)) {
      moveTreeRelative(installRoot, userDataRoot, opencodeRel, migrated, productLanguage);
    }
  }

  const projectsRel = "projects";
  const installProjects = path.join(installRoot, projectsRel);
  const userProjects = path.join(userDataRoot, projectsRel);
  if (hasLegacyProjectsDir(installProjects) && !pathExists(userProjects)) {
    moveTreeRelative(installRoot, userDataRoot, projectsRel, migrated, productLanguage);
  }

  return migrated;
}

/**
 * Ensure writable user-data directories exist and migrate legacy install-dir state once.
 */
export function ensureUserDataLayout(
  installRoot: string,
  userDataRoot: string,
  productLanguage?: ProductLanguage | null,
): EnsureUserDataLayoutResult {
  const install = path.resolve(installRoot);
  const userData = path.resolve(userDataRoot);
  const result: EnsureUserDataLayoutResult = {
    installRoot: install,
    userDataRoot: userData,
    migrated: [],
    skipped: false,
  };

  if (sameRoot(install, userData)) {
    ensureOpencodeRuntimeAssets(install, userData);
    return result;
  }

  const existingMarker = readMarker(userData);
  if (existingMarker?.version === USER_DATA_LAYOUT_VERSION) {
    result.skipped = true;
    ensureOpencodeRuntimeAssets(install, userData);
    return result;
  }

  if (installHasLegacyUserData(install)) {
    result.migrated = migrateInstallUserData(install, userData, productLanguage);
  }

  fs.mkdirSync(path.join(userData, "data"), { recursive: true });
  fs.mkdirSync(path.join(userData, PATHS.runtimeRoot), { recursive: true });
  fs.mkdirSync(path.join(userData, PATHS.OpencodeConfigDir), { recursive: true });

  if (result.migrated.length > 0) {
    writeMarker(userData, {
      version: USER_DATA_LAYOUT_VERSION,
      migratedFromInstallRoot: install,
      migratedAt: new Date().toISOString(),
      migratedPaths: result.migrated,
    });
  }

  ensureOpencodeRuntimeAssets(install, userData);
  return result;
}

/**
 * Record layout migration in SQLite after bootstrap (optional enrichment).
 */
export function recordUserDataLayoutMetadata(
  userDataRoot: string,
  installRoot: string,
  migrated: string[],
): void {
  if (migrated.length === 0) return;
  const db = getDatabase();
  const now = new Date().toISOString();
  const entries: Array<[string, string]> = [
    ["user_data_layout_version", String(USER_DATA_LAYOUT_VERSION)],
    ["migrated_from_install_root", installRoot],
    ["migrated_paths", JSON.stringify(migrated)],
  ];
  for (const [key, value] of entries) {
    db.prepare(`
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, value, now);
  }
  void userDataRoot;
}
