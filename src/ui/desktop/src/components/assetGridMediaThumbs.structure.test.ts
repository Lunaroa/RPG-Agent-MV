import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopSrc = join(here, '..');

describe('asset grid media thumbs', () => {
  test('font thumb exists; audio stays icon-only; effects use an armed thumb', () => {
    const font = readFileSync(join(desktopSrc, 'components/AssetGridFontThumb.vue'), 'utf8');
    assert.match(font, /FontFace/);
    assert.match(font, /emit\('error'\)/);

    const view = readFileSync(join(desktopSrc, 'views/ProjectAssetsView.vue'), 'utf8');
    assert.match(view, /AssetGridFontThumb/);
    assert.doesNotMatch(view, /AssetGridAudioThumb/);
    assert.match(view, /AssetGridEffectThumb/);
    assert.match(view, /typeIconSizePx/);
  });
});
