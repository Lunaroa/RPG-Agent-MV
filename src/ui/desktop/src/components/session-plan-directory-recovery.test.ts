import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('chat plan directory failures offer open-folder and retry recovery actions', () => {
  const hint = readSfc(path.join(currentDir, 'ComposerHintBar.vue'));
  const chat = readSfc(path.join(currentDir, '..', 'views', 'ChatView.vue'));

  assertTemplateCompiles('ComposerHintBar', hint);
  assertTemplateCompiles('ChatView', chat);
  assert.match(hint, /primaryActionLabel/);
  assert.match(hint, /secondaryActionLabel/);
  assert.match(chat, /showComposerError\(error\)/);
  assert.match(chat, /projectsApi\.openFolder\(projectStore\.currentProject\)/);
  assert.match(chat, /handlePlanDirectoryRetry/);
  assert.match(chat, /\.opencode\/plans\/conversations/);
});

function readSfc(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function assertTemplateCompiles(name: string, source: string): void {
  const parsed = parse(source, { filename: `${name}.vue` });
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.descriptor.template);
  compileScript(parsed.descriptor, { id: `session-plan-directory-${name}` });
  const result = compileTemplate({
    id: `session-plan-directory-${name}`,
    filename: `${name}.vue`,
    source: parsed.descriptor.template.content,
  });
  assert.deepEqual(result.errors, []);
}
