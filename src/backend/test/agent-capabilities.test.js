import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildOpencodeToolPolicyFromAgentAllow,
  getAgentCapabilitiesSnapshot,
  hasEnabledRmmvMcpTools,
  resolveEnabledAgentRuntimeBuiltinTools,
  summarizeSkillMarkdown,
  updateAgentToolAllow,
} from '../src/core/workflow/agent/agent-capabilities.ts';
import { DEFAULT_OPENCODE_TOOLS } from '../src/core/llm/opencode/build-profile.ts';
import { buildRuntimeCommandForEngine } from '../src/core/workflow/agent/runtime-adapters/index.ts';

const WORKFLOW_ROOT = path.resolve(import.meta.dirname, '../../..');

function createCapabilityFixture(options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-cap-'));
  const agentDir = path.join(tmp, 'config', 'agents', 'default');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'config', 'capabilities'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'config', 'api-profiles'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'runtime', 'out', 'opencode', 'windows-x64'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'runtime', 'out', 'opencode', 'windows-x64', 'opencode.exe'),
    'binary\n',
    'utf8',
  );
  fs.copyFileSync(
    path.join(WORKFLOW_ROOT, 'config', 'capabilities', 'tool-manifest.json'),
    path.join(tmp, 'config', 'capabilities', 'tool-manifest.json'),
  );
  fs.writeFileSync(
    path.join(tmp, 'config', 'agents', 'registry.yaml'),
    JSON.stringify({ version: 1, agents: [{ path: 'config/agents/default/agent.yaml', id: 'default' }] }, null, 2),
  );
  fs.writeFileSync(
    path.join(agentDir, 'agent.yaml'),
    JSON.stringify({
      id: 'default',
      runtime: { defaultProfile: 'opencode-default' },
      tools: { allow: options.allow || ['read'], deny: [] },
      skills: [],
    }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(tmp, 'config', 'api-profiles', 'profiles.yaml'),
    JSON.stringify({ profiles: { 'opencode-default': { runtime: 'opencode', tools: [...DEFAULT_OPENCODE_TOOLS] } } }, null, 2),
  );
  return { tmp, agentDir };
}

describe('agent-capabilities', () => {
  test('summarizeSkillMarkdown reads frontmatter name and description', () => {
    const md = `---
name: story-writing-constraints
description: 剧情写作纪律
---

# 剧情写作约束技能
`;
    assert.deepEqual(summarizeSkillMarkdown(md, 'config/opencode/skills/story-writing-constraints/SKILL.md'), {
      title: 'story-writing-constraints',
      description: '剧情写作纪律',
    });
  });

  test('summarizeSkillMarkdown falls back to skill directory name', () => {
    const md = '正文说明';
    assert.equal(
      summarizeSkillMarkdown(md, 'config/opencode/skills/jrpg-story-writing/SKILL.md').title,
      'jrpg-story-writing',
    );
  });

  test('getAgentCapabilitiesSnapshot includes opencode tools and RMMV MCP tools', () => {
    const snapshot = getAgentCapabilitiesSnapshot(WORKFLOW_ROOT, { engine: 'opencode' });
    assert.ok(snapshot.builtinTools.some((t) => t.id === 'rmmv_RmmvReadContext'));
    assert.ok(snapshot.builtinTools.some((t) => t.id === 'task'));
    assert.ok(snapshot.builtinTools.some((t) => t.id === 'question'));
    assert.equal(snapshot.mcpServers.some((s) => s.id === 'askuser'), false);
    assert.equal(snapshot.builtinTools.some((t) => String(t.id).startsWith('mcp__askuser__')), false);
    const readContext = snapshot.builtinTools.find((t) => t.id === 'rmmv_RmmvReadContext');
    assert.equal(readContext?.warning, null);
    assert.equal(readContext?.inAgentRuntimeProfile, true);
    assert.equal(readContext?.toggleable, true);
    assert.equal(readContext?.disabledReason, null);
    const subagentTool = snapshot.builtinTools.find((t) => t.id === 'task');
    assert.equal(subagentTool?.layer, 'subagent');
    assert.equal(subagentTool?.title, 'Subagent');
    assert.match(subagentTool?.description || '', /不属于 TASK\/todo-list/);
    const todoWrite = snapshot.builtinTools.find((t) => t.id === 'todowrite');
    assert.equal(todoWrite?.available, true);
    assert.equal(todoWrite?.inAgentRuntimeProfile, true);
    assert.equal(todoWrite?.toggleable, true);
  });

  test('updateAgentToolAllow writes builtin allow list and drives new-session tools', () => {
    const { tmp, agentDir } = createCapabilityFixture({ allow: ['read'] });
    try {
      const updated = updateAgentToolAllow(tmp, 'webfetch', true);
      const webFetch = updated.builtinTools.find((t) => t.id === 'webfetch');
      assert.equal(webFetch?.allowed, true);
      const saved = JSON.parse(fs.readFileSync(path.join(agentDir, 'agent.yaml'), 'utf8'));
      assert.ok(saved.tools.allow.includes('webfetch'));
      const enabled = resolveEnabledAgentRuntimeBuiltinTools(tmp);
      assert.deepEqual(enabled, ['read', 'webfetch']);

      const command = buildRuntimeCommandForEngine(
        'opencode',
        { runtime: 'opencode', provider: 'p', model: 'm', tools: enabled },
        {
          userPrompt: 'hello',
          files: [],
          workflowRoot: tmp,
        },
      );
      assert.ok(command);
      assert.equal(command.streamFormat, 'opencode-sse');
      assert.deepEqual(command.args, ['serve']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('buildOpencodeToolPolicyFromAgentAllow reflects MCP allow list', () => {
    const { tmp } = createCapabilityFixture({
      allow: ['read', 'rmmv_RmmvMap'],
    });
    try {
      const policy = buildOpencodeToolPolicyFromAgentAllow(tmp);
      assert.equal(policy.rmmv_RmmvReadContext, false);
      assert.equal(policy.rmmv_RmmvMap, true);
      assert.equal(hasEnabledRmmvMcpTools(tmp), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('updateAgentToolAllow toggles RMMV MCP tools and affects runtime policy', () => {
    const { tmp, agentDir } = createCapabilityFixture({
      allow: ['read', 'rmmv_RmmvReadContext', 'rmmv_RmmvMap', 'rmmv_RmmvEvent'],
    });
    try {
      const updated = updateAgentToolAllow(tmp, 'rmmv_RmmvReadContext', false);
      const readContext = updated.builtinTools.find((t) => t.id === 'rmmv_RmmvReadContext');
      assert.equal(readContext?.allowed, false);
      assert.equal(readContext?.inAgentRuntimeProfile, false);
      const saved = JSON.parse(fs.readFileSync(path.join(agentDir, 'agent.yaml'), 'utf8'));
      assert.equal(saved.tools.allow.includes('rmmv_RmmvReadContext'), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
