import fs from 'node:fs';
import path from 'node:path';

import type {
  ProjectAssetAnnotation,
  ProjectAssetAnnotationInput,
} from '../../../../contract/types.ts';
import { parseProjectAssetBrowserNodeId } from '../../../../contract/project-asset-browser-nodes.ts';
import { AssetAnnotationDao, type AssetAnnotationRow } from '../db/dao/asset-annotation-dao.ts';
import {
  readEmbeddedAssetNoteFromBuffer,
  supportsEmbeddedAssetNote,
  writeEmbeddedAssetNoteToBuffer,
} from './asset-note-embedding.ts';

/** rmmv.db is user-global; normalize project paths so Windows casing/separator variants collapse. */
function annotationProjectKey(project: string): string {
  return path.resolve(project).toLowerCase();
}

const ANNOTATION_KINDS = new Set(['asset', 'folder', 'map']);

function toAnnotation(row: AssetAnnotationRow): ProjectAssetAnnotation {
  return {
    targetId: row.target_id,
    kind: (ANNOTATION_KINDS.has(row.kind) ? row.kind : 'asset') as ProjectAssetAnnotation['kind'],
    note: row.note || '',
    favorite: row.favorite === 1,
    updatedAt: row.updated_at,
  };
}

export function listAssetAnnotations(project: string): ProjectAssetAnnotation[] {
  return AssetAnnotationDao.listByProject(annotationProjectKey(project)).map(toAnnotation);
}

/**
 * Merge-write a single annotation. Omitted fields keep their stored value;
 * a row that ends up with no note and no favorite is deleted outright.
 * When a relativePath is supplied with a note change, the note is also
 * embedded into the file itself (PNG/OGG) so it travels with the file.
 */
export function setAssetAnnotation(
  project: string,
  input: ProjectAssetAnnotationInput,
): ProjectAssetAnnotation | null {
  const targetId = String(input?.targetId || '').trim();
  if (!targetId) {
    throw new Error('Asset annotation target id must be a non-empty string.');
  }
  const key = annotationProjectKey(project);
  const existing = AssetAnnotationDao.get(key, targetId);
  const kind = input.kind !== undefined && ANNOTATION_KINDS.has(input.kind)
    ? input.kind
    : (existing?.kind && ANNOTATION_KINDS.has(existing.kind) ? existing.kind : 'asset');
  const note = input.note !== undefined ? String(input.note) : (existing?.note || '');
  const favorite = input.favorite !== undefined ? input.favorite === true : existing?.favorite === 1;

  if (input.note !== undefined && input.relativePath) {
    embedNoteIntoFile(project, String(input.relativePath), note);
  }

  if (!note.trim() && !favorite) {
    AssetAnnotationDao.delete(key, targetId);
    return null;
  }
  AssetAnnotationDao.upsert(key, targetId, kind, note, favorite);
  const row = AssetAnnotationDao.get(key, targetId);
  return row ? toAnnotation(row) : null;
}

/** Best-effort in-place embed; unsupported/encrypted/broken files simply keep the DB copy. */
function embedNoteIntoFile(project: string, relativePath: string, note: string): void {
  try {
    if (!supportsEmbeddedAssetNote(relativePath)) return;
    const projectRoot = path.resolve(project);
    const absolute = path.resolve(projectRoot, ...relativePath.replace(/\\/g, '/').split('/'));
    if (absolute !== projectRoot && !absolute.startsWith(projectRoot + path.sep)) return;
    if (!fs.existsSync(absolute)) return;
    const rewritten = writeEmbeddedAssetNoteToBuffer(absolute, fs.readFileSync(absolute), note);
    if (rewritten) fs.writeFileSync(absolute, rewritten);
  } catch {
    /* the DB row remains the source of truth when embedding fails */
  }
}

/** Move a single annotation to a renamed/moved target id (rename, cross-category move). */
export function transferAssetAnnotation(project: string, fromTargetId: string, toTargetId: string): void {
  const from = String(fromTargetId || '').trim();
  const to = String(toTargetId || '').trim();
  if (!from || !to || from === to) return;
  AssetAnnotationDao.transfer(annotationProjectKey(project), from, to);
}

/**
 * Carry annotations across a pictures subfolder rename/move: the folder row itself,
 * nested folder rows (`pictures/ui/...`) and nested asset rows (`pictures:ui/...`).
 */
export function transferSubfolderAnnotations(
  project: string,
  previousNodeId: string,
  nextNodeId: string,
): void {
  const key = annotationProjectKey(project);
  const from = String(previousNodeId || '').trim();
  const to = String(nextNodeId || '').trim();
  if (!from || !to || from === to) return;
  AssetAnnotationDao.transfer(key, from, to);
  const prefixPairs: Array<[string, string]> = [[`${from}/`, `${to}/`]];
  const fromParsed = parseProjectAssetBrowserNodeId(from);
  const toParsed = parseProjectAssetBrowserNodeId(to);
  if (fromParsed.subpath && toParsed.subpath) {
    prefixPairs.push([
      `${fromParsed.categoryId}:${fromParsed.subpath}/`,
      `${toParsed.categoryId}:${toParsed.subpath}/`,
    ]);
  }
  for (const [fromPrefix, toPrefix] of prefixPairs) {
    for (const targetId of AssetAnnotationDao.listTargetIdsByPrefix(key, fromPrefix)) {
      AssetAnnotationDao.transfer(key, targetId, toPrefix + targetId.slice(fromPrefix.length));
    }
  }
}

/**
 * After an import, adopt notes embedded in the imported files: the file wins
 * whenever the DB has no note yet (fresh row keeps favorite untouched).
 */
export function backfillEmbeddedAssetNotes(
  project: string,
  imported: Array<{ category: string; name: string; relativePath: string }>,
): void {
  const key = annotationProjectKey(project);
  const projectRoot = path.resolve(project);
  for (const item of imported) {
    try {
      const relativePath = String(item.relativePath || '');
      if (!relativePath || !supportsEmbeddedAssetNote(relativePath)) continue;
      const absolute = path.resolve(projectRoot, ...relativePath.replace(/\\/g, '/').split('/'));
      if (!absolute.startsWith(projectRoot + path.sep) || !fs.existsSync(absolute)) continue;
      const note = readEmbeddedAssetNoteFromBuffer(absolute, fs.readFileSync(absolute));
      if (!note || !note.trim()) continue;
      const targetId = `${item.category}:${item.name}`;
      const existing = AssetAnnotationDao.get(key, targetId);
      if (existing && existing.note.trim()) continue; // DB note wins once it exists
      AssetAnnotationDao.upsert(key, targetId, existing?.kind || 'asset', note, existing?.favorite === 1);
    } catch {
      /* per-item best effort */
    }
  }
}
