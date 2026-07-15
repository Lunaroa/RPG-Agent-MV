import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

import { ensureProcessStopped, renderProbeScript } from './nwjs-playable-probe.ts';

test('treats an RPG Maker error-printer message as a runtime JavaScript error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nwjs-playable-probe-'));
  const resultPath = path.join(root, 'result.json');
  const screenPath = path.join(root, 'screen.png');
  const callbacks: Array<() => void> = [];
  const window = {
    addEventListener: () => undefined,
    Graphics: {
      _errorPrinter: {
        textContent: "TypeError\nCannot read property 'length' of undefined",
      },
    },
  };

  try {
    vm.runInNewContext(renderProbeScript(resultPath, screenPath, 10_000), {
      window,
      document: {
        querySelector: () => null,
        createElement: () => ({}),
      },
      require: createRequire(import.meta.url),
      setTimeout: (callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimeout: () => undefined,
      Date,
      JSON,
      console,
    });

    assert.equal(callbacks.length, 1);
    callbacks.shift()?.();
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
      status?: string;
      errors?: Array<{ message?: string; source?: string }>;
    };
    assert.equal(result.status, 'fail');
    assert.equal(result.errors?.[0]?.message, "TypeError Cannot read property 'length' of undefined");
    assert.equal(result.errors?.[0]?.source, 'RMMV_ErrorPrinter');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not start a new game until the complete RPG Maker database is loaded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nwjs-playable-probe-'));
  const resultPath = path.join(root, 'result.json');
  const callbacks: Array<() => void> = [];
  let databaseLoaded = false;
  let setupNewGameCalls = 0;
  const window = {
    addEventListener: () => undefined,
    DataManager: {
      isDatabaseLoaded: () => databaseLoaded,
      setupNewGame: () => {
        setupNewGameCalls += 1;
      },
    },
    SceneManager: {
      _scene: null,
      goto: () => undefined,
    },
    Scene_Map: function Scene_Map() {},
    Graphics: {
      _errorPrinter: { textContent: '' },
    },
    $dataSystem: { startMapId: 1 },
    $dataMapInfos: [null, { id: 1 }],
  };

  try {
    vm.runInNewContext(renderProbeScript(resultPath, path.join(root, 'screen.png'), 10_000), {
      window,
      document: {
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({}),
      },
      require: createRequire(import.meta.url),
      setTimeout: (callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimeout: () => undefined,
      Date,
      JSON,
      console,
    });

    callbacks.shift()?.();
    assert.equal(setupNewGameCalls, 0);

    databaseLoaded = true;
    callbacks.shift()?.();
    assert.equal(setupNewGameCalls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('captures exceptions handled by the RPG Maker scene manager', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nwjs-playable-probe-'));
  const resultPath = path.join(root, 'result.json');
  const callbacks: Array<() => void> = [];
  let originalHandlerCalls = 0;
  const window = {
    addEventListener: () => undefined,
    DataManager: {
      isDatabaseLoaded: () => true,
      setupNewGame: () => undefined,
    },
    SceneManager: {
      _scene: null,
      goto: () => undefined,
      catchException: (_error?: unknown) => {
        originalHandlerCalls += 1;
      },
    },
    Scene_Map: function Scene_Map() {},
    Graphics: {
      _errorPrinter: { textContent: '' },
    },
    $dataSystem: { startMapId: 1 },
    $dataMapInfos: [null, { id: 1 }],
  };

  try {
    vm.runInNewContext(renderProbeScript(resultPath, path.join(root, 'screen.png'), 10_000), {
      window,
      document: {
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({}),
      },
      require: createRequire(import.meta.url),
      setTimeout: (callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clearTimeout: () => undefined,
      Date,
      JSON,
      console,
    });

    callbacks.shift()?.();
    window.SceneManager.catchException(new TypeError('scene update failed'));
    callbacks.shift()?.();

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
      status?: string;
      errors?: Array<{ message?: string; source?: string; stack?: string }>;
    };
    assert.equal(originalHandlerCalls, 1);
    assert.equal(result.status, 'fail');
    assert.equal(result.errors?.[0]?.message, 'scene update failed');
    assert.equal(result.errors?.[0]?.source, 'SceneManager.catchException');
    assert.match(result.errors?.[0]?.stack || '', /TypeError: scene update failed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports a bounded child process as exited after process-tree cleanup', () => {
  const child = childProcess.spawn(process.execPath, [
    '-e',
    'setInterval(() => undefined, 1000)',
  ], {
    windowsHide: true,
    stdio: 'ignore',
  });

  try {
    const result = ensureProcessStopped(child, 3_000);
    assert.equal(result.exited, true);
  } finally {
    if (child.pid && child.exitCode === null) {
      if (process.platform === 'win32') {
        childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        child.kill('SIGKILL');
      }
    }
  }
});
