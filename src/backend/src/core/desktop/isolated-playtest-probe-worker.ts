import fs from 'node:fs';
import path from 'node:path';

import { writeJsonAtomic } from '../rmmv/json.ts';
import { runNwjsPlayableProbe } from '../workflow/probe/nwjs-playable-probe.ts';
import type {
  IsolatedProbeWorkerRequest,
  IsolatedProbeWorkerResponse,
} from './isolated-playtest-probe.ts';

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) throw new Error('Isolated probe worker requires request and response paths.');
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8')) as IsolatedProbeWorkerRequest;
  let response: IsolatedProbeWorkerResponse;
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    const run = runNwjsPlayableProbe(request.temporaryProject, {
      timeoutMs: request.timeoutMs,
      artifactDir: request.artifactDir,
      command: {
        executable: path.join(request.temporaryProject, 'Game.exe'),
        args: ['--disable-audio'],
        cwd: request.temporaryProject,
      },
      stdoutPath: path.join(request.artifactDir, 'probe.stdout.log'),
      stderrPath: path.join(request.artifactDir, 'probe.stderr.log'),
    });
    response = { ok: true, run };
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    process.exitCode = 1;
  }
  writeJsonAtomic(responsePath, response);
}

void main().catch((error) => {
  const responsePath = process.argv[3];
  if (responsePath) {
    try {
      writeJsonAtomic(responsePath, { ok: false, error: error instanceof Error ? error.message : String(error) });
    } catch {
      // The parent process also records missing worker responses.
    }
  }
  process.exitCode = 1;
});
