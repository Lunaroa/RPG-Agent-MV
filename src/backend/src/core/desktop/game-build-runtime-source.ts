import fs from 'node:fs';
import path from 'node:path';

export function resolveGameBuildRuntimeSource(
  adjacentSource: string,
  directoryName: string,
  workflowRoot?: string,
): string {
  const installRoot = process.env.AGENT_RPG_INSTALL_ROOT?.trim();
  const candidates = [
    path.resolve(adjacentSource),
    ...(installRoot ? [path.join(path.resolve(installRoot), 'src', 'backend', 'src', 'core', 'desktop', directoryName)] : []),
    ...(workflowRoot ? [path.join(path.resolve(workflowRoot), 'src', 'backend', 'src', 'core', 'desktop', directoryName)] : []),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (!source) throw new Error(`The managed ${directoryName} files are missing from RPG Agent MV.`);
  return source;
}
