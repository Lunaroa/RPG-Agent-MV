import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyGameDirectory } from './game-build-file-service.ts';
import { resolveGameBuildRuntimeSource } from './game-build-runtime-source.ts';

const UPDATER_RUNTIME_SOURCE = fileURLToPath(new URL('./game-windows-updater-runtime/', import.meta.url));
export const WINDOWS_UPDATER_RELATIVE_DIRECTORY = '.rpg-agent/updater';

export function installWindowsUpdaterRuntime(gameDirectory: string, workflowRoot?: string): void {
  const source = resolveGameBuildRuntimeSource(UPDATER_RUNTIME_SOURCE, 'game-windows-updater-runtime', workflowRoot);
  const target = path.join(path.resolve(gameDirectory), ...WINDOWS_UPDATER_RELATIVE_DIRECTORY.split('/'));
  copyGameDirectory(source, target);
}
