import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyGameDirectory } from './game-build-file-service.ts';

const UPDATER_RUNTIME_SOURCE = fileURLToPath(new URL('./game-windows-updater-runtime/', import.meta.url));
export const WINDOWS_UPDATER_RELATIVE_DIRECTORY = '.rpg-agent/updater';

export function installWindowsUpdaterRuntime(gameDirectory: string): void {
  if (!fs.existsSync(UPDATER_RUNTIME_SOURCE) || !fs.statSync(UPDATER_RUNTIME_SOURCE).isDirectory()) {
    throw new Error('The managed Windows game updater runtime is missing from RPG Agent MV.');
  }
  const target = path.join(path.resolve(gameDirectory), ...WINDOWS_UPDATER_RELATIVE_DIRECTORY.split('/'));
  copyGameDirectory(UPDATER_RUNTIME_SOURCE, target);
}
