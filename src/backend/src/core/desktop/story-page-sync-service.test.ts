import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CONTROLLED_EDITING_DISABLED_CODE,
  STORY_PROJECT_NOT_INITIALIZED_MESSAGE,
} from '../../../../contract/desktop-errors.ts';
import { StoryProjectNotInitializedError } from './story-page-sync-service.ts';

describe('story project initialization guard', () => {
  test('StoryProjectNotInitializedError carries typed code and message', () => {
    const error = new StoryProjectNotInitializedError();
    assert.equal(error.code, CONTROLLED_EDITING_DISABLED_CODE);
    assert.equal(error.message, STORY_PROJECT_NOT_INITIALIZED_MESSAGE);
    assert.equal(error.name, 'StoryProjectNotInitializedError');
  });
});
