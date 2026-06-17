import path from 'node:path';

import { normalizeCommands } from '../rmmv/event-page-compiler.ts';
import { readJson } from '../rmmv/json.ts';
import { applyPatchToProject } from '../rmmv/patcher.ts';
import { createMapEvent, updateMapEvent } from '../workflow/map/map-event-edit.ts';
import { loadRegistry, updateContractPlacement } from '../workflow/event/event-registry.ts';
import { eventContentFingerprint } from '../workflow/event/event-fingerprint.ts';
import { ensureStagedMap, markStagedMapUpdated } from './staging-service.ts';

export interface CreatePlacementEventPayload {
  name: string;
  x: number;
  y: number;
  note?: string;
  /** 场景/契约 id；用于定位注册表中的事件实现。 */
  contractId?: string;
  /** 可选 sceneId；仅保留语义输入，不再写入 RMMV note 标记。 */
  sceneId?: string;
  /** MV 格式 pages，或带 commands[] 的契约页（走 patcher 编译） */
  pages?: Array<Record<string, unknown>>;
}

function hasAbstractPages(pages?: Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(pages) || !pages.length) return false;
  const first = pages[0];
  return Boolean(first && typeof first === 'object' && Array.isArray((first as { commands?: unknown }).commands));
}

/** 将契约 implementation（pages 或顶层 commands[]）规范为 patcher 可编译的抽象页。 */
export function normalizeContractImplementation(
  impl: Record<string, unknown> | null | undefined,
  defaultTrigger?: string,
): Array<Record<string, unknown>> | null {
  if (!impl || typeof impl !== 'object') return null;
  const pages = impl.pages as Array<Record<string, unknown>> | undefined;
  if (hasAbstractPages(pages)) return pages!;
  const commands = impl.commands;
  if (Array.isArray(commands) && commands.length) {
    const page: Record<string, unknown> = { commands };
    if (defaultTrigger) page.trigger = defaultTrigger;
    return [page];
  }
  return null;
}

/** 从 contractId 解析场景 id；不再从 RMMV note 读取或写入 AIWF 标记。 */
function extractSceneId(payload: CreatePlacementEventPayload): string | null {
  const fromContract = String(payload.contractId || '').trim();
  return fromContract || null;
}

function storyNoteTokens(contractId: string, sceneId?: string | null): string[] {
  const tokens = [`AIWF:story:${contractId}`, `AIWF:event-contract:${contractId}`];
  const sid = String(sceneId || '').trim();
  if (sid && sid !== contractId) tokens.push(`AIWF:story:${sid}`);
  return tokens;
}

interface MapEventLite { id: number; note?: string }

/** 兼容旧数据：在地图里找过去带 AIWF note 的满指令事件。新写入不再生成这些标记。 */
function findStoryEvent(
  mapFile: string,
  contractId: string,
  sceneId?: string | null,
): { id: number; note: string } | null {
  const map = readJson(mapFile) as { events?: Array<MapEventLite | null> };
  const events = Array.isArray(map.events) ? map.events : [];
  const tokens = storyNoteTokens(contractId, sceneId);
  const matches = events.filter(
    (ev): ev is { id: number; note: string } => Boolean(
      ev && typeof ev.note === 'string' && tokens.some((token) => ev.note!.includes(token)),
    ),
  );
  if (!matches.length) return null;
  return matches.find((ev) => ev.note.includes('AIWF:unplaced')) || matches[0];
}

function stripInternalAiMarkers(note: string): string {
  return note
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('AIWF:'))
    .join('\n');
}

/** 放置新建事件时只保留用户/契约显式 note，不再自动追加 AIWF 标记。 */
export function buildPlacementNote(_contractId: string, extraNote?: string): string {
  const lines: string[] = [];
  for (const line of String(extraNote || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('AIWF:')) continue;
    if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
  }
  return lines.join('\n');
}

/** 读回地图里某事件并取内容指纹（用于记录放置基线）。 */
function fingerprintMapEvent(mapFile: string, eventId: number): string | undefined {
  try {
    const map = readJson(mapFile) as { events?: Array<Record<string, unknown> | null> };
    const event = (map.events || []).find((e) => e && (e as { id?: number }).id === eventId);
    return event ? eventContentFingerprint(event as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** 放置前把契约抽象页里的 commands 归一成编译器规范形态（含 change-items.operation 别名）。 */
export function normalizeAbstractPages(pages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return pages.map((page) => {
    if (!page || typeof page !== 'object' || !Array.isArray((page as { commands?: unknown }).commands)) return page;
    const { commands } = normalizeCommands((page as { commands: unknown }).commands);
    return { ...page, commands };
  });
}

function resolveRegistryPages(
  workflowRoot: string,
  project: string,
  contractId: string,
): Array<Record<string, unknown>> | null {
  const registry = loadRegistry(project, { runtimeRoot: path.join(workflowRoot, 'runtime') });
  const contract = registry.contracts.find((c) => c.id === contractId);
  if (!contract?.implementation || typeof contract.implementation !== 'object') return null;
  const trigger = (contract.rmmvTarget as { trigger?: string } | undefined)?.trigger;
  const pages = normalizeContractImplementation(contract.implementation as Record<string, unknown>, trigger);
  return pages ? normalizeAbstractPages(pages) : null;
}

function placeViaContractPatch(
  staged: ReturnType<typeof ensureStagedMap>,
  workflowRoot: string,
  project: string,
  mapId: number,
  payload: CreatePlacementEventPayload,
  pages: Array<Record<string, unknown>>,
) {
  const contractId = String(payload.contractId || '').trim() || extractSceneId(payload) || '';
  const note = contractId
    ? buildPlacementNote(contractId, payload.note)
    : stripInternalAiMarkers(String(payload.note || ''));
  const spec = {
    engine: 'rpg-maker-mv' as const,
    operations: [{
      op: 'add-map-event',
      mapId,
      name: payload.name,
      x: payload.x,
      y: payload.y,
      note,
      pages,
    }],
  };
  const patchReport = applyPatchToProject(staged.project, spec);
  const opReport = patchReport.operations[patchReport.operations.length - 1] as { eventId?: number };
  const eventId = Number(opReport?.eventId);
  return {
    op: 'create',
    mapId,
    eventId,
    event: null,
    staging: markStagedMapUpdated(workflowRoot, project, mapId),
    usedContractPatch: true,
  };
}

export function createPlacementEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  payload: CreatePlacementEventPayload,
) {
  const staged = ensureStagedMap(workflowRoot, project, mapId);
  const contractId = String(payload.contractId || '').trim() || extractSceneId(payload) || '';
  const sceneId = String(payload.sceneId || '').trim() || null;

  // 兼容路径：放置过去带 AIWF note 的满指令事件，并清除旧内部标记。
  if (contractId) {
    const existing = findStoryEvent(staged.mapFile, contractId, sceneId);
    if (existing) {
      const note = stripInternalAiMarkers(existing.note);
      const report = updateMapEvent({
        project: staged.project,
        mapId,
        eventId: existing.id,
        event: { x: payload.x, y: payload.y, note },
      });
      const contentHash = fingerprintMapEvent(staged.mapFile, existing.id);
      markPlacementInRegistry(workflowRoot, project, contractId, mapId, existing.id, payload.x, payload.y, contentHash);
      return {
        ...report,
        op: 'place',
        reusedExisting: true,
        staging: markStagedMapUpdated(workflowRoot, project, mapId),
      };
    }
  }

  // 次路径：payload 或注册表契约自带 commands[] / 抽象 pages → 编译落地。
  let pages: Array<Record<string, unknown>> | null = hasAbstractPages(payload.pages)
    ? (payload.pages as Array<Record<string, unknown>>)
    : null;
  if (!pages && contractId) {
    pages = resolveRegistryPages(workflowRoot, project, contractId);
  }
  if (pages && hasAbstractPages(pages)) {
    const report = placeViaContractPatch(staged, workflowRoot, project, mapId, payload, normalizeAbstractPages(pages));
    if (contractId && Number.isInteger(report.eventId)) {
      const contentHash = fingerprintMapEvent(staged.mapFile, report.eventId);
      markPlacementInRegistry(workflowRoot, project, contractId, mapId, report.eventId, payload.x, payload.y, contentHash);
    }
    return report;
  }

  // 兜底路径：契约尚无 implementation，放置一个空壳事件（与编辑器"新建事件"行为一致）。
  const note = contractId
    ? buildPlacementNote(contractId, payload.note)
    : stripInternalAiMarkers(String(payload.note || ''));
  const report = createMapEvent({
    project: staged.project,
    mapId,
    event: { name: payload.name || contractId || `EV`, x: payload.x, y: payload.y, note },
  });
  const eventId = report.eventId;
  if (contractId && Number.isInteger(eventId)) {
    const contentHash = fingerprintMapEvent(staged.mapFile, eventId);
    // 空壳放置：契约可能尚未进 JSON 注册表，跳过注册表回写（agent 补写 implementation 后 register 时会补上）。
    tryMarkPlacementInRegistry(workflowRoot, project, contractId, mapId, eventId, payload.x, payload.y, contentHash);
  }
  return {
    ...report,
    op: 'create',
    eventId,
    staging: markStagedMapUpdated(workflowRoot, project, mapId),
    usedContractPatch: false,
    shellOnly: true,
  };
}

/** 静默版：契约不在 JSON 注册表时直接跳过，不报错。用于空壳放置。 */
function tryMarkPlacementInRegistry(
  workflowRoot: string,
  project: string,
  contractId: string,
  mapId: number,
  eventId: number,
  x: number,
  y: number,
  contentHash?: string,
) {
  if (!contractId) return;
  const result = updateContractPlacement(project, contractId, {
    mapId, eventId, x, y, contentHash,
  }, { runtimeRoot: path.join(workflowRoot, 'runtime') });
  if (result.status === 'not-found') return; // 尚未注册，跳过
}

function markPlacementInRegistry(
  workflowRoot: string,
  project: string,
  contractId: string,
  mapId: number,
  eventId: number,
  x: number,
  y: number,
  contentHash?: string,
) {
  if (!contractId) return;
  const result = updateContractPlacement(project, contractId, {
    mapId,
    eventId,
    x,
    y,
    contentHash,
  }, { runtimeRoot: path.join(workflowRoot, 'runtime') });
  if (result.status === 'not-found') {
    throw new Error(
      `契约「${contractId}」未在 event-registry 中找到，无法回写放置状态。`
      + `请确认 contractId 与 mcp__rmmv__RmmvEvent action=registry.register 登记的一致。`,
    );
  }
}
