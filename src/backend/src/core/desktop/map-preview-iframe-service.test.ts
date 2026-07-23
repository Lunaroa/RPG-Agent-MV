import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { MapPreviewRuntimeCommand, MapPreviewRuntimeEvent, MapPreviewSession } from '../../../../contract/types.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { MapPreviewIframeService } from './map-preview-iframe-service.ts';

test('keeps one isolated iframe runtime warm across suspend and resume', async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-workflow-'));
  const project = createMZProject(workflowRoot);
  const statuses: MapPreviewSession[] = [];
  const commands: MapPreviewRuntimeCommand[] = [];
  const roots = new Map<string, string>();
  let registeredUrl = '';
  let isolatedRoot = '';
  const service = new MapPreviewIframeService(workflowRoot, {
    onStatus: (session) => statuses.push(session),
    onCommand: (command) => commands.push(command),
    registerPreviewRoot(key, resourceRoot) {
      roots.set(key, resourceRoot);
      isolatedRoot = resourceRoot;
      registeredUrl = `rpg-agent-preview://${key}/index.html`;
      return registeredUrl;
    },
    unregisterPreviewRoot(key) { roots.delete(key); },
    verifyFrameIsolation: (url) => url === registeredUrl,
  });

  try {
    await bootstrapDatabase(workflowRoot, { importLegacyJson: false });
    const preparing = await service.start(project, 1, { switches: { '2': true }, variables: { '3': 8 }, selfSwitches: {} });
    assert.equal(preparing.session?.status, 'preparing');
    assert.equal(preparing.session?.loadProgress?.stage, 'starting-worker');
    await waitForPreviewStatus(service, 'starting');
    const started = service.current();
    assert.equal(started.session?.status, 'starting');
    assert.equal(started.session?.transportMode, 'iframe');
    assert.equal(started.session?.eventExecutionEnabled, false);
    assert.equal(started.session?.iframeUrl, registeredUrl);
    assert.equal(roots.size, 1);
    assert.notEqual(path.resolve(isolatedRoot), path.resolve(project));
    assert.doesNotMatch(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), /rpg-agent-preview-marker/);
    assert.match(fs.readFileSync(path.join(isolatedRoot, 'index.html'), 'utf8'), /rpg-agent-preview-marker/);

    const identity = injectedIdentity(isolatedRoot);
    service.handleRuntimeEvent(runtimeEvent(identity, started.session!, 'ready'));
    assert.equal(service.current().session?.status, 'running');
    assert.equal(service.current().session?.mapPixelWidth, 960);
    assert.equal(service.current().session?.mapPixelHeight, 720);
    assert.equal(service.current().session?.variableValues?.['3'], 'preview text');
    assert.deepEqual(service.current().session?.eventStates, [{ id: 4, x: 9, y: 6, active: false, visible: false }]);

    service.setEventExecution(true);
    assert.deepEqual(commands.at(-1)?.command, { type: 'set-event-execution', operationId: 1, enabled: true });
    assert.equal(service.current().session?.eventExecutionEnabled, true);
    assert.equal(service.current().session?.executionCheckpointMapId, 1);
    service.handleRuntimeEvent({
      ...runtimeEvent(identity, service.current().session!, 'input-waiting'),
      input: 'choice',
      sourceMapId: 1,
      eventId: 4,
    });
    assert.equal(service.current().session?.inputWait?.kind, 'choice');
    service.sendInput('ok');
    assert.deepEqual(commands.at(-1)?.command, { type: 'input-key', operationId: 1, key: 'ok' });
    service.handleRuntimeEvent(runtimeEvent(identity, service.current().session!, 'input-ended'));
    assert.equal(service.current().session?.inputWait?.kind, 'none');

    service.handleRuntimeEvent({
      ...runtimeEvent(identity, service.current().session!, 'runtime-map-changed'),
      mapId: 2,
      mapPixelWidth: 720,
      mapPixelHeight: 480,
      eventExecutionEnabled: true,
      checkpointMapId: 1,
    });
    assert.equal(service.current().session?.mapId, 2);
    assert.equal(service.current().session?.mapPixelWidth, 720);
    assert.equal(service.current().session?.mapChangeSource, 'preview-runtime');
    assert.equal(service.current().session?.executionCheckpointMapId, 1);

    service.setEventExecution(false);
    assert.deepEqual(commands.at(-1)?.command, { type: 'set-event-execution', operationId: 1, enabled: false });
    service.handleRuntimeEvent({
      ...runtimeEvent(identity, service.current().session!, 'runtime-map-changed'),
      mapId: 1,
      eventExecutionEnabled: false,
      checkpointMapId: 1,
    });
    assert.equal(service.current().session?.mapId, 1);
    assert.equal(service.current().session?.mapChangeSource, 'preview-runtime');

    service.setSelfSwitch(1, 4, 'A', true);
    assert.deepEqual(commands.at(-1)?.command, { type: 'set-self-switch', operationId: 1, key: '1,4,A', value: true });
    assert.throws(() => service.setSelfSwitch(2, 4, 'A', true), /current preview map/);
    service.evaluate('request-1', '$gameMap.mapId()');
    assert.deepEqual(commands.at(-1)?.command, { type: 'evaluate', operationId: 1, requestId: 'request-1', code: '$gameMap.mapId()' });
    service.handleRuntimeEvent({ ...runtimeEvent(identity, started.session!, 'console'), entry: { id: 1 } });
    assert.equal(service.current().session?.status, 'running');

    await service.suspend();
    assert.equal(commands.at(-1)?.command.type, 'suspend');
    service.handleRuntimeEvent(runtimeEvent(identity, service.current().session!, 'suspended'));
    assert.equal(service.current().session?.status, 'suspended');

    const firstUrl = service.current().session?.iframeUrl;
    await service.resume({
      project,
      mapId: 1,
      mapRevision: service.current().session?.mapRevision,
      overrides: { switches: { '2': false }, variables: { '3': 9 }, selfSwitches: {} },
    });
    const resumed = service.current().session!;
    assert.equal(resumed.status, 'resuming');
    assert.equal(resumed.operationId, 2);
    assert.equal(resumed.iframeUrl, firstUrl);
    assert.equal(roots.size, 1);
    assert.equal(commands.at(-1)?.command.type, 'resume');
    assert.equal(commands.at(-1)?.command.purpose, 'warm');

    service.handleRuntimeEvent(runtimeEvent(identity, resumed, 'ready'));
    assert.equal(service.current().session?.status, 'running');
    assert.ok(statuses.some((session) => session.status === 'suspended'));

    await service.stop();
    assert.equal(service.current().session?.status, 'stopped');
    assert.equal(roots.size, 0);
    assert.equal(fs.existsSync(isolatedRoot), false);
  } finally {
    service.shutdownSync();
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

function injectedIdentity(resourceRoot: string): { sessionId: string; channelToken: string } {
  const source = fs.readFileSync(path.join(resourceRoot, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
  const match = source.match(/var config = (\{[^\n]+\});/);
  assert.ok(match);
  const config = JSON.parse(match[1]) as { sessionId: string; channelToken: string };
  return { sessionId: config.sessionId, channelToken: config.channelToken };
}

function runtimeEvent(
  identity: { sessionId: string; channelToken: string },
  session: MapPreviewSession,
  phase: MapPreviewRuntimeEvent['phase'],
): MapPreviewRuntimeEvent {
  return {
    kind: 'rpg-agent-map-preview',
    ...identity,
    operationId: session.operationId || 1,
    mapId: session.mapId,
    mapRevision: session.mapRevision || '',
    phase,
    mapPixelWidth: 960,
    mapPixelHeight: 720,
    switchValues: { '2': true },
    variableValues: { '3': 'preview text' },
    unsupportedVariableTypes: { '8': 'object' },
    selfSwitchValues: { '3,4,A': true },
    eventStates: [{ id: 4, x: 9, y: 6, active: false, visible: false }],
  };
}

async function waitForPreviewStatus(
  service: MapPreviewIframeService,
  status: MapPreviewSession['status'],
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (service.current().session?.status !== status) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for map preview status ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createMZProject(workflowRoot: string): string {
  const project = path.join(workflowRoot, 'projects', 'sample');
  const data = path.join(project, 'data');
  const scripts = path.join(project, 'js');
  fs.mkdirSync(path.join(scripts, 'plugins'), { recursive: true });
  for (const directory of ['audio', 'fonts', 'img', 'movies', 'effects']) fs.mkdirSync(path.join(project, directory), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ 1.10.0', 'utf8');
  fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><script src="js/main.js"></script>', 'utf8');
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"sample","main":"index.html"}', 'utf8');
  fs.writeFileSync(path.join(scripts, 'rmmz_core.js'), 'Utils.RPGMAKER_NAME = "MZ"; Utils.RPGMAKER_VERSION = "1.10.0";', 'utf8');
  for (const name of ['rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js']) {
    fs.writeFileSync(path.join(scripts, name), '', 'utf8');
  }
  fs.writeFileSync(path.join(scripts, 'plugins.js'), 'var $plugins = [];', 'utf8');
  fs.writeFileSync(path.join(scripts, 'main.js'), 'const scriptUrls = ["js/rmmz_core.js", "js/plugins.js"];', 'utf8');
  fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624 },
  }), 'utf8');
  fs.writeFileSync(path.join(data, 'MapInfos.json'), JSON.stringify([
    null,
    { id: 1, name: 'Sample A', parentId: 0, order: 1, expanded: false, scrollX: 0, scrollY: 0 },
    { id: 2, name: 'Sample B', parentId: 0, order: 2, expanded: false, scrollX: 0, scrollY: 0 },
  ]), 'utf8');
  fs.writeFileSync(path.join(data, 'Map001.json'), JSON.stringify({ width: 20, height: 15, tilesetId: 1, events: [null], data: [] }), 'utf8');
  fs.writeFileSync(path.join(data, 'Map002.json'), JSON.stringify({ width: 15, height: 10, tilesetId: 1, events: [null], data: [] }), 'utf8');
  return project;
}
