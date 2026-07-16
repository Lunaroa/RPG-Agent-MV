import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  listProjects,
  getProjectCompatibilityWarning,
  refreshProjects,
  registerExternalProject,
  removeRegisteredProject,
  validateRmmvProjectDirectory,
} from './project-service.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import { RPG_MAKER_MZ_ENGINE_FILES } from '../rmmv/rpg-maker-engine.ts';

describe('desktop project service', () => {
  test('lists only strongly validated workspace projects', () => {
    const root = tempRoot();
    try {
      writeRmmvProject(path.join(root, 'projects', 'Project'), 'www-data', 'Default Game');
      fs.mkdirSync(path.join(root, 'projects', 'EmptyShell', 'data'), { recursive: true });

      const projects = listProjects(root);

      assert.equal(projects.length, 1);
      assert.equal(projects[0].name, 'Default Game');
      assert.equal(projects[0].path, 'projects/Project');
      assert.equal(projects[0].isDefault, true);
      assert.equal(projects[0].layout, 'www-data');
    } finally {
      removeRoot(root);
    }
  });

  test('registers an external flat data project and refreshes the list', () => {
    const root = tempRoot();
    const external = tempRoot();
    try {
      writeRmmvProject(external, 'data', 'External Game');

      const registered = registerExternalProject(root, external);
      const refreshed = refreshProjects(root);

      assert.equal(registered.path, path.resolve(external));
      assert.equal(registered.name, 'External Game');
      assert.equal(registered.source, 'registered');
      assert.equal(registered.layout, 'data');
      assert.deepEqual(refreshed.map((project) => project.path), [path.resolve(external)]);
    } finally {
      removeRoot(root);
      removeRoot(external);
    }
  });

  test('registers MZ 1.10.0 and exposes its engine canvas metadata', () => {
    const root = tempRoot();
    const external = tempRoot();
    try {
      writeMZProject(external, 'MZ Sample');

      const registered = registerExternalProject(root, external);
      const refreshed = refreshProjects(root);

      assert.equal(getProjectCompatibilityWarning(external), null);
      assert.equal(registered.engine, 'rpg-maker-mz');
      assert.equal(registered.engineVersion, '1.10.0');
      assert.equal(registered.engineVersionSupported, true);
      assert.equal(registered.tileSize, 32);
      assert.equal(registered.screenWidth, 960);
      assert.equal(registered.screenHeight, 540);
      assert.equal(refreshed[0]?.engine, 'rpg-maker-mz');
    } finally {
      removeRoot(root);
      removeRoot(external);
    }
  });

  test('registers an older recognizable MZ core and exposes a compatibility warning', () => {
    const root = tempRoot();
    const external = tempRoot();
    try {
      writeMZProject(external, 'MZ Sample', '1.9.0');

      const warning = getProjectCompatibilityWarning(external);
      const registered = registerExternalProject(root, external);

      assert.deepEqual(warning, {
        detectedVersion: '1.9.0',
        supportedVersion: '1.10.0',
        versionMismatch: true,
        encryptedResources: false,
        encryptedImages: false,
        encryptedAudio: false,
      });
      assert.equal(registered.engineVersion, '1.9.0');
      assert.equal(registered.engineVersionSupported, false);
    } finally {
      removeRoot(root);
      removeRoot(external);
    }
  });

  test('removes a registered external project without deleting the project directory', () => {
    const root = tempRoot();
    const external = tempRoot();
    try {
      writeRmmvProject(external, 'data', 'External Game');
      registerExternalProject(root, external);

      const projects = removeRegisteredProject(root, external);

      assert.deepEqual(projects, []);
      assert.equal(fs.existsSync(path.join(external, 'data', 'System.json')), true);
      assert.deepEqual(readRegistryProjectPaths(root), []);
    } finally {
      removeRoot(root);
      removeRoot(external);
    }
  });

  test('rejects removing an unknown registered path without changing the registry', () => {
    const root = tempRoot();
    const external = tempRoot();
    try {
      writeRmmvProject(external, 'data', 'External Game');
      registerExternalProject(root, external);

      assert.throws(
        () => withTestLanguage(() => removeRegisteredProject(root, path.join(path.dirname(external), 'missing-project'))),
        /不在注册列表/,
      );
      assert.deepEqual(readRegistryProjectPaths(root), [path.resolve(external)]);
      assert.deepEqual(refreshProjects(root).map((project) => project.path), [path.resolve(external)]);
    } finally {
      removeRoot(root);
      removeRoot(external);
    }
  });

  test('rejects removing workspace-discovered projects from the registry', () => {
    const root = tempRoot();
    try {
      writeRmmvProject(path.join(root, 'projects', 'Sample'), 'data', 'Workspace Game');

      assert.throws(
        () => withTestLanguage(() => removeRegisteredProject(root, 'projects/Sample')),
        /来自 projects\/ 目录/,
      );
      const projects = listProjects(root);
      assert.equal(projects.length, 1);
      assert.equal(projects[0].path, 'projects/Sample');
      assert.equal(projects[0].source, 'workspace');
    } finally {
      removeRoot(root);
    }
  });

  test('rejects directories missing required RMMV project files', () => {
    const root = tempRoot();
    try {
      fs.mkdirSync(path.join(root, 'data'), { recursive: true });
      fs.writeFileSync(path.join(root, 'data', 'System.json'), JSON.stringify({ switches: [], variables: [] }), 'utf8');

      assert.throws(
        () => withTestLanguage(() => validateRmmvProjectDirectory(root)),
        /MapInfos\.json/,
      );
    } finally {
      removeRoot(root);
    }
  });

  test('rejects MapInfos entries that point at missing map files', () => {
    const root = tempRoot();
    try {
      const dataDir = path.join(root, 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'System.json'), JSON.stringify({ switches: [], variables: [] }), 'utf8');
      fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Start' }]), 'utf8');

      assert.throws(
        () => withTestLanguage(() => validateRmmvProjectDirectory(root)),
        /Map001\.json/,
      );
    } finally {
      removeRoot(root);
    }
  });
});

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rpg-project-'));
}

function removeRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeRmmvProject(projectRoot: string, layout: 'www-data' | 'data', gameTitle: string): void {
  const dataDir = layout === 'www-data'
    ? path.join(projectRoot, 'www', 'data')
    : path.join(projectRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'System.json'), JSON.stringify({
    gameTitle,
    switches: ['', 'Intro'],
    variables: ['', 'Progress'],
  }), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([
    null,
    { id: 1, name: 'Start', parentId: 0, order: 1 },
  ]), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({
    width: 17,
    height: 13,
    tilesetId: 1,
    events: [null],
    data: [],
  }), 'utf8');
}

function writeMZProject(projectRoot: string, gameTitle: string, version = '1.10.0'): void {
  writeRmmvProject(projectRoot, 'data', gameTitle);
  fs.writeFileSync(path.join(projectRoot, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(projectRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${version}";\n`
      : relative === 'package.json'
        ? '{"main":"index.html"}'
        : relative === 'js/plugins.js'
          ? 'var $plugins = [];'
          : '';
    fs.writeFileSync(file, content, 'utf8');
  }
  for (const directory of ['audio', 'fonts', 'img', 'movies', 'effects', 'js/plugins']) {
    fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });
  }
  const systemFile = path.join(projectRoot, 'data', 'System.json');
  const system = JSON.parse(fs.readFileSync(systemFile, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(systemFile, JSON.stringify({
    ...system,
    tileSize: 32,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 960, screenHeight: 540 },
  }), 'utf8');
}

function readRegistryProjectPaths(root: string): string[] {
  const registryPath = path.join(root, 'runtime', 'project-registry.json');
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw) as { projects?: Array<{ path: string }> };
  return (registry.projects || []).map((project) => project.path);
}
