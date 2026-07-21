import type {
  MapPreviewFrame,
  MapPreviewOverrides,
  MapPreviewResult,
  MapPreviewResumeRequest,
  MapPreviewRuntimeEvent,
  MapPreviewViewRequest,
} from '../../../contract/types.ts';
import { toIpcPayload } from './ipc-serialize.ts';

export const MAP_PREVIEW_IPC_CHANNELS = [
  'mapPreview:start',
  'mapPreview:current',
  'mapPreview:stop',
  'mapPreview:suspend',
  'mapPreview:resume',
  'mapPreview:selectMap',
  'mapPreview:panCamera',
  'mapPreview:setSwitch',
  'mapPreview:setVariable',
  'mapPreview:resetOverrides',
  'mapPreview:replaceOverrides',
  'mapPreview:ackFrame',
  'mapPreview:setView',
  'mapPreview:runtimeEvent',
] as const;

export function mapPreviewFrameIpcPayload(frame: MapPreviewFrame): MapPreviewFrame {
  return {
    sessionId: frame.sessionId,
    operationId: frame.operationId,
    mapId: frame.mapId,
    sequence: frame.sequence,
    generation: frame.generation,
    kind: frame.kind,
    mime: frame.mime,
    mapPixelWidth: frame.mapPixelWidth,
    mapPixelHeight: frame.mapPixelHeight,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    outputWidth: frame.outputWidth,
    outputHeight: frame.outputHeight,
    mapRevision: frame.mapRevision,
    data: frame.data,
  };
}

interface IpcMainLike {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

interface MapPreviewServiceLike {
  start(project: string, mapId: number, overrides?: MapPreviewOverrides): Promise<MapPreviewResult>;
  current(): MapPreviewResult;
  stop(): Promise<MapPreviewResult>;
  suspend(): Promise<MapPreviewResult>;
  resume(request: MapPreviewResumeRequest): Promise<MapPreviewResult>;
  selectMap(mapId: number, overrides?: MapPreviewOverrides): MapPreviewResult;
  panCamera(deltaX: number, deltaY: number): MapPreviewResult;
  setSwitch(id: number, value: boolean): MapPreviewResult;
  setVariable(id: number, value: number): MapPreviewResult;
  resetOverrides(): MapPreviewResult;
  replaceOverrides(overrides: MapPreviewOverrides): MapPreviewResult;
  ackFrame(sequence: number): MapPreviewResult;
  setView(request: MapPreviewViewRequest): MapPreviewResult;
  handleRuntimeEvent(event: MapPreviewRuntimeEvent): MapPreviewResult;
}

export interface MapPreviewIpcDependencies {
  getLastProject(): string;
  resolveProject(project: string): string;
}

export function registerMapPreviewIpcHandlers(
  ipc: IpcMainLike,
  service: MapPreviewServiceLike,
  dependencies: MapPreviewIpcDependencies,
): void {
  ipc.handle('mapPreview:start', async (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:start request');
    assertFields(body, ['project', 'mapId', 'overrides'], 'mapPreview:start');
    const requestedProject = typeof body.project === 'string' && body.project.trim()
      ? body.project.trim()
      : dependencies.getLastProject().trim();
    if (!requestedProject) throw new Error('Select an RPG Maker project before starting map preview.');
    const project = dependencies.resolveProject(requestedProject);
    return toIpcPayload(await service.start(project, positiveInteger(body.mapId, 'mapPreview:start mapId'), previewOverrides(body.overrides)));
  });
  ipc.handle('mapPreview:current', () => toIpcPayload(service.current()));
  ipc.handle('mapPreview:stop', async () => toIpcPayload(await service.stop()));
  ipc.handle('mapPreview:suspend', async () => toIpcPayload(await service.suspend()));
  ipc.handle('mapPreview:resume', async (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:resume request');
    assertFields(body, ['project', 'mapId', 'overrides', 'mapRevision', 'forceReload'], 'mapPreview:resume');
    const requestedProject = typeof body.project === 'string' && body.project.trim()
      ? body.project.trim()
      : dependencies.getLastProject().trim();
    if (!requestedProject) throw new Error('Select an RPG Maker project before resuming map preview.');
    const project = dependencies.resolveProject(requestedProject);
    if (body.forceReload !== undefined && typeof body.forceReload !== 'boolean') {
      throw new Error('mapPreview:resume forceReload must be boolean.');
    }
    return toIpcPayload(await service.resume({
      project,
      mapId: positiveInteger(body.mapId, 'mapPreview:resume mapId'),
      overrides: previewOverrides(body.overrides),
      ...(typeof body.mapRevision === 'string' && body.mapRevision.trim() ? { mapRevision: body.mapRevision.trim() } : {}),
      ...(body.forceReload === true ? { forceReload: true } : {}),
    }));
  });
  ipc.handle('mapPreview:selectMap', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:selectMap request');
    assertFields(body, ['mapId', 'overrides'], 'mapPreview:selectMap');
    return toIpcPayload(service.selectMap(positiveInteger(body.mapId, 'mapPreview:selectMap mapId'), previewOverrides(body.overrides)));
  });
  ipc.handle('mapPreview:panCamera', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:panCamera request');
    assertFields(body, ['deltaX', 'deltaY'], 'mapPreview:panCamera');
    return toIpcPayload(service.panCamera(finiteNumber(body.deltaX, 'deltaX'), finiteNumber(body.deltaY, 'deltaY')));
  });
  ipc.handle('mapPreview:setSwitch', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:setSwitch request');
    assertFields(body, ['id', 'value'], 'mapPreview:setSwitch');
    if (typeof body.value !== 'boolean') throw new Error('mapPreview:setSwitch value must be boolean.');
    return toIpcPayload(service.setSwitch(positiveInteger(body.id, 'switch id'), body.value));
  });
  ipc.handle('mapPreview:setVariable', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:setVariable request');
    assertFields(body, ['id', 'value'], 'mapPreview:setVariable');
    return toIpcPayload(service.setVariable(positiveInteger(body.id, 'variable id'), finiteNumber(body.value, 'variable value')));
  });
  ipc.handle('mapPreview:resetOverrides', () => toIpcPayload(service.resetOverrides()));
  ipc.handle('mapPreview:replaceOverrides', (_event, request?: unknown) => (
    toIpcPayload(service.replaceOverrides(previewOverrides(request)))
  ));
  ipc.handle('mapPreview:ackFrame', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:ackFrame request');
    assertFields(body, ['sequence'], 'mapPreview:ackFrame');
    return toIpcPayload(service.ackFrame(positiveInteger(body.sequence, 'frame sequence')));
  });
  ipc.handle('mapPreview:setView', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:setView request');
    assertFields(body, ['x', 'y', 'width', 'height', 'scale'], 'mapPreview:setView');
    return toIpcPayload(service.setView({
      x: finiteNumber(body.x, 'view x'),
      y: finiteNumber(body.y, 'view y'),
      width: positiveNumber(body.width, 'view width'),
      height: positiveNumber(body.height, 'view height'),
      scale: positiveNumber(body.scale, 'view scale'),
    }));
  });
  ipc.handle('mapPreview:runtimeEvent', (_event, request?: unknown) => {
    const body = record(request, 'mapPreview:runtimeEvent request');
    return toIpcPayload(service.handleRuntimeEvent(body as unknown as MapPreviewRuntimeEvent));
  });
}

export function cleanupMapPreviewIpcHandlers(ipc: IpcMainLike): void {
  for (const channel of MAP_PREVIEW_IPC_CHANNELS) ipc.removeHandler(channel);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertFields(body: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} does not accept field(s): ${unknown.join(', ')}`);
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function previewOverrides(value: unknown): MapPreviewOverrides {
  if (value == null) return { switches: {}, variables: {} };
  const body = record(value, 'map preview overrides');
  assertFields(body, ['switches', 'variables'], 'map preview overrides');
  const switches = stateRecord(body.switches, 'switches', (entry) => typeof entry === 'boolean');
  const variables = stateRecord(body.variables, 'variables', (entry) => typeof entry === 'number' && Number.isFinite(entry));
  return { switches: switches as Record<string, boolean>, variables: variables as Record<string, number> };
}

function stateRecord(
  value: unknown,
  label: string,
  validValue: (entry: unknown) => boolean,
): Record<string, unknown> {
  if (value == null) return {};
  const source = record(value, `map preview ${label}`);
  const result: Record<string, unknown> = {};
  for (const [rawId, entry] of Object.entries(source)) {
    const id = positiveInteger(rawId, `${label} id`);
    if (!validValue(entry)) throw new Error(`map preview ${label} value for ${id} is invalid.`);
    result[String(id)] = entry;
  }
  return result;
}
