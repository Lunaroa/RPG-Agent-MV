/**
 * Run: node --experimental-strip-types --test src/views/SettingsView.memory.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const source = fs.readFileSync(new URL('./SettingsView.vue', import.meta.url), 'utf8');

describe('SettingsView memory governance panel', () => {
  it('loads project memory through the overview API and renders recent activity details', () => {
    assert.match(source, /memoryApi\.getOverview\(memoryProjectId\.value\)/);
    assert.match(source, /memoryOverview\?\.recentActivity\.length/);
    assert.match(source, /selectedMemoryActivity/);
    assert.match(source, /settings\.memory\.activityDetailTitle/);
  });

  it('keeps the scoped Phase 3 surface', () => {
    assert.doesNotMatch(source, /memoryTrend|trendChart|line-chart/);
    assert.doesNotMatch(source, /shortTermMemory|backupRestore|exportMemory|importMemory/);
    assert.doesNotMatch(source, /CURRENT\.md|currentProgress|当前进展/);
    assert.match(source, /settings\.memory\.skillPlaceholder/);
  });

  it('keeps auto extraction disabled under the master switch without clearing its value', () => {
    assert.match(source, /v-model="memoryAutoExtractEnabled"/);
    assert.match(source, /:disabled="!memoryEnabled"/);
    assert.match(source, /memoryApi\.setSettings\(\{ autoExtractEnabled: memoryAutoExtractEnabled\.value \}\)/);
  });
});
