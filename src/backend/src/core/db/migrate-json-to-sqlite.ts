// 一次性 JSON → SQLite 导入（仅 bootstrap importLegacyJson: true 或 CLI 手动调用；运行时代码不写回 JSON）。
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate.ts';
import { ProviderDao } from './dao/provider-dao.ts';
import { ConsoleSettingsDao } from './dao/console-settings-dao.ts';
import { StagingManifestDao } from './dao/staging-manifest-dao.ts';
import { MapSelectionDao } from './dao/map-selection-dao.ts';

interface MigrationResult {
  providers: { migrated: number; skipped: number; errors: number };
  consoleSettings: { migrated: number; skipped: number; errors: number };
  stagingManifests: { migrated: number; skipped: number; errors: number };
  mapSelections: { migrated: number; skipped: number; errors: number };
}

/**
 * 迁移所有 JSON 文件到 SQLite
 */
export async function migrateJsonToSqlite(workflowRoot: string): Promise<MigrationResult> {
  console.log('[migrate] Starting JSON to SQLite migration...');

  migrate();

  const result: MigrationResult = {
    providers: { migrated: 0, skipped: 0, errors: 0 },
    consoleSettings: { migrated: 0, skipped: 0, errors: 0 },
    stagingManifests: { migrated: 0, skipped: 0, errors: 0 },
    mapSelections: { migrated: 0, skipped: 0, errors: 0 }
  };

  // 迁移 providers
  result.providers = await migrateProviders(workflowRoot);

  // 迁移 console settings
  result.consoleSettings = await migrateConsoleSettings(workflowRoot);

  // 迁移 staging manifests
  result.stagingManifests = await migrateStagingManifests(workflowRoot);

  // 迁移 map selections
  result.mapSelections = await migrateMapSelections(workflowRoot);

  console.log('[migrate] Migration completed:', result);
  return result;
}

/**
 * 迁移 providers.json
 */
async function migrateProviders(workflowRoot: string): Promise<{ migrated: number; skipped: number; errors: number }> {
  const result = { migrated: 0, skipped: 0, errors: 0 };
  const providersPath = path.join(workflowRoot, 'runtime', 'providers', 'providers.json');

  if (!fs.existsSync(providersPath)) {
    console.log('[migrate] providers.json not found, skipping');
    return result;
  }

  try {
    const data = JSON.parse(fs.readFileSync(providersPath, 'utf8'));

    // 处理不同的数据格式
    const providers = Array.isArray(data)
      ? data
      : Object.entries(data.providers || {}).map(([id, config]) => ({ id, ...(config as Record<string, unknown>) }));

    for (const provider of providers) {
      try {
        const id = provider.id || provider.name;
        if (!id) {
          result.skipped++;
          continue;
        }

        // 检查是否已存在
        if (ProviderDao.exists(id)) {
          result.skipped++;
          continue;
        }

        ProviderDao.upsert(id, provider);
        result.migrated++;
      } catch (error) {
        console.error(`[migrate] Error migrating provider:`, error);
        result.errors++;
      }
    }

    console.log(`[migrate] Providers: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (error) {
    console.error('[migrate] Error reading providers.json:', error);
    result.errors++;
  }

  return result;
}

/**
 * 迁移 console-settings.json
 */
async function migrateConsoleSettings(workflowRoot: string): Promise<{ migrated: number; skipped: number; errors: number }> {
  const result = { migrated: 0, skipped: 0, errors: 0 };
  const settingsPath = path.join(workflowRoot, 'runtime', 'console-settings.json');

  if (!fs.existsSync(settingsPath)) {
    console.log('[migrate] console-settings.json not found, skipping');
    return result;
  }

  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // 处理不同的数据格式
    const settings = Array.isArray(data) ? data : (data.settings || data);

    if (typeof settings === 'object' && !Array.isArray(settings)) {
      // 键值对格式
      for (const [key, value] of Object.entries(settings)) {
        try {
          ConsoleSettingsDao.set(key, value);
          result.migrated++;
        } catch (error) {
          console.error(`[migrate] Error migrating setting ${key}:`, error);
          result.errors++;
        }
      }
    } else if (Array.isArray(settings)) {
      // 数组格式
      for (const item of settings) {
        try {
          const key = item.key || item.name;
          if (!key) {
            result.skipped++;
            continue;
          }
          ConsoleSettingsDao.set(key, item.value || item);
          result.migrated++;
        } catch (error) {
          console.error(`[migrate] Error migrating setting:`, error);
          result.errors++;
        }
      }
    }

    console.log(`[migrate] Console Settings: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (error) {
    console.error('[migrate] Error reading console-settings.json:', error);
    result.errors++;
  }

  return result;
}

/**
 * 迁移 staging manifests
 */
async function migrateStagingManifests(workflowRoot: string): Promise<{ migrated: number; skipped: number; errors: number }> {
  const result = { migrated: 0, skipped: 0, errors: 0 };
  const stagingDir = path.join(workflowRoot, 'runtime', 'agent-console-staging');

  if (!fs.existsSync(stagingDir)) {
    console.log('[migrate] agent-console-staging directory not found, skipping');
    return result;
  }

  try {
    const entries = fs.readdirSync(stagingDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(stagingDir, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const projectId = entry.name; // 使用目录名作为 project_id

        // 检查是否已存在
        const existing = StagingManifestDao.getLatestByProject(projectId);
        if (existing) {
          result.skipped++;
          continue;
        }

        StagingManifestDao.create(projectId, manifest);
        result.migrated++;
      } catch (error) {
        console.error(`[migrate] Error migrating staging manifest ${entry.name}:`, error);
        result.errors++;
      }
    }

    console.log(`[migrate] Staging Manifests: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (error) {
    console.error('[migrate] Error reading staging directory:', error);
    result.errors++;
  }

  return result;
}

/**
 * 迁移 map-selection.json
 */
async function migrateMapSelections(workflowRoot: string): Promise<{ migrated: number; skipped: number; errors: number }> {
  const result = { migrated: 0, skipped: 0, errors: 0 };
  const selectionPath = path.join(workflowRoot, 'runtime', 'map-selection', 'map-selection.json');

  if (!fs.existsSync(selectionPath)) {
    console.log('[migrate] map-selection.json not found, skipping');
    return result;
  }

  try {
    const data = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
    const projectId = 'default';

    const existing = MapSelectionDao.getLatest(projectId);
    if (existing) {
      console.log('[migrate] map-selection already exists in SQLite, skipping');
      result.skipped++;
      return result;
    }

    MapSelectionDao.create(projectId, data);
    result.migrated++;
    console.log(`[migrate] Map Selections: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors} errors`);
  } catch (error) {
    console.error('[migrate] Error reading map-selection.json:', error);
    result.errors++;
  }

  return result;
}

/**
 * 备份原始 JSON 文件
 */
export function backupJsonFiles(workflowRoot: string): void {
  const backupDir = path.join(workflowRoot, 'runtime', 'backup-json-' + new Date().toISOString().replace(/[:.]/g, '-'));

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const filesToBackup = [
    'runtime/providers/providers.json',
    'runtime/console-settings.json',
    'runtime/map-selection/map-selection.json'
  ];

  for (const file of filesToBackup) {
    const src = path.join(workflowRoot, file);
    if (fs.existsSync(src)) {
      const dest = path.join(backupDir, path.basename(file));
      fs.copyFileSync(src, dest);
      console.log(`[migrate] Backed up ${file} to ${dest}`);
    }
  }

  // 备份 staging manifests
  const stagingDir = path.join(workflowRoot, 'runtime', 'agent-console-staging');
  if (fs.existsSync(stagingDir)) {
    const backupStagingDir = path.join(backupDir, 'agent-console-staging');
    fs.mkdirSync(backupStagingDir, { recursive: true });

    const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(stagingDir, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const dest = path.join(backupStagingDir, `${entry.name}-manifest.json`);
        fs.copyFileSync(manifestPath, dest);
        console.log(`[migrate] Backed up staging manifest ${entry.name}`);
      }
    }
  }

  console.log(`[migrate] Backup completed to ${backupDir}`);
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const workflowRoot = process.argv[2] || process.cwd();

  console.log(`[migrate] Starting migration for workflow root: ${workflowRoot}`);

  // 备份
  backupJsonFiles(workflowRoot);

  // 迁移
  migrateJsonToSqlite(workflowRoot)
    .then(() => {
      console.log('[migrate] Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[migrate] Migration failed:', error);
      process.exit(1);
    });
}
