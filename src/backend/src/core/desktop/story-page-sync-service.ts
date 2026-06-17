import fs from 'node:fs';
import path from 'node:path';

import {
  CONTROLLED_EDITING_DISABLED_CODE,
  STORY_PROJECT_NOT_INITIALIZED_MESSAGE,
} from '../../../../contract/desktop-errors.ts';
import type {
  StoryEventOverview,
  StoryIntegrityIssue,
  StoryPage,
  StoryPageOrigin,
  StoryProjectGitInitializeResult,
  StoryProjectProfile,
  StoryProjectSyncResult,
  ProjectVersionSaveOptions,
} from '../../../../contract/types.ts';
import { StoryAnchorDao } from '../db/dao/story-anchor-dao.ts';
import { StoryIntegrityIssueDao } from '../db/dao/story-integrity-issue-dao.ts';
import { StoryPageDao } from '../db/dao/story-page-dao.ts';
import { StoryProjectDao } from '../db/dao/story-project-dao.ts';
import { getDatabase } from '../db/pool.ts';
import { readJson, writeMapJson } from '../rmmv/json.ts';
import { applyPatchToProject } from '../rmmv/patcher.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { initializeProjectGitBaseline } from './project-service.ts';
import { getMapFileForRead } from './staging-service.ts';
import {
  clonePage,
  createStoryPageUid,
  ensureStoryPageUid,
  readStoryPageUid,
  removeStoryPageMarker,
  removeStoryPageMarkerInPlace,
  storyEventShell,
  storyEventShellFingerprint,
  storyPageFingerprint,
} from '../rmmv/story-page-identity.ts';

interface MapEvent {
  id: number;
  name?: string;
  note?: string;
  x?: number;
  y?: number;
  pages?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface MapDocument {
  events?: Array<MapEvent | null>;
  [key: string]: unknown;
}

interface MapRecord {
  mapId: number;
  file: string;
  document: MapDocument;
}

export interface StorySyncActor {
  actorType: 'agent' | 'user' | 'external' | 'system';
  actorId?: string;
  sessionId?: string;
}

interface SyncIssueInput extends Omit<StoryIntegrityIssue, 'issueId' | 'projectId' | 'detectedAt'> {}

export const STORY_PROJECT_NOT_INITIALIZED = STORY_PROJECT_NOT_INITIALIZED_MESSAGE;

export class StoryProjectNotInitializedError extends Error {
  readonly code = CONTROLLED_EDITING_DISABLED_CODE;

  constructor(message: string = STORY_PROJECT_NOT_INITIALIZED) {
    super(message);
    this.name = 'StoryProjectNotInitializedError';
  }
}

const SYSTEM_ACTOR: StorySyncActor = { actorType: 'system', actorId: 'story-page-sync' };
const EXTERNAL_ACTOR: StorySyncActor = { actorType: 'external' };

export function getStoryProjectProfile(project: string): StoryProjectProfile | null {
  return StoryProjectDao.get(projectName(project));
}

export function assertStoryProjectInitialized(project: string): StoryProjectProfile {
  const profile = getStoryProjectProfile(project);
  if (!profile) {
    throw new StoryProjectNotInitializedError();
  }
  return profile;
}

export function initializeOriginalStoryProject(project: string): StoryProjectSyncResult {
  const resolved = path.resolve(project);
  assertProjectRoot(resolved);
  const projectId = projectName(resolved);
  resetStoryIdentity(projectId);
  const profile = StoryProjectDao.upsertOriginal(projectId, resolved);
  return { profile, scannedMaps: 0, scannedEvents: 0, scannedPages: 0, changedFiles: [], issues: [] };
}

export async function initializeOriginalStoryProjectWithGitBaseline(
  workflowRoot: string,
  project?: string,
  options: ProjectVersionSaveOptions = {},
): Promise<StoryProjectGitInitializeResult> {
  const git = await initializeProjectGitBaseline(workflowRoot, project, options);
  const result = initializeOriginalStoryProject(git.projectPath);
  return {
    ...result,
    git,
    message: `${git.message}，版本管理已启用`,
  };
}

export function watchStoryProject(project: string): void {
  void project;
}

export function syncStoryProject(
  project: string,
  actor: StorySyncActor = EXTERNAL_ACTOR,
): StoryProjectSyncResult {
  const resolved = path.resolve(project);
  const projectId = projectName(resolved);
  const profile = StoryProjectDao.get(projectId);
  if (!profile) {
    return { profile: null, scannedMaps: 0, scannedEvents: 0, scannedPages: 0, changedFiles: [], issues: [] };
  }

  const maps = readMapRecords(resolved);
  const changedFiles = new Set<string>();
  const issues: SyncIssueInput[] = [];
  let scannedEvents = 0;
  let scannedPages = 0;
  const seenAnchors = new Set<string>();
  const seenPages = new Set<string>();
  const fileBackups = new Map<string, Buffer>();

  const run = getDatabase().transaction(() => {
    for (const map of maps) {
      let mapChanged = false;
      for (const event of (map.document.events || []).filter((item): item is MapEvent => Boolean(item))) {
        scannedEvents += 1;
        const result = syncEvent(profile, map.mapId, event, actor, issues);
        mapChanged = mapChanged || result.mapChanged;
        scannedPages += result.scannedPages;
        seenAnchors.add(result.anchorId);
        for (const pageNodeId of result.seenPages) seenPages.add(pageNodeId);
      }
      if (mapChanged) {
        fileBackups.set(map.file, fs.readFileSync(map.file));
        writeMapJson(map.file, map.document);
        changedFiles.add(map.file);
      }
    }

    for (const anchor of StoryAnchorDao.listByProject(projectId)) {
      if (seenAnchors.has(anchor.anchorId)) continue;
      const isBaseline = anchor.origin === 'baseline';
      StoryAnchorDao.updateSyncState(projectId, anchor.anchorId, {
        currentShell: null,
        integrityStatus: isBaseline ? 'baseline-deleted' : 'missing',
      });
      issues.push({
        scopeType: 'event',
        scopeId: anchor.anchorId,
        code: isBaseline ? 'baseline-event-deleted' : 'event-missing',
        severity: 'error',
        message: isBaseline
          ? `历史受保护事件已被删除：MAP ${anchor.mapId} 事件 ${anchor.eventId}`
          : `已登记事件在 JSON 中不存在：MAP ${anchor.mapId} 事件 ${anchor.eventId}`,
        mapId: anchor.mapId,
        eventId: anchor.eventId,
      });
    }

    for (const page of StoryPageDao.listByProject(projectId)) {
      if (seenPages.has(page.pageNodeId)) continue;
      const status = page.origin === 'baseline' ? 'baseline-deleted' : 'missing';
      StoryPageDao.markMissing(projectId, page.pageNodeId, status);
      issues.push({
        scopeType: 'page',
        scopeId: page.pageNodeId,
        code: page.origin === 'baseline' ? 'baseline-page-deleted' : 'page-missing',
        severity: 'error',
        message: page.origin === 'baseline' ? '历史受保护页面已被删除。' : '已登记页面在 JSON 中不存在。',
        pageNodeId: page.pageNodeId,
      });
    }
    StoryIntegrityIssueDao.replaceSyncIssues(projectId, issues);
  });

  try {
    run();
  } catch (error) {
    for (const [file, content] of fileBackups) fs.writeFileSync(file, content);
    throw error;
  }

  return {
    profile,
    scannedMaps: maps.length,
    scannedEvents,
    scannedPages,
    changedFiles: [...changedFiles],
    issues: StoryIntegrityIssueDao.listActive(projectId),
  };
}

interface StoryEventReadOptions {
  mapFile?: string;
}

export function inspectStoryEvent(project: string, mapId: number, eventId: number, options: StoryEventReadOptions = {}): StoryEventOverview | null {
  const result = syncSingleStoryEvent(project, mapId, eventId, EXTERNAL_ACTOR, options);
  if (!result) return null;
  const { profile, anchorId } = result;
  const anchor = StoryAnchorDao.get(profile.projectId, anchorId);
  if (!anchor) return null;
  return {
    projectId: profile.projectId,
    anchorId: anchor.anchorId,
    mapId,
    eventId,
    eventName: anchor.eventName || '',
    origin: profile.defaultOrigin,
    shellEditable: true,
    integrityStatus: anchor.integrityStatus,
    pages: StoryPageDao.listByAnchor(profile.projectId, anchor.anchorId).map((page) => ({
      pageNodeId: page.pageNodeId,
      pageUid: page.pageUid,
      pageIndex: page.orderHint,
      origin: profile.defaultOrigin,
      editable: true,
      integrityStatus: page.integrityStatus,
      currentFingerprint: page.currentFingerprint,
      baselineFingerprint: page.baselineFingerprint,
    })),
    issues: [],
  };
}

export function inspectStoryEventForEditor(
  workflowRoot: string,
  project: string,
  mapId: number,
  eventId: number,
): StoryEventOverview | null {
  return inspectStoryEvent(project, mapId, eventId, {
    mapFile: getMapFileForRead(workflowRoot, project, mapId),
  });
}

export function changeStoryPageOrigin(
  project: string,
  pageNodeId: string,
  origin: StoryPageOrigin,
): StoryEventOverview {
  const resolved = path.resolve(project);
  const projectId = projectName(resolved);
  const page = StoryPageDao.get(projectId, pageNodeId);
  if (!page) throw new Error(`页面不存在：${pageNodeId}`);
  const anchor = StoryAnchorDao.get(projectId, page.anchorId);
  if (!anchor?.eventId) throw new Error('页面缺少事件锚点');
  try {
    withMapFileRollback(resolved, anchor.mapId, () => {
      const { file, document, event } = loadEvent(resolved, anchor.mapId, anchor.eventId!);
      const index = locatePageIndex(event, page);
      if (index < 0) throw new Error('无法在 JSON 中定位该页面');
      const current = clonePage(event.pages![index]);
      let pageUid: string | undefined;
      if (origin === 'baseline') {
        event.pages![index] = removeStoryPageMarker(current) as Record<string, unknown>;
      } else {
        pageUid = ensureStoryPageUid(current, page.pageUid || createStoryPageUid());
        event.pages![index] = removeStoryPageMarker(current) as Record<string, unknown>;
      }
      writeMapJson(file, document);
      StoryPageDao.updateOrigin(projectId, pageNodeId, origin, pageUid);
      syncStoryProject(resolved, { actorType: 'user' });
      StoryPageDao.addHistory({
        projectId,
        pageNodeId,
        action: 'origin-changed',
        beforePage: page.currentPage,
        afterPage: event.pages![index],
        beforeFingerprint: page.currentFingerprint,
        afterFingerprint: storyPageFingerprint(event.pages![index]),
        actorType: 'user',
        actorId: `${page.origin}->${origin}`,
      });
    });
  } catch (error) {
    StoryPageDao.upsert(page);
    syncStoryProject(resolved, SYSTEM_ACTOR);
    throw error;
  }
  return inspectStoryEvent(resolved, anchor.mapId, anchor.eventId)!;
}

export function applyAgentPagePatch(
  project: string,
  // 接收完整 agent patch 信封：实际 spec 带 engine/kind 等外层字段，
  // 本函数只消费 operations，但类型须容纳信封字段，否则调用方传真实 spec 会被 excess-property 拒。
  spec: { engine?: string; kind?: string; operations?: Array<Record<string, unknown>> },
  actor: Omit<StorySyncActor, 'actorType'> = {},
): unknown {
  const resolved = path.resolve(project);
  assertStoryProjectInitialized(resolved);
  const projectId = projectName(resolved);
  const mapIds = new Set<number>();
  const managedSpec = {
    ...spec,
    operations: (spec.operations || []).map((operation) => ({ ...operation })),
  };
  const eventRefs = new Set<string>();
  for (const operation of managedSpec.operations) {
    const requestedPageNodeId = typeof operation.pageNodeId === 'string' ? operation.pageNodeId.trim() : '';
    const requestedPage = requestedPageNodeId ? StoryPageDao.get(projectId, requestedPageNodeId) : null;
    const requestedAnchor = requestedPage ? StoryAnchorDao.get(projectId, requestedPage.anchorId) : null;
    if (requestedPageNodeId && (!requestedPage || !requestedAnchor?.eventId || requestedPage.orderHint === undefined)) {
      throw new Error(`无法通过稳定页面 ID 定位页面：${requestedPageNodeId}`);
    }
    if (requestedPage && requestedAnchor?.eventId) {
      operation.mapId = requestedAnchor.mapId;
      operation.eventId = requestedAnchor.eventId;
      operation.pageIndex = requestedPage.orderHint;
      delete operation.pageNodeId;
    }
    const mapId = Number(operation.mapId);
    const eventId = Number(operation.eventId);
    const pageIndex = Number(operation.pageIndex);
    if (!Number.isInteger(mapId) || !Number.isInteger(eventId) || !Number.isInteger(pageIndex)) continue;
    syncSingleStoryEvent(resolved, mapId, eventId, EXTERNAL_ACTOR);
    const anchor = StoryAnchorDao.getByMapEvent(projectId, mapId, eventId);
    const page = anchor
      ? StoryPageDao.listByAnchor(projectId, anchor.anchorId).find((item) => item.orderHint === pageIndex)
      : null;
    if (!page) throw new Error(`无法识别 MAP ${mapId} 事件 ${eventId} 第 ${pageIndex + 1} 页的身份`);
    mapIds.add(mapId);
    eventRefs.add(`${mapId}:${eventId}`);
  }
  return withMapFilesRollback(resolved, [...mapIds], () => {
    const report = applyPatchToProject(resolved, managedSpec as never);
    for (const ref of eventRefs) {
      const [mapId, eventId] = ref.split(':').map(Number);
      syncSingleStoryEvent(resolved, mapId, eventId, { actorType: 'agent', ...actor });
    }
    return report;
  });
}

export function syncAfterManagedMutation<T>(
  project: string,
  mapIds: number[],
  mutation: () => T,
  actor: StorySyncActor,
): T {
  const resolved = path.resolve(project);
  assertStoryProjectInitialized(resolved);
  return withMapFilesRollback(resolved, mapIds, () => {
    void actor;
    return mutation();
  });
}

/** Map JSON rollback without requiring story project / version management profile. */
export function withProjectMapRollback<T>(project: string, mapIds: number[], run: () => T): T {
  return withMapFilesRollback(path.resolve(project), mapIds, run);
}

function syncEvent(
  profile: StoryProjectProfile,
  mapId: number,
  event: MapEvent,
  actor: StorySyncActor,
  issues: SyncIssueInput[],
): { anchorId: string; scannedPages: number; seenPages: string[]; mapChanged: boolean } {
  const projectId = profile.projectId;
  const eventId = Number(event.id);
  const shell = storyEventShell(event);
  let anchor = StoryAnchorDao.getByMapEvent(projectId, mapId, eventId);
  if (!anchor) {
    anchor = StoryAnchorDao.upsertEditable({
      projectId,
      origin: profile.defaultOrigin,
      mapId,
      eventId,
      eventName: String(shell.name || ''),
      x: Number(shell.x),
      y: Number(shell.y),
      currentShell: shell,
    });
  }

  let shellStatus: StoryPage['integrityStatus'] = 'synced';
  if (anchor.origin === 'baseline' && storyEventShellFingerprint(shell) !== anchor.baselineShellFingerprint) {
    shellStatus = 'baseline-modified';
    issues.push({
      scopeType: 'event',
      scopeId: anchor.anchorId,
      code: 'baseline-event-shell-modified',
      severity: 'error',
      message: `历史受保护事件公共部分被修改：MAP ${mapId} 事件 ${eventId}`,
      mapId,
      eventId,
    });
  }
  anchor = StoryAnchorDao.updateSyncState(projectId, anchor.anchorId, {
    eventName: String(shell.name || ''),
    x: Number(shell.x),
    y: Number(shell.y),
    currentShell: shell,
    integrityStatus: shellStatus,
  });

  const storedPages = StoryPageDao.listByAnchor(projectId, anchor.anchorId);
  const unmatched = new Set(storedPages.map((page) => page.pageNodeId));
  const seenPages: string[] = [];
  let mapChanged = false;
  const pages = Array.isArray(event.pages) ? event.pages : [];

  for (let index = 0; index < pages.length; index += 1) {
    const rawPage = pages[index];
    const cleanup = removeStoryPageMarkerInPlace(rawPage);
    if (cleanup.removed) mapChanged = true;
    const fingerprint = storyPageFingerprint(rawPage);
    const uid = cleanup.uid || readStoryPageUid(rawPage);
    let stored = uid ? storedPages.find((page) => page.pageUid === uid) : undefined;
    stored ||= storedPages.find((page) => unmatched.has(page.pageNodeId)
      && page.origin === 'baseline' && page.baselineFingerprint === fingerprint);
    stored ||= storedPages.find((page) => unmatched.has(page.pageNodeId)
      && page.origin === 'baseline' && page.orderHint === index);
    stored ||= storedPages.find((page) => unmatched.has(page.pageNodeId)
      && page.origin !== 'baseline' && page.currentFingerprint === fingerprint);
    stored ||= !uid
      ? storedPages.find((page) => unmatched.has(page.pageNodeId)
        && page.origin !== 'baseline' && page.orderHint === index)
      : undefined;

    if (!stored) {
      const pageUid = uid || ensureStoryPageUid(rawPage, createStoryPageUid());
      stored = StoryPageDao.upsert({
        projectId,
        pageNodeId: pageUid,
        anchorId: anchor.anchorId,
        origin: profile.defaultOrigin,
        pageRef: pageUid,
        pageUid,
        orderHint: index,
        currentPage: clonePage(rawPage),
        currentFingerprint: fingerprint,
        integrityStatus: 'synced',
        lastSyncedAt: new Date().toISOString(),
        rowVersion: 1,
      });
      StoryPageDao.addHistory({
        projectId,
        pageNodeId: stored.pageNodeId,
        action: 'created',
        afterPage: stored.currentPage,
        afterFingerprint: stored.currentFingerprint,
        ...actor,
      });
    } else {
      unmatched.delete(stored.pageNodeId);
      let pageUid = stored.pageUid;
      if (stored.origin !== 'baseline' && !uid) {
        pageUid = ensureStoryPageUid(rawPage, stored.pageUid || createStoryPageUid());
      }
      const status = stored.origin === 'baseline' && fingerprint !== stored.baselineFingerprint
        ? 'baseline-modified'
        : 'synced';
      if (status === 'baseline-modified') {
        issues.push({
          scopeType: 'page',
          scopeId: stored.pageNodeId,
          code: 'baseline-page-modified',
          severity: 'error',
          message: `历史受保护页面被修改：MAP ${mapId} 事件 ${eventId} 第 ${index + 1} 页`,
          mapId,
          eventId,
          pageNodeId: stored.pageNodeId,
        });
      }
      const beforePage = stored.currentPage;
      const beforeFingerprint = stored.currentFingerprint;
      stored = StoryPageDao.upsert({
        ...stored,
        pageUid,
        pageRef: stored.origin === 'baseline' ? stored.pageRef : String(pageUid),
        orderHint: index,
        currentPage: clonePage(rawPage),
        currentFingerprint: fingerprint,
        integrityStatus: status,
        lastSyncedAt: new Date().toISOString(),
      });
      if (beforeFingerprint && beforeFingerprint !== fingerprint) {
        StoryPageDao.addHistory({
          projectId,
          pageNodeId: stored.pageNodeId,
          action: 'updated',
          beforePage,
          afterPage: clonePage(rawPage),
          beforeFingerprint,
          afterFingerprint: fingerprint,
          ...actor,
        });
      }
    }
    seenPages.push(stored.pageNodeId);
  }
  return { anchorId: anchor.anchorId, scannedPages: pages.length, seenPages, mapChanged };
}

function resetStoryIdentity(projectId: string): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('DELETE FROM story_integrity_issues WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM story_page_history WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM story_event_anchors WHERE project_id = ?').run(projectId);
    StoryProjectDao.delete(projectId);
  })();
}

function readMapRecords(project: string): MapRecord[] {
  const dataDir = resolveDataDir(project);
  const files = fs.readdirSync(dataDir)
    .filter((name) => /^Map\d{3}\.json$/i.test(name))
    .sort();
  return files.map((name) => {
    const match = /^Map(\d{3})\.json$/i.exec(name)!;
    const file = path.join(dataDir, name);
    return { mapId: Number(match[1]), file, document: readJson(file) as MapDocument };
  });
}

function assertProjectRoot(project: string): void {
  const dataDir = resolveDataDir(project);
  if (!fs.existsSync(path.join(dataDir, 'MapInfos.json'))) {
    throw new Error(`不是有效的 RPG Maker MV 工程：${project}`);
  }
}

function syncSingleStoryEvent(
  project: string,
  mapId: number,
  eventId: number,
  actor: StorySyncActor,
  options: StoryEventReadOptions = {},
): { profile: StoryProjectProfile; anchorId: string } | null {
  const resolved = path.resolve(project);
  const profile = StoryProjectDao.get(projectName(resolved));
  if (!profile) return null;
  const { event } = loadEvent(resolved, mapId, eventId, options);
  let anchorId = '';
  getDatabase().transaction(() => {
    anchorId = syncEvent(profile, mapId, event, actor, []).anchorId;
  })();
  return { profile, anchorId };
}

function loadEvent(project: string, mapId: number, eventId: number, options: StoryEventReadOptions = {}): { file: string; document: MapDocument; event: MapEvent } {
  const file = options.mapFile || path.join(resolveDataDir(project), `Map${String(mapId).padStart(3, '0')}.json`);
  const document = readJson(file) as MapDocument;
  const event = (document.events || []).find((item) => item?.id === eventId);
  if (!event) throw new Error(`MAP ${mapId} 中不存在事件 ${eventId}`);
  if (!Array.isArray(event.pages)) event.pages = [];
  return { file, document, event };
}

function locatePageIndex(event: MapEvent, page: StoryPage): number {
  const pages = event.pages || [];
  if (page.pageUid) {
    const byUid = pages.findIndex((item) => readStoryPageUid(item) === page.pageUid);
    if (byUid >= 0) return byUid;
  }
  if (page.currentFingerprint) {
    const byFingerprint = pages.findIndex((item) => storyPageFingerprint(item) === page.currentFingerprint);
    if (byFingerprint >= 0) return byFingerprint;
  }
  return Number.isInteger(page.orderHint) && page.orderHint! < pages.length ? page.orderHint! : -1;
}

function withMapFileRollback<T>(project: string, mapId: number, run: () => T): T {
  return withMapFilesRollback(project, [mapId], run);
}

function withMapFilesRollback<T>(project: string, mapIds: number[], run: () => T): T {
  const dataDir = resolveDataDir(project);
  const backups = new Map<string, Buffer | null>();
  for (const mapId of new Set(mapIds)) {
    const file = path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`);
    backups.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  try {
    return run();
  } catch (error) {
    for (const [file, content] of backups) {
      if (content) fs.writeFileSync(file, content);
      else if (fs.existsSync(file)) fs.rmSync(file);
    }
    throw error;
  }
}

function projectName(project: string): string {
  return path.basename(path.resolve(project));
}
