import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

import { LatestAsyncCoordinator } from '../../utils/latestAsyncCoordinator';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('project read surfaces compile and distinguish loading, partial failure, retry, and empty states', () => {
  const sources = {
    view: readSfc(path.join(currentDir, '..', '..', 'views', 'ConsoleView.vue')),
    home: readSfc(path.join(currentDir, 'ConsoleHome.vue')),
    story: readSfc(path.join(currentDir, 'ConsoleStoryPane.vue')),
    mapOverview: readSfc(path.join(currentDir, '..', '..', 'views', 'MapOverviewView.vue')),
    editor: readSfc(path.join(currentDir, '..', '..', 'views', 'EditorView.vue')),
    dock: readSfc(path.join(currentDir, '..', 'layout', 'LeftDock.vue')),
  };

  for (const [name, source] of Object.entries(sources)) assertTemplateCompiles(name, source);

  assert.match(sources.home, /projectStatsLoading \? '…'/);
  assert.match(sources.home, /assetsLoading \? '…'/);
  assert.match(sources.home, /logsLoading \? '…'/);
  assert.match(sources.view, /projectOverviewCoordinator\.isCurrent\(token\)/);
  assert.match(sources.view, /projectStore\.currentProject !== project/);
  assert.match(sources.story, /selectedMapReadIssue/);
  assert.match(sources.story, /selectedDatabaseReadIssue/);
  assert.match(sources.view, /<ConsoleStoryPane\s+v-show="currentPage === 'story'"\s+:active="consoleActive && currentPage === 'story'"/);
  assert.doesNotMatch(sources.view, /<KeepAlive>\s*<ConsoleStoryPane/);
  assert.match(sources.story, /const preserveOverview = Boolean\(overview\.value\);\s+loading\.value = !preserveOverview;\s+refreshing\.value = preserveOverview;/);
  assert.match(sources.story, /v-else-if="error && !overview"/);
  assert.match(sources.story, /v-else-if="loading && !overview"/);
  assert.match(sources.story, /v-else-if="overview"/);
  assert.match(sources.story, /if \(overview\.value && validation\.unchanged\) \{\s+surfaceVersion = validation\.version;/);
  assert.match(sources.mapOverview, /if \(cy && cy\.container\(\) === graphHost\.value\)/);
  assert.match(sources.mapOverview, /v-if="loading && !snapshot"/);
  assert.match(sources.mapOverview, /v-else-if="snapshot" class="overview-body"/);
  assert.match(sources.mapOverview, /await restoreGraphAfterActivation\(\)/);
  assert.match(sources.story, /m\.readState === 'ready' \? m\.eventCount : '!'/);
  assert.match(sources.editor, /mapTreeLoadCoordinator\.isCurrent\(token\)/);
  assert.match(sources.editor, /mapTreeLoading\.value = true;\s+mapTreeError\.value = '';\s+mapTree\.value = \[\];/);
  assert.equal((sources.editor.match(/mapTree\.value = buildTree\(index\.maps\)/g) || []).length, 1);
  assert.match(sources.dock, /v-if="mapTreeLoading"/);
  assert.match(sources.dock, /v-else-if="mapTreeError"/);
});

test('a late project A response cannot replace project B state', async () => {
  const coordinator = new LatestAsyncCoordinator<{ project: string }>();
  const commits: string[] = [];
  let releaseA!: () => void;
  const waitForA = new Promise<void>((resolve) => { releaseA = resolve; });

  const tokenA = coordinator.begin({ project: 'sample-a' });
  const requestA = waitForA.then(() => {
    if (coordinator.isCurrent(tokenA)) commits.push('sample-a');
  });
  const tokenB = coordinator.begin({ project: 'sample-b' });
  if (coordinator.isCurrent(tokenB)) commits.push('sample-b');
  releaseA();
  await requestA;

  assert.deepEqual(commits, ['sample-b']);
});

function readSfc(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function assertTemplateCompiles(name: string, source: string): void {
  const parsed = parse(source, { filename: `${name}.vue` });
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.descriptor.template);
  compileScript(parsed.descriptor, { id: `project-read-${name}` });
  const result = compileTemplate({
    id: `project-read-${name}`,
    filename: `${name}.vue`,
    source: parsed.descriptor.template.content,
  });
  assert.deepEqual(result.errors, []);
}
