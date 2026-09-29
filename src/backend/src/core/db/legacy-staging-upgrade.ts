import type { WorkflowDatabase } from './pool.ts';

interface LegacyStagingManifestRow {
  manifest: string;
}

function tableExists(db: WorkflowDatabase, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function isEmptyRecord(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 0;
}

function isEmptyV4Manifest(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return manifest.version === 4
    && isEmptyRecord(manifest.files)
    && isEmptyRecord(manifest.maps)
    && isEmptyRecord(manifest.operations);
}

/** Preserve 0.7.1 drafts until the user has reviewed them in the old editor. */
export function assertLegacyStagingReadyForRemoval(db: WorkflowDatabase): void {
  if (!tableExists(db, 'staging_manifests')) return;

  const rows = db.prepare('SELECT manifest FROM staging_manifests ORDER BY id').all() as unknown as LegacyStagingManifestRow[];
  const unresolved = rows.filter((row) => {
    if (typeof row.manifest !== 'string') return true;
    try {
      return !isEmptyV4Manifest(JSON.parse(row.manifest));
    } catch {
      return true;
    }
  });
  if (unresolved.length === 0) return;

  throw new Error(
    `Upgrade stopped: ${unresolved.length} legacy project staging manifest(s) may contain unapplied changes. `
    + 'No staging manifest or draft was removed. Open the same user data with RPG Agent MV 0.7.1, '
    + 'review and apply or discard all staged changes, then start this version again. '
    + 'Preserve data/rmmv.db and runtime/agent-console-staging together; do not delete them to bypass this check. '
    + 'If the old version cannot open the data, keep copies of both and request recovery assistance.',
  );
}
