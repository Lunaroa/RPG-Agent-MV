import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyGameDirectory } from './game-build-file-service.ts';
import { resolveGameBuildRuntimeSource } from './game-build-runtime-source.ts';

export const ANDROID_SHELL_SOURCE_DIRECTORY = fileURLToPath(new URL('./game-android-runtime/', import.meta.url));

export const ANDROID_SHELL_REQUIRED_FILES = Object.freeze([
  'settings.gradle',
  'build.gradle',
  'gradle.properties',
  'app/build.gradle',
  'app/proguard-rules.pro',
  'app/src/main/AndroidManifest.xml',
  'app/src/main/java/org/rpgagent/runtime/GameActivity.java',
  'app/src/main/java/org/rpgagent/runtime/RPGAgentBridge.java',
  'app/src/main/java/org/rpgagent/runtime/UpdateProgressListener.java',
  'app/src/main/java/org/rpgagent/runtime/ContentStateStore.java',
  'app/src/main/java/org/rpgagent/runtime/ActiveContentPathHandler.java',
  'app/src/main/java/org/rpgagent/runtime/ContentUpdateManager.java',
  'app/src/main/java/org/rpgagent/runtime/BinaryPatch.java',
  'app/src/main/java/org/rpgagent/runtime/ApkUpdateManager.java',
  'app/src/main/java/org/rpgagent/runtime/InstallResultReceiver.java',
  'app/src/main/java/org/rpgagent/runtime/RuntimeFiles.java',
]);

export function copyAndroidShellProject(target: string, workflowRoot?: string): void {
  const source = assertAndroidShellTemplate(workflowRoot);
  copyGameDirectory(source, target);
}

export function assertAndroidShellTemplate(workflowRoot?: string): string {
  const source = resolveGameBuildRuntimeSource(ANDROID_SHELL_SOURCE_DIRECTORY, 'game-android-runtime', workflowRoot);
  const missing = ANDROID_SHELL_REQUIRED_FILES.filter((relativePath) => {
    const file = path.join(source, ...relativePath.split('/'));
    return !fs.existsSync(file) || !fs.statSync(file).isFile();
  });
  if (missing.length) throw new Error(`The managed Android shell project is incomplete: ${missing.join(', ')}.`);
  return source;
}
