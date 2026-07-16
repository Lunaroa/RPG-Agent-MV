import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { simulateMoveRoute } from './moveRoutePreview.ts';

describe('MZ movement route preview', () => {
  test('simulates deterministic movement, turns, jumps, waits, and direction lock', () => {
    const result = simulateMoveRoute([
      { code: 3 },
      { code: 20 },
      { code: 12 },
      { code: 14, parameters: [-2, -3] },
      { code: 15, parameters: [24] },
      { code: 35 },
      { code: 16 },
      { code: 13 },
      { code: 0 },
    ], { x: 10, y: 8, direction: 2 });

    assert.equal(result.stop, null);
    assert.deepEqual(result.finalState, {
      x: 9,
      y: 7,
      direction: 8,
      elapsedFrames: 24,
      directionFixed: true,
    });
    assert.equal(result.points.length, 9);
  });

  test('stops at the exact random, player-dependent, script, or unknown step', () => {
    for (const [code, kind] of [[9, 'random'], [10, 'player-dependent'], [45, 'script'], [99, 'unknown']] as const) {
      const result = simulateMoveRoute([{ code: 1 }, { code }, { code: 3 }]);
      assert.deepEqual(result.stop, { code, kind, stepIndex: 1 });
      assert.deepEqual([result.finalState.x, result.finalState.y], [0, 1]);
    }
  });
});
