import { ElMessage } from 'element-plus';
import { eventRegistry, events as eventsApi } from '../api/client';
import { useProjectStore } from '../stores/project';
import type { EventPlacementFocus } from '../stores/eventPlacementAsk';
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import {
  buildPlacementContractNote,
  hasAbstractContractPages,
  normalizeContractPagesFromImpl,
} from '../utils/placementEventDraft';
import { toPlacementError } from '../utils/placementErrors';
import { translate } from '../i18n/messages.ts'

export interface PlaceContractOptions {
  focus: EventPlacementFocus;
  mapId: number;
  cell: { x: number; y: number };
  applyContractPages: boolean;
  language?: ProductLanguage;
}

export async function placeContractAtCell(options: PlaceContractOptions): Promise<{
  eventId: number;
  usedContractPatch: boolean;
  shellOnly?: boolean;
} | null> {
  const projectStore = useProjectStore();
  const language = normalizeProductLanguage(options.language ?? DEFAULT_PRODUCT_LANGUAGE);
  const project = projectStore.currentProject;
  if (!project) throw new Error(translate('placement.atCell.selectProjectFirst', language));
  const { focus, mapId, cell, applyContractPages } = options;

  let contractPayload: {
    pages?: Array<Record<string, unknown>>;
    note?: string;
    eventName?: string;
    trigger?: string;
  } | null = null;

  if (applyContractPages) {
    try {
      const shown = await eventRegistry.showContract(project, focus.contractId) as {
        status?: string;
        contract?: Record<string, unknown>;
      };
      if (shown.status === 'ok' && shown.contract) {
        const impl = shown.contract.implementation as {
          pages?: Array<Record<string, unknown>>;
          commands?: unknown[];
          note?: string;
        } | undefined;
        const target = shown.contract.rmmvTarget as { eventName?: string; trigger?: string } | undefined;
        const pages = normalizeContractPagesFromImpl(
          impl,
          focus.trigger || target?.trigger,
        );
        contractPayload = {
          pages,
          note: typeof impl?.note === 'string' ? impl.note : undefined,
          eventName: target?.eventName,
          trigger: focus.trigger || target?.trigger,
        };
      }
    } catch {
      ElMessage.warning(translate('placement.atCell.registryUnavailable', language));
    }
  }

  const pages = hasAbstractContractPages(contractPayload?.pages) ? contractPayload?.pages : undefined;
  const note = buildPlacementContractNote(focus.contractId, contractPayload?.note);
  const name = String(focus.eventName || contractPayload?.eventName || focus.contractId);

  try {
    const report = await eventsApi.createFromPlacement(mapId, {
      name,
      x: cell.x,
      y: cell.y,
      note,
      contractId: focus.contractId,
      sceneId: focus.sceneId,
      pages,
    }, project);
    const eventId = Number(report.eventId);
    if (!eventId) throw new Error(translate('placement.atCell.noEventId', language));
    return {
      eventId,
      usedContractPatch: Boolean(report.usedContractPatch || (report as { reusedExisting?: boolean }).reusedExisting),
      shellOnly: Boolean((report as { shellOnly?: boolean }).shellOnly),
    };
  } catch (error) {
    throw toPlacementError(error, { contractId: focus.contractId, eventName: name }, language);
  }
}

export function placementCellHint(cell: { x: number; y: number } | null, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  if (!cell) return translate('placement.atCell.hoverFirst', language);
  return translate('placement.atCell.createAt', language, { x: cell.x, y: cell.y });
}
