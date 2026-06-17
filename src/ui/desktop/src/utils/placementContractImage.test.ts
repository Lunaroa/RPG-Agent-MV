import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractContractPageImage } from './placementContractImage.ts';

describe('extractContractPageImage', () => {
  it('returns the first page image with a character graphic', () => {
    const image = extractContractPageImage({
      implementation: {
        pages: [
          { commands: [{ kind: 'text', text: 'hi' }] },
          {
            image: { characterName: 'People1', characterIndex: 2 },
            commands: [{ kind: 'text', text: 'hello' }],
          },
        ],
      },
    });
    assert.deepEqual(image, { characterName: 'People1', characterIndex: 2 });
  });

  it('returns tile image when no character is set', () => {
    const image = extractContractPageImage({
      implementation: {
        pages: [{ image: { tileId: 42 } }],
      },
    });
    assert.deepEqual(image, { tileId: 42 });
  });

  it('returns null when implementation has no pages', () => {
    assert.equal(extractContractPageImage({ implementation: { commands: [] } }), null);
  });
});
