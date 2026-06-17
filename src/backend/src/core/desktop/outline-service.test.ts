import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { StoryOutline } from '../../../../contract/types.ts';
import { formatStoryOutlineSummary } from './outline-service.ts';

describe('creative outline summary', () => {
  test('formatStoryOutlineSummary reports markdown outline without production progress', () => {
    const outline: StoryOutline = {
      projectId: 'Demo',
      title: 'Sample Outline',
      body: '# Sample Outline\n\n## Logline\nA town hears the wrong chime.',
      updatedAt: '2026-06-06T00:00:00.000Z',
    };
    const text = formatStoryOutlineSummary('/tmp/Demo', outline);
    assert.match(text, /Creative story outline: Demo/);
    assert.match(text, /Title: Sample Outline/);
    assert.match(text, /Preview:/);
    assert.doesNotMatch(text, /Current act/);
    assert.doesNotMatch(text, /Allowed scene ids/);
  });

  test('formatStoryOutlineSummary reports empty state', () => {
    const text = formatStoryOutlineSummary('/tmp/Demo', null);
    assert.equal(text, 'No creative story outline for Demo.');
  });
});
