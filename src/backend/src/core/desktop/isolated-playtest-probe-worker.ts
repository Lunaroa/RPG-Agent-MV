import fs from 'node:fs';
import path from 'node:path';

import { writeJsonAtomic } from '../rmmv/json.ts';
import { runNwjsPlayableProbe } from '../workflow/probe/nwjs-playable-probe.ts';
import type {
  IsolatedProbeWorkerRequest,
  IsolatedProbeWorkerResponse,
} from './isolated-playtest-probe.ts';
import { redactRpgMakerMZRuntimePath } from './rpg-maker-mz-runtime.ts';

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) throw new Error('Isolated probe worker requires request and response paths.');
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8')) as IsolatedProbeWorkerRequest;
  const suppliedRuntime = String(
    process.env.RPG_AGENT_NWJS_EXECUTABLE
    || process.env.RPG_AGENT_MZ_NWJS_EXECUTABLE
    || '',
  );
  const launchStyle = process.env.RPG_AGENT_NWJS_LAUNCH_STYLE === 'external' ? 'external' : 'embedded';
  const stdoutPath = path.join(request.artifactDir, 'probe.stdout.log');
  const stderrPath = path.join(request.artifactDir, 'probe.stderr.log');
  let response: IsolatedProbeWorkerResponse;
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    const runtimeExecutable = suppliedRuntime || (request.engine === 'rpg-maker-mv' && launchStyle === 'embedded'
      ? path.join(request.temporaryProject, 'Game.exe')
      : '');
    if (!runtimeExecutable) {
      throw new Error('The validated RPG Maker runtime was not supplied to the isolated probe worker.');
    }
    delete process.env.RPG_AGENT_NWJS_EXECUTABLE;
    delete process.env.RPG_AGENT_MZ_NWJS_EXECUTABLE;
    delete process.env.RPG_AGENT_NWJS_LAUNCH_STYLE;
    const executable = runtimeExecutable;
    const externalArgs = request.engine === 'rpg-maker-mv'
      ? [request.temporaryProject, 'test', '--disable-audio']
      : [request.temporaryProject, '--disable-audio'];
    const run = runNwjsPlayableProbe(request.temporaryProject, {
      timeoutMs: request.timeoutMs,
      artifactDir: request.artifactDir,
      command: {
        executable,
        args: launchStyle === 'external' ? externalArgs : ['--disable-audio'],
        cwd: request.temporaryProject,
      },
      stdoutPath,
      stderrPath,
    });
    run.gameExe = `validated-${request.engine}-nwjs`;
    response = sanitizeWorkerResponse({ ok: true, run }, suppliedRuntime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response = {
      ok: false,
      error: redactRpgMakerMZRuntimePath(message, suppliedRuntime),
    };
    process.exitCode = 1;
  }
  redactOutputFile(stdoutPath, suppliedRuntime);
  redactOutputFile(stderrPath, suppliedRuntime);
  response = sanitizeWorkerResponse(response, suppliedRuntime);
  writeJsonAtomic(responsePath, response);
}

function sanitizeWorkerResponse(
  response: IsolatedProbeWorkerResponse,
  executable: string,
): IsolatedProbeWorkerResponse {
  if (!executable) return response;
  return JSON.parse(redactRpgMakerMZRuntimePath(JSON.stringify(response), executable)) as IsolatedProbeWorkerResponse;
}

function redactOutputFile(filePath: string, executable: string): void {
  if (!executable || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  const original = fs.readFileSync(filePath, 'utf8');
  const redacted = redactRpgMakerMZRuntimePath(original, executable);
  if (redacted !== original) fs.writeFileSync(filePath, redacted, 'utf8');
}

void main().catch(() => {
  const responsePath = process.argv[3];
  if (responsePath) {
    try {
      writeJsonAtomic(responsePath, {
        ok: false,
        error: 'Isolated probe worker failed before producing sanitized evidence.',
      });
    } catch {
      // The parent process also records missing worker responses.
    }
  }
  process.exitCode = 1;
});
