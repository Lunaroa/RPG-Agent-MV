import type { UiDesignerProjectProfileResult } from '../../../../contract/ui-designer.ts';
import { inspectRmmvProject, type RmmvProjectManifest } from '../rmmv/rmmv-layout.ts';

/**
 * Reads the selected RPG Maker project's canvas profile from its manifest.
 *
 * The path is an internal lookup input only: the returned contract contains
 * no project/resource path so a renderer cannot accidentally persist or echo
 * host filesystem details as part of a UI-designer document.
 */
export function inspectUiDesignerProjectProfile(project: string): UiDesignerProjectProfileResult {
  if (typeof project !== 'string' || !project.trim()) {
    throw profileError('UI_DESIGNER_PROJECT_REQUIRED', 'A selected RPG Maker project is required.');
  }

  const manifest = inspectRmmvProject(project);
  assertUiDesignerProjectEngineSupported(manifest);

  if (manifest.engine === 'rpg-maker-mv') {
    return {
      engine: 'MV',
      engineVersion: manifest.engineVersion,
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      uiAreaWidth: manifest.uiAreaWidth,
      uiAreaHeight: manifest.uiAreaHeight,
    };
  }

  if (manifest.engine === 'rpg-maker-mz') {
    return {
      engine: 'MZ',
      engineVersion: manifest.engineVersion,
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      uiAreaWidth: manifest.uiAreaWidth,
      uiAreaHeight: manifest.uiAreaHeight,
    };
  }

  throw profileError('UI_DESIGNER_PROJECT_ENGINE_UNSUPPORTED', 'The selected project is not an MV or MZ project.');
}

/** Shared fail-fast engine/version policy for every real UI designer renderer entry. */
export function assertUiDesignerProjectEngineSupported(
  manifest: Pick<RmmvProjectManifest, 'engine' | 'engineVersionSupported'>,
): void {
  if (!manifest.engineVersionSupported) {
    throw profileError(
      'UI_DESIGNER_PROJECT_ENGINE_UNSUPPORTED',
      `The detected RPG Maker ${manifest.engine === 'rpg-maker-mz' ? 'MZ' : 'MV'} engine version is not supported by the UI designer.`,
    );
  }
}

function profileError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
