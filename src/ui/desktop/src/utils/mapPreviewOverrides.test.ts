import { describe, expect, test } from 'vitest';

import type { MapPreviewStateCatalog } from '@contract/types';
import { filterMapPreviewOverrides, removeMapPreviewOverrides } from './mapPreviewOverrides';

describe('map preview project overrides', () => {
  const saved = {
    switches: { '12': true, '20': false },
    variables: { '8': 4, '9': 7 },
  };
  const firstMap: MapPreviewStateCatalog = {
    switches: [{ id: 12, name: 'Shared switch' }],
    variables: [{ id: 8, name: 'First map variable' }],
  };
  const secondMap: MapPreviewStateCatalog = {
    switches: [{ id: 12, name: 'Shared switch' }],
    variables: [{ id: 9, name: 'Second map variable' }],
  };

  test('applies shared project values only when the target map references them', () => {
    expect(filterMapPreviewOverrides(saved, firstMap)).toEqual({ switches: { '12': true }, variables: { '8': 4 } });
    expect(filterMapPreviewOverrides(saved, secondMap)).toEqual({ switches: { '12': true }, variables: { '9': 7 } });
  });

  test('reset removes current-map and shared ids while preserving unrelated saved ids', () => {
    expect(removeMapPreviewOverrides(saved, firstMap)).toEqual({ switches: { '20': false }, variables: { '9': 7 } });
  });
});
