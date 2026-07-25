import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./DatabaseView.vue', import.meta.url), 'utf8');

describe('DatabaseView battle-test draft guard', () => {
  test('guards setup and launch with saved-baseline comparison', () => {
    const setup = source.slice(source.indexOf('async function openBattleTestSetup'), source.indexOf('async function startBattleTest'));
    const launch = source.slice(source.indexOf('async function startBattleTest'), source.indexOf('async function startParticlePreview'));

    assert.match(setup, /if \(hasUnsavedDraft\.value\)/);
    assert.match(launch, /if \(hasUnsavedDraft\.value\)/);
    assert.doesNotMatch(setup, /if \(canUndoDraft\.value\)/);
    assert.doesNotMatch(launch, /if \(canUndoDraft\.value\)/);
  });
});
