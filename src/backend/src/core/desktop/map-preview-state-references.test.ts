import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { buildMapPreviewStateCatalog } from './map-preview-state-references.ts';
import { writeStagedProjectJson } from './staging-service.ts';

test('collects only state structurally referenced by the effective map and its recursive common events', { concurrency: false }, async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-state-'));
  const project = path.join(workflowRoot, 'projects', 'sample');
  const dataDir = path.join(project, 'data');
  try {
    await bootstrapDatabase(workflowRoot, { importLegacyJson: false });
    fs.mkdirSync(dataDir, { recursive: true });
    writeJson(path.join(dataDir, 'System.json'), {
      switches: catalog('Switch', 16),
      variables: catalog('Variable', 16),
    });
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Map A', parentId: 0, order: 1 }]);
    writeJson(path.join(dataDir, 'Map001.json'), mapWithCommands([
      command(121, [15, 15, 0]),
      command(0, []),
    ]));
    writeJson(path.join(dataDir, 'CommonEvents.json'), [
      null,
      { id: 1, name: 'Source Common Event', trigger: 0, switchId: 0, list: [command(121, [15, 15, 0]), command(0, [])] },
    ]);

    writeStagedProjectJson(workflowRoot, project, 'data/Map001.json', mapWithCommands([
      command(121, [3, 4, 0]),
      command(101, ['', 0, 0]),
      command(122, [5, 6, 0, 1, 7]),
      command(111, [1, 8, 1, 9, 0]),
      command(412, []),
      command(205, [0, { list: [{ code: 27, parameters: [10] }, { code: 0, parameters: [] }], repeat: false, skippable: true, wait: false }]),
      command(117, [1]),
      command(0, []),
    ], {
      switch1Valid: true,
      switch1Id: 1,
      switch2Valid: true,
      switch2Id: 2,
      variableValid: true,
      variableId: 3,
    }));
    writeStagedProjectJson(workflowRoot, project, 'data/CommonEvents.json', [
      null,
      { id: 1, name: 'Nested A', trigger: 0, switchId: 0, list: [command(121, [11, 11, 0]), command(117, [2]), command(0, [])] },
      { id: 2, name: 'Nested B', trigger: 0, switchId: 0, list: [command(122, [12, 12, 0, 0, 1]), command(117, [1]), command(0, [])] },
      { id: 3, name: 'Unrelated Parallel', trigger: 2, switchId: 13, list: [command(121, [13, 13, 0]), command(0, [])] },
    ]);

    const catalogResult = buildMapPreviewStateCatalog(workflowRoot, project, 1);

    assert.deepEqual(catalogResult.switches, [1, 2, 3, 4, 10, 11].map((id) => ({ id, name: `Switch ${id}` })));
    assert.deepEqual(catalogResult.variables, [3, 5, 6, 7, 8, 9, 12].map((id) => ({ id, name: `Variable ${id}` })));
    assert.equal(catalogResult.switches.some((entry) => entry.id === 13 || entry.id === 15), false);
  } finally {
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

function mapWithCommands(list: unknown[], conditions: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    width: 20,
    height: 15,
    tilesetId: 1,
    data: [],
    events: [null, { id: 1, name: 'Event A', x: 1, y: 1, pages: [{ conditions, list }] }],
  };
}

function command(code: number, parameters: unknown[]): Record<string, unknown> {
  return { code, indent: 0, parameters };
}

function catalog(prefix: string, count: number): Array<string | null> {
  return [null, ...Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`)];
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}
