import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { RPG_MAKER_MZ_ENGINE_FILES } from '../rmmv/rpg-maker-engine.ts';
import { inspectUiDesignerProjectProfile } from './ui-designer-project-service.ts';

describe('ui-designer project profile', () => {
  test('maps an MV manifest to the 816x624 default canvas without path fields', () => {
    const project = tempProject();
    try {
      writeMvProject(project);

      const profile = inspectUiDesignerProjectProfile(project);

      assert.deepEqual(profile, {
        engine: 'MV',
        engineVersion: null,
        screenWidth: 816,
        screenHeight: 624,
        uiAreaWidth: 816,
        uiAreaHeight: 624,
      });
      assert.deepEqual(Object.keys(profile).sort(), [
        'engine', 'engineVersion', 'screenHeight', 'screenWidth', 'uiAreaHeight', 'uiAreaWidth',
      ]);
    } finally {
      removeProject(project);
    }
  });

  test('passes through MZ advanced canvas dimensions', () => {
    const project = tempProject();
    try {
      writeMzProject(project, '1.10.0', {
        screenWidth: 1280,
        screenHeight: 720,
        uiAreaWidth: 1180,
        uiAreaHeight: 640,
      });

      assert.deepEqual(inspectUiDesignerProjectProfile(project), {
        engine: 'MZ',
        engineVersion: '1.10.0',
        screenWidth: 1280,
        screenHeight: 720,
        uiAreaWidth: 1180,
        uiAreaHeight: 640,
      });
    } finally {
      removeProject(project);
    }
  });

  test('fails fast when no project or an incompatible MZ version is selected', () => {
    assert.throws(
      () => inspectUiDesignerProjectProfile(''),
      (error: unknown) => (error as { code?: string }).code === 'UI_DESIGNER_PROJECT_REQUIRED',
    );

    const project = tempProject();
    try {
      writeMzProject(project, '1.9.0', {
        screenWidth: 960,
        screenHeight: 540,
        uiAreaWidth: 960,
        uiAreaHeight: 540,
      });
      assert.throws(
        () => inspectUiDesignerProjectProfile(project),
        (error: unknown) => (error as { code?: string }).code === 'UI_DESIGNER_PROJECT_ENGINE_UNSUPPORTED',
      );
    } finally {
      removeProject(project);
    }
  });
});

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-profile-'));
}

function removeProject(project: string): void {
  fs.rmSync(project, { recursive: true, force: true });
}

function writeMvProject(project: string): void {
  const data = path.join(project, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ gameTitle: 'Sample Game' }), 'utf8');
  fs.writeFileSync(path.join(data, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Sample Scene' }]), 'utf8');
}

function writeMzProject(
  project: string,
  version: string,
  advanced: { screenWidth: number; screenHeight: number; uiAreaWidth: number; uiAreaHeight: number },
): void {
  writeMvProject(project);
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const target = path.join(project, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${version}";\n`
      : relative === 'package.json'
        ? '{"main":"index.html"}'
        : relative === 'js/plugins.js'
          ? 'var $plugins = [];'
          : '';
    fs.writeFileSync(target, content, 'utf8');
  }
  const system = {
    tileSize: 32,
    faceSize: 144,
    iconSize: 32,
    advanced,
  };
  fs.writeFileSync(path.join(project, 'data', 'System.json'), JSON.stringify(system), 'utf8');
}
