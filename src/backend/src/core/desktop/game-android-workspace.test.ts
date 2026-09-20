import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertAndroidToolchainPath, withAndroidShellWorkspace } from './game-android-shell-service.ts';
import { installAndroidToolchain, inspectAndroidToolchain } from './game-android-toolchain-service.ts';
import { preflightAndroidBuild } from './game-android-build-service.ts';
import { GameBuildProcessCanceledError, javaToolArguments } from './game-build-process-service.ts';
import type { GameBuildPreset } from '../../../../contract/game-release.ts';

test('Android workspace is independent of Unicode output and removes only its own temporary project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-android-workspace-'));
  const output = path.join(root, '中文 输出');
  const source = path.join(root, '示例 工程');
  const toolchain = path.join(root, 'toolchain');
  let workspace = '';
  try {
    fs.mkdirSync(output);
    fs.mkdirSync(source);
    fs.mkdirSync(toolchain);
    fs.writeFileSync(path.join(source, 'asset.txt'), '游戏资源', 'utf8');
    const result = await withAndroidShellWorkspace(toolchain, async directory => {
      workspace = directory;
      assert.doesNotMatch(directory, /[^\x20-\x7e]/);
      assert.equal(path.dirname(directory), fs.realpathSync.native(toolchain));
      fs.copyFileSync(path.join(source, 'asset.txt'), path.join(directory, 'asset.txt'));
      await withAndroidShellWorkspace(toolchain, async second => {
        assert.notEqual(directory, second);
        assert.ok(fs.existsSync(directory));
      });
      fs.copyFileSync(path.join(directory, 'asset.txt'), path.join(output, 'artifact.txt'));
      return 'built';
    });
    assert.equal(result, 'built');
    assert.equal(fs.existsSync(workspace), false);
    assert.equal(fs.readFileSync(path.join(source, 'asset.txt'), 'utf8'), '游戏资源');
    assert.equal(fs.readFileSync(path.join(output, 'artifact.txt'), 'utf8'), '游戏资源');
    assert.deepEqual(fs.readdirSync(toolchain), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Android workspace cleans up on failure and cancellation without hiding the original error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-android-failure-'));
  try {
    for (const failure of [new Error('sample compilation failed'), new GameBuildProcessCanceledError()]) {
      await assert.rejects(withAndroidShellWorkspace(root, async directory => {
        fs.writeFileSync(path.join(directory, 'partial.bin'), 'partial', 'utf8');
        throw failure;
      }), error => error === failure);
      assert.deepEqual(fs.readdirSync(root), []);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Android workspace preserves compilation error when cleanup also fails', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-android-cleanup-'));
  const original = new Error('sample compiler failure');
  const cleanup = new Error('sample cleanup failure');
  const mock = t.mock.method(fs.promises, 'rm', async () => { throw cleanup; });
  try {
    await assert.rejects(withAndroidShellWorkspace(root, async () => { throw original; }), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [original, cleanup]);
      assert.match(error.message, /sample compiler failure/);
      return true;
    });
  } finally { mock.mock.restore(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('Android workspace rejects unsupported toolchain paths during inspection preflight and before download', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-android-path-'));
  const unsupported = path.join(root, '中文 工具链');
  try {
    assert.throws(() => assertAndroidToolchainPath(unsupported), /only ASCII/);
    const status = inspectAndroidToolchain(root, unsupported);
    assert.equal(status.configured, false);
    assert.ok(status.missing.some(item => item.includes('only ASCII')));
    const settings = { presets: [], androidToolchainRoot: unsupported };
    const checked = preflightAndroidBuild(root, root, settings, {} as GameBuildPreset);
    assert.ok(checked.blockers.some(item => item.includes('only ASCII')));
    await assert.rejects(installAndroidToolchain(root, { root: unsupported, acceptAndroidSdkLicense: true }), /only ASCII/);
    assert.deepEqual(fs.readdirSync(root), [], 'Preflight and installer must fail before writing files or downloading tools');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Android workspace rejects ASCII aliases that resolve to a Unicode compiler directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-android-alias-'));
  try {
    const target = path.join(root, '中文 工具链');
    fs.mkdirSync(target);
    const alias = path.join(root, 'toolchain');
    fs.symlinkSync(target, alias, 'junction');
    assert.throws(() => assertAndroidToolchainPath(alias), /only ASCII/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Android Java tools declare UTF-8 before launcher arguments without changing native tools', () => {
  const root = path.join(os.tmpdir(), 'sample-jdk', 'bin');
  const args = ['-jar', 'sample.jar'];
  assert.deepEqual(javaToolArguments(path.join(root, 'java.exe'), args), ['-Dfile.encoding=UTF-8', ...args]);
  assert.deepEqual(javaToolArguments(path.join(root, 'keytool.exe'), args), ['-J-Dfile.encoding=UTF-8', ...args]);
  assert.deepEqual(javaToolArguments(path.join(root, 'aapt2.exe'), args), args);
  assert.deepEqual(args, ['-jar', 'sample.jar']);
});

test('Android installer accepts a selected empty directory but never replaces unrelated files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-android-install-root-'));
  const selected = path.join(root, 'toolchain');
  try {
    fs.mkdirSync(selected);
    await assert.rejects(installAndroidToolchain(root, { root: selected, acceptAndroidSdkLicense: true }, { isCanceled: () => true }), GameBuildProcessCanceledError);
    assert.deepEqual(fs.readdirSync(root), ['toolchain']);
    assert.deepEqual(fs.readdirSync(selected), []);
    fs.writeFileSync(path.join(selected, 'keep.txt'), 'sample existing file', 'utf8');
    await assert.rejects(installAndroidToolchain(root, { root: selected, acceptAndroidSdkLicense: true }), /not managed/);
    assert.equal(fs.readFileSync(path.join(selected, 'keep.txt'), 'utf8'), 'sample existing file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
