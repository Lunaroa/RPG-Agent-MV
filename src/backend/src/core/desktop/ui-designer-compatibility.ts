import type { UiDesignerProjectCompatibility } from '../../../../contract/ui-designer.ts';
import type { RmmvProjectManifest } from '../rmmv/rmmv-layout.ts';

/**
 * Reuse the shared RMMV inspector's engine/version decision. This module only
 * translates its already-computed snapshot for UI designer boundaries; it
 * does not probe or execute project files a second time.
 */
export function uiDesignerProjectCompatibility(
  manifest: Pick<RmmvProjectManifest, 'engine' | 'engineVersion' | 'engineVersionSupported' | 'encryptedResources' | 'encryptedImages' | 'encryptedAudio'>,
): UiDesignerProjectCompatibility {
  const engine = manifest.engine === 'rpg-maker-mz' ? 'MZ' : manifest.engine === 'rpg-maker-mv' ? 'MV' : 'unknown';
  const warnings: string[] = [];
  if (!manifest.engineVersionSupported) {
    warnings.push(`The ${engine} engine version ${manifest.engineVersion || 'unknown'} is outside the validated UI designer baseline.`);
  }
  if (manifest.encryptedResources) {
    const scope = manifest.encryptedImages && manifest.encryptedAudio
      ? 'images and audio'
      : manifest.encryptedImages ? 'images' : 'audio';
    warnings.push(`Encrypted ${scope} may not be previewable or writable through the resource boundary.`);
  }
  return {
    engine,
    engineVersion: manifest.engineVersion,
    engineVersionSupported: manifest.engineVersionSupported,
    warnings,
  };
}

export function unsupportedUiDesignerProjectCompatibility(message: string): UiDesignerProjectCompatibility {
  return {
    engine: 'unknown',
    engineVersion: null,
    engineVersionSupported: false,
    warnings: [message],
  };
}
