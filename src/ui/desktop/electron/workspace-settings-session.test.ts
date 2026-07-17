import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { WorkspaceSettingsSession } from './workspace-settings-session.ts';

describe('workspace settings session', () => {
  test('keeps background validation changes in memory', () => {
    const persisted = { lastProjectPath: 'projects/sample', layout: { agentPanelOpen: true } };
    const writes: unknown[] = [];
    const session = new WorkspaceSettingsSession(true);
    session.initialize(persisted);

    const next = session.patch(
      { lastProjectPath: 'projects/another', layout: { agentPanelOpen: false } },
      () => persisted,
      (value) => writes.push(value),
    );

    assert.equal(next.lastProjectPath, 'projects/another');
    assert.equal(next.layout?.agentPanelOpen, false);
    assert.equal(session.read(() => persisted).lastProjectPath, 'projects/another');
    assert.deepEqual(writes, []);
    assert.equal(persisted.lastProjectPath, 'projects/sample');
  });

  test('keeps normal desktop settings persistent', () => {
    let persisted = { lastProjectPath: 'projects/sample' };
    const session = new WorkspaceSettingsSession(false);
    session.initialize(persisted);

    const next = session.patch(
      { lastProjectPath: 'projects/another' },
      () => persisted,
      (value) => { persisted = value as typeof persisted; },
    );

    assert.equal(next.lastProjectPath, 'projects/another');
    assert.equal(persisted.lastProjectPath, 'projects/another');
  });
});
