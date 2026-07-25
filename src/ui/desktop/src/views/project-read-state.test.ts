import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';

import { LatestAsyncCoordinator } from '../utils/latestAsyncCoordinator';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('project read surfaces compile and distinguish loading, partial failure, retry, and empty states', () => {
  const sources = {
    view: readSfc(path.join(currentDir, 'ConsoleView.vue')),
    home: readSfc(path.join(currentDir, '..', 'components', 'console', 'ConsoleHome.vue')),
    database: readSfc(path.join(currentDir, 'DatabaseView.vue')),
    mapOverview: readSfc(path.join(currentDir, 'MapOverviewView.vue')),
    editor: readSfc(path.join(currentDir, 'EditorView.vue')),
    dock: readSfc(path.join(currentDir, '..', 'components', 'layout', 'LeftDock.vue')),
  };

  for (const [name, source] of Object.entries(sources)) assertTemplateCompiles(name, source);

  assert.doesNotMatch(sources.home, /kpi-strip/);
  assert.doesNotMatch(sources.home, /projectItemCount|projectStatsLoading|loadProjectOverview/);
  assert.doesNotMatch(sources.view, /loadProjectOverview|projectManagement\.overview|projectOverviewCoordinator/);
  assert.match(sources.home, /console\.home\.statsAssets/);
  assert.match(sources.home, /console\.home\.statsLogs/);
  assert.match(sources.view, /if \(page === 'assets' && !catalog\.value/);
  assert.match(sources.view, /if \(page === 'logs' && !sessions\.value\.length/);
  assert.doesNotMatch(sources.view, /page === 'home' && !projectOverview|page === 'home' \|\| page === 'assets'|page === 'home' \|\| page === 'logs'/);
  assert.doesNotMatch(sources.view, /ConsoleStoryPane/);
  assert.match(sources.view, /if \(pageValue === 'story'\)/);
  assert.match(sources.view, /path:\s*['"]\/database['"]/);
  assert.match(sources.view, /section !== 'overview' && section !== 'maps' && section !== 'audio' && section !== 'images'/);
  assert.match(sources.database, /selectedDatabaseReadIssue/);
  assert.match(sources.database, /const preserveOverview = Boolean\(overview\.value\);\s+loading\.value = !preserveOverview;\s+refreshing\.value = preserveOverview;/);
  assert.match(sources.database, /v-else-if="error && !overview"/);
  assert.match(sources.database, /v-else-if="loading && !overview"/);
  assert.match(sources.database, /v-else-if="overview"/);
  assert.match(sources.database, /if \(overview\.value && validation\.unchanged\) \{\s+surfaceVersion = validation\.version;/);
  assert.match(sources.mapOverview, /graph && !graph\.destroyed && graphBoundContainer === graphHost\.value/);
  assert.match(sources.mapOverview, /v-if="loading && !snapshot"/);
  assert.match(sources.mapOverview, /v-else-if="snapshot" class="overview-body"/);
  assert.match(sources.mapOverview, /await restoreGraphAfterActivation\(\)/);
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
