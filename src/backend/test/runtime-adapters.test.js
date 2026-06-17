import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { DEFAULT_AGENT_EXECUTION_ENGINE } from '../../contract/types.ts';
import {
  buildRuntimeCommandForEngine,
  defaultEngine,
  listAdapters,
  listExecutionEngineMeta,
  probeAgentExecution,
  resolveRuntimeReadinessBlocker,
} from '../src/core/workflow/agent/runtime-adapters/index.ts';
import {
  buildRmmvMcpConfig,
  buildRmmvMcpConfigJson,
  RMMV_MCP_ALLOWED_TOOLS,
} from '../src/core/workflow/agent/runtime-adapters/build-rmmv-mcp-config.ts';

function withOpencodeCli(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-adapter-'));
  const cliPath = path.join(root, 'runtime', 'out', 'opencode', 'windows-x64', 'opencode.exe');
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, 'binary\n', 'utf8');
  try {
    return callback(root, cliPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('runtime-adapters', () => {
  test('defaultEngine matches shared contract default', () => {
    assert.equal(defaultEngine(), DEFAULT_AGENT_EXECUTION_ENGINE);
    assert.equal(defaultEngine(), 'opencode');
  });

  test('only opencode adapter is registered', () => {
    assert.deepEqual(listAdapters().map((adapter) => adapter.id), ['opencode']);
    assert.deepEqual(listExecutionEngineMeta().map((engine) => engine.id), ['opencode']);
  });

  test('opencode adapter builds serve command snapshot', () => withOpencodeCli((workflowRoot, cliPath) => {
    const cmd = buildRuntimeCommandForEngine(
      'opencode',
      { runtime: 'opencode', model: 'deepseek-v4-flash', provider: 'deepseek' },
      { userPrompt: 'user prompt', files: [], thinkingLevel: null, workflowRoot },
    );

    assert.ok(cmd);
    assert.equal(cmd.command, cliPath);
    assert.deepEqual(cmd.args, ['serve']);
    assert.equal(cmd.stdin, 'user prompt');
    assert.equal(cmd.display, 'opencode serve');
    assert.equal(cmd.streamFormat, 'opencode-sse');
  }));

  test('opencode adapter rejects non-opencode profiles', () => withOpencodeCli((workflowRoot) => {
    const cmd = buildRuntimeCommandForEngine(
      'opencode',
      { runtime: 'other-runtime', model: 'sonnet' },
      { userPrompt: 'user prompt', files: [], thinkingLevel: null, workflowRoot },
    );

    assert.equal(cmd, null);
  }));

  test('probe opencode reports missing binary before server start', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-missing-'));
    try {
      const result = probeAgentExecution('opencode', null, root);
      assert.equal(result.ok, false);
      assert.match(result.error || '', /opencode 运行文件缺失/);
      assert.match(result.error || '', /build:opencode-runtime/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('probe opencode accepts runtime binary built from vendored source', () => withOpencodeCli((workflowRoot, cliPath) => {
    const result = probeAgentExecution('opencode', null, workflowRoot);

    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.equal(result.commandDisplay, `${cliPath} serve`);
    assert.equal(resolveRuntimeReadinessBlocker('opencode', workflowRoot), null);
  }));

  test('buildRmmvMcpConfig emits opencode local MCP schema', () => {
    const workflowRoot = path.join(os.tmpdir(), 'app');
    const config = buildRmmvMcpConfig(workflowRoot);
    const rmmv = config.mcp.rmmv;

    assert.equal(rmmv.type, 'local');
    assert.equal(rmmv.enabled, true);
    assert.equal(rmmv.command[0], process.execPath);
    assert.ok(rmmv.command.includes('--experimental-strip-types'));
    assert.match(rmmv.command.at(-1), /rmmv-mcp-server\.ts$/);
    assert.equal(rmmv.environment.AGENT_RPG_ROOT, workflowRoot);
    assert.equal(rmmv.environment.AIWF_WORKFLOW_ROOT, workflowRoot);
    assert.equal(RMMV_MCP_ALLOWED_TOOLS, 'rmmv_*');
    assert.deepEqual(JSON.parse(buildRmmvMcpConfigJson(workflowRoot)), config);
  });
});
