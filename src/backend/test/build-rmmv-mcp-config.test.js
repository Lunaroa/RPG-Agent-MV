import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildRmmvMcpConfig,
  buildRmmvMcpConfigJson,
  RMMV_MCP_ALLOWED_TOOLS,
} from '../src/core/workflow/agent/runtime-adapters/build-rmmv-mcp-config.ts';

describe('build-rmmv-mcp-config', () => {
  test('builds opencode RMMV MCP config without legacy askuser server', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-mcp-config-'));
    try {
      const config = buildRmmvMcpConfig(root);
      assert.equal(config.mcp.askuser, undefined);
      assert.equal(config.mcp.rmmv.type, 'local');
      assert.equal(config.mcp.rmmv.enabled, true);
      assert.equal(config.mcp.rmmv.command[0], process.execPath);
      assert.ok(config.mcp.rmmv.command.includes('--experimental-strip-types'));
      assert.match(config.mcp.rmmv.command.at(-1), /rmmv-mcp-server\.ts$/);
      assert.deepEqual(config.mcp.rmmv.environment, {
        AGENT_RPG_ROOT: root,
        AGENT_RPG_INSTALL_ROOT: root,
        AIWF_WORKFLOW_ROOT: root,
        ELECTRON_RUN_AS_NODE: '1',
      });

      const parsed = JSON.parse(buildRmmvMcpConfigJson(root));
      assert.deepEqual(parsed, config);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('allowed MCP wildcard is RMMV only', () => {
    assert.equal(RMMV_MCP_ALLOWED_TOOLS, 'rmmv_*');
    assert.doesNotMatch(RMMV_MCP_ALLOWED_TOOLS, /askuser/);
  });
});
