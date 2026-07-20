import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  mapPreviewDiagnosticFromError,
  sanitizeClientPreviewError,
  serializeMapPreviewDiagnostic,
} from './mapPreviewDiagnostics';

describe('map preview diagnostics', () => {
  it('redacts the project and unrelated absolute paths from direct IPC errors', () => {
    const project = path.join(os.tmpdir(), 'preview diagnostic project');
    const external = path.join(os.tmpdir(), 'preview-diagnostic-external', 'runtime.log');
    const quotedExternal = path.join(os.tmpdir(), 'preview diagnostic external', 'runtime log.txt');
    const encodedProjectAsset = pathToFileURL(path.join(project, 'www', 'img', 'characters', 'Example File.png')).href;
    const message = `Failed at ${encodedProjectAsset}, ${external}, and "${quotedExternal}"`;
    expect(sanitizeClientPreviewError(message, project)).toBe(
      'Failed at img/characters/Example%20File.png, [external-path], and "[external-path]"',
    );
  });

  it('creates a structured diagnostic for failures before a session exists', () => {
    const diagnostic = mapPreviewDiagnosticFromError({
      error: new Error('Runtime unavailable'),
      stage: 'start-ipc',
      engine: 'rpg-maker-mz',
      mapId: 3,
      operationId: 4,
      project: 'projects/sample',
    });
    expect(diagnostic.detail).toMatchObject({
      stage: 'start-ipc',
      operationId: 4,
      targetMapId: 3,
      message: 'Runtime unavailable',
    });
  });

  it('keeps copied diagnostics valid and below the clipboard limit', () => {
    const serialized = serializeMapPreviewDiagnostic({
      failureCode: 'map-render-failed',
      engine: 'rpg-maker-mv',
      mapId: 2,
      operationId: 5,
      detail: {
        stage: 'renderer-resources',
        operationId: 5,
        targetMapId: 2,
        resources: Array.from({ length: 80 }, (_, index) => `img/characters/${String(index).padStart(3, '0')}-${'x'.repeat(400)}.png`),
        message: 'm'.repeat(8_192),
        runtimeOutput: 'o'.repeat(4_096),
      },
    });
    expect(serialized.length).toBeLessThanOrEqual(30_000);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
