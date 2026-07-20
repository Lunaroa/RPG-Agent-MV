import { describe, expect, test } from 'vitest';

import type { MapPreviewStateCatalog } from '@contract/types';
import { filterMapPreviewOverrides, removeMapPreviewOverrides } from './mapPreviewOverrides';

describe('map preview project overrides', () => {
  const saved = {
    switches: { '12': true, '20': false, '30': true },
    variables: { '8': 4, '9': 7, '10': 11 },
  };
  const firstMap: MapPreviewStateCatalog = {
    switches: [
      { id: 30, name: '', mapReachable: true },
      { id: 12, name: 'Shared switch', mapReachable: true },
      { id: 20, name: 'Other switch', mapReachable: false },
    ],
    variables: [
      { id: 8, name: 'First map variable', mapReachable: true },
      { id: 9, name: 'Second map variable', mapReachable: false },
    ],
  };
  const secondMap: MapPreviewStateCatalog = {
    switches: [
      { id: 12, name: 'Shared switch', mapReachable: false },
      { id: 20, name: 'Other switch', mapReachable: true },
    ],
    variables: [
      { id: 9, name: 'Second map variable', mapReachable: true },
      { id: 8, name: 'First map variable', mapReachable: false },
    ],
  };

  test('applies every named project value regardless of current-map reachability', () => {
    expect(filterMapPreviewOverrides(saved, firstMap)).toEqual({ switches: { '12': true, '20': false, '30': true }, variables: { '8': 4, '9': 7 } });
    expect(filterMapPreviewOverrides(saved, secondMap)).toEqual({ switches: { '12': true, '20': false }, variables: { '8': 4, '9': 7 } });
  });

  test('reset removes named ids and current-map reachable unnamed ids', () => {
    expect(removeMapPreviewOverrides(saved, firstMap)).toEqual({ switches: {}, variables: { '10': 11 } });
  });
});
