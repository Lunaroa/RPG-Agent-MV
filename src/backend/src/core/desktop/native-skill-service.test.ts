import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNativeSkill } from './native-skill-service.ts';

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'native-skill-'));
}

test('creates a native skill from settings input', () => {
  const root = tmpRoot();
  try {
    const result = createNativeSkill(root, 'event-pacing', '控制事件节奏和停顿');
    const skillFile = path.join(root, '.opencode', 'skills', 'event-pacing', 'SKILL.md');

    assert.equal(result.skill, 'event-pacing');
    assert.equal(result.skillPath.replace(/\\/g, '/'), '.opencode/skills/event-pacing/SKILL.md');
    assert.equal(result.backupPath, '');
    assert.ok(fs.existsSync(skillFile));
    const content = fs.readFileSync(skillFile, 'utf8');
    assert.match(content, /name: event-pacing/);
    assert.match(content, /description: 控制事件节奏和停顿/);
    assert.match(content, /缺少关键约束时直接 ASK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid or duplicate native skill creation', () => {
  const root = tmpRoot();
  try {
    assert.throws(() => createNativeSkill(root, 'BadName', '说明'), /Skill name/);
    assert.throws(() => createNativeSkill(root, 'event-pacing', ''), /Skill description is required/);

    createNativeSkill(root, 'event-pacing', '控制事件节奏和停顿');
    assert.throws(() => createNativeSkill(root, 'event-pacing', '重复'), /already exists/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
