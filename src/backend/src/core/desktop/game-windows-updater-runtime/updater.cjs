(() => {
  'use strict';

  const crypto = require('node:crypto');
  const childProcess = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const PATCH_MAGIC = Buffer.from('RPGAGENTBD1\n', 'ascii');

  function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  function safePath(root, relativePath) {
    const portable = String(relativePath || '').replace(/\\/g, '/');
    if (!portable || path.posix.isAbsolute(portable) || path.win32.isAbsolute(relativePath)
      || portable.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Unsafe update path: ${relativePath}.`);
    }
    const target = path.resolve(root, ...portable.split('/'));
    const relative = path.relative(path.resolve(root), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Unsafe update path: ${relativePath}.`);
    }
    return target;
  }

  function validatePlan(value) {
    if (!value || value.schemaVersion !== 1 || typeof value.gameDirectory !== 'string'
      || typeof value.packageDirectory !== 'string' || !value.release || !value.pkg
      || !Array.isArray(value.pkg.targetFiles) || !Array.isArray(value.pkg.deletedFiles)) {
      throw new Error('The Windows update plan is invalid.');
    }
    if (!Number.isSafeInteger(value.gameProcessId) || value.gameProcessId <= 0) {
      throw new Error('The Windows update plan has an invalid game process id.');
    }
    const seen = new Set();
    for (const file of value.pkg.targetFiles) {
      if (!file || typeof file.path !== 'string' || !Number.isSafeInteger(file.bytes) || file.bytes < 0
        || !/^[a-f0-9]{64}$/i.test(String(file.sha256 || '')) || seen.has(file.path)) {
        throw new Error('The Windows update target file manifest is invalid.');
      }
      safePath(value.gameDirectory, file.path);
      seen.add(file.path);
    }
    for (const relativePath of value.pkg.deletedFiles) {
      if (typeof relativePath !== 'string' || seen.has(relativePath)) {
        throw new Error('The Windows update deletion manifest is invalid.');
      }
      safePath(value.gameDirectory, relativePath);
    }
    return value;
  }

  function applyBinaryPatch(base, patch) {
    if (patch.byteLength < PATCH_MAGIC.byteLength + 4 || !patch.subarray(0, PATCH_MAGIC.byteLength).equals(PATCH_MAGIC)) {
      throw new Error('Binary patch has an invalid header.');
    }
    const headerLength = patch.readUInt32LE(PATCH_MAGIC.byteLength);
    const headerStart = PATCH_MAGIC.byteLength + 4;
    const payloadStart = headerStart + headerLength;
    if (payloadStart > patch.byteLength) throw new Error('Binary patch header is truncated.');
    const header = JSON.parse(patch.subarray(headerStart, payloadStart).toString('utf8'));
    if (!header || header.schemaVersion !== 1 || header.algorithm !== 'changed-blocks-v1'
      || !Array.isArray(header.chunks) || !Number.isSafeInteger(header.targetBytes) || header.targetBytes < 0
      || !/^[a-f0-9]{64}$/i.test(String(header.targetSha256 || ''))
      || !(header.baseSha256 === null || /^[a-f0-9]{64}$/i.test(String(header.baseSha256)))) {
      throw new Error('Binary patch metadata is invalid.');
    }
    const actualBase = base ? sha256(base) : null;
    if (actualBase !== header.baseSha256) throw new Error('Binary patch baseline SHA-256 does not match.');
    const target = Buffer.alloc(header.targetBytes);
    if (base) base.copy(target, 0, 0, Math.min(base.byteLength, target.byteLength));
    let previousEnd = 0;
    for (const chunk of header.chunks) {
      if (!Number.isSafeInteger(chunk.offset) || !Number.isSafeInteger(chunk.length)
        || !Number.isSafeInteger(chunk.payloadOffset) || chunk.offset < previousEnd || chunk.length <= 0
        || chunk.payloadOffset < 0 || chunk.offset + chunk.length > target.byteLength
        || payloadStart + chunk.payloadOffset + chunk.length > patch.byteLength) {
        throw new Error('Binary patch contains an invalid chunk range.');
      }
      patch.copy(target, chunk.offset, payloadStart + chunk.payloadOffset, payloadStart + chunk.payloadOffset + chunk.length);
      previousEnd = chunk.offset + chunk.length;
    }
    if (sha256(target) !== header.targetSha256) throw new Error('Binary patch target SHA-256 verification failed.');
    return target;
  }

  function prepareTarget(plan, staging) {
    const manifestFile = safePath(plan.packageDirectory, '.rpg-agent/release-package.json');
    if (!fs.existsSync(manifestFile)) throw new Error('The update package manifest is missing.');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (!manifest || manifest.schemaVersion !== 1 || manifest.releaseId !== plan.release.releaseId
      || manifest.gameId !== plan.gameId || manifest.channel !== plan.release.channel
      || manifest.packageType !== plan.pkg.packageType
      || (manifest.baseReleaseId || null) !== (plan.pkg.baseReleaseId || null)) {
      throw new Error('The update package manifest does not match the selected release.');
    }
    const patches = new Map((manifest.patches || []).map((entry) => [entry.targetPath, entry]));
    for (const entry of plan.pkg.targetFiles) {
      const source = safePath(plan.packageDirectory, entry.path);
      const current = safePath(plan.gameDirectory, entry.path);
      const target = safePath(staging, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let content;
      if (fs.existsSync(source) && fs.statSync(source).isFile()) {
        content = fs.readFileSync(source);
      } else if (plan.pkg.packageType === 'binary-diff' && patches.has(entry.path)) {
        const patch = patches.get(entry.path);
        const patchFile = safePath(plan.packageDirectory, patch.patchPath);
        if (!fs.existsSync(patchFile) || sha256(fs.readFileSync(patchFile)) !== patch.patchSha256) {
          throw new Error(`Binary patch verification failed: ${entry.path}.`);
        }
        content = applyBinaryPatch(fs.existsSync(current) ? fs.readFileSync(current) : null, fs.readFileSync(patchFile));
      } else if (fs.existsSync(current) && fs.statSync(current).isFile()) {
        content = fs.readFileSync(current);
      } else {
        throw new Error(`The update package cannot produce ${entry.path}.`);
      }
      if (content.byteLength !== entry.bytes || sha256(content) !== entry.sha256) {
        throw new Error(`Target file verification failed before apply: ${entry.path}.`);
      }
      fs.writeFileSync(target, content);
    }
  }

  function copyToBackup(source, backup) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(source, backup);
  }

  function replaceFile(target, source) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.rpg-agent-${crypto.randomUUID()}.tmp`;
    fs.copyFileSync(source, temporary);
    try {
      if (fs.existsSync(target)) fs.rmSync(target);
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary);
    }
  }

  function persistJournal(backup, journal) {
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'journal.json'), `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  }

  function applyTarget(plan, staging, backup, journal = {
    schemaVersion: 1,
    releaseId: plan.release.releaseId,
    previousReleaseId: plan.currentReleaseId || null,
    files: [],
  }) {
    for (const entry of plan.pkg.targetFiles) {
      const target = safePath(plan.gameDirectory, entry.path);
      const staged = safePath(staging, entry.path);
      if (fs.existsSync(target) && fs.statSync(target).isFile() && sha256(fs.readFileSync(target)) === entry.sha256) continue;
      const existed = fs.existsSync(target);
      if (existed) copyToBackup(target, safePath(backup, `files/${entry.path}`));
      journal.files.push({ path: entry.path, existed });
      persistJournal(backup, journal);
      replaceFile(target, staged);
    }
    for (const relativePath of plan.pkg.deletedFiles) {
      const target = safePath(plan.gameDirectory, relativePath);
      if (!fs.existsSync(target)) continue;
      if (!fs.statSync(target).isFile()) throw new Error(`The update cannot delete a non-file path: ${relativePath}.`);
      copyToBackup(target, safePath(backup, `files/${relativePath}`));
      journal.files.push({ path: relativePath, existed: true, deleted: true });
      persistJournal(backup, journal);
      fs.rmSync(target);
    }
    persistJournal(backup, journal);
    return journal;
  }

  function rollback(plan, backup, journal) {
    for (const entry of [...journal.files].reverse()) {
      const target = safePath(plan.gameDirectory, entry.path);
      const saved = safePath(backup, `files/${entry.path}`);
      if (entry.existed) {
        if (!fs.existsSync(saved)) throw new Error(`Update rollback is missing ${entry.path}.`);
        replaceFile(target, saved);
      } else if (fs.existsSync(target)) {
        fs.rmSync(target);
      }
    }
  }

  function processExists(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  async function waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!processExists(pid)) return;
      await delay(150);
    }
    throw new Error('The game did not exit before the update timeout.');
  }

  function launchGame(plan, healthFile) {
    const executable = path.join(plan.gameDirectory, 'Game.exe');
    if (!fs.existsSync(executable)) throw new Error('Game.exe is missing after the update.');
    const child = childProcess.spawn(executable, [
      `--rpg-agent-update-health=${healthFile}`,
      `--rpg-agent-expected-release=${plan.release.releaseId}`,
    ], { cwd: plan.gameDirectory, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return child.pid;
  }

  async function waitForHealth(healthFile, pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(healthFile)) {
        const value = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
        if (value && value.ok === true) return;
      }
      if (!processExists(pid)) throw new Error('The updated game exited before startup self-check completed.');
      await delay(250);
    }
    throw new Error('The updated game did not complete startup self-check in time.');
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function runPlan(planPath) {
    const plan = validatePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-apply-'));
    const staging = path.join(work, 'target');
    const healthFile = path.join(work, 'health.json');
    const backup = path.join(plan.gameDirectory, '.rpg-agent', 'update-backups', plan.release.releaseId);
    if (fs.existsSync(backup)) throw new Error(`An update backup already exists for ${plan.release.releaseId}.`);
    const journal = {
      schemaVersion: 1,
      releaseId: plan.release.releaseId,
      previousReleaseId: plan.currentReleaseId || null,
      files: [],
    };
    let applyStarted = false;
    let launchedPid = null;
    try {
      await waitForExit(plan.gameProcessId, 30_000);
      prepareTarget(plan, staging);
      applyStarted = true;
      applyTarget(plan, staging, backup, journal);
      launchedPid = launchGame(plan, healthFile);
      await waitForHealth(healthFile, launchedPid, 45_000);
      fs.writeFileSync(path.join(backup, 'verified.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    } catch (error) {
      if (launchedPid && processExists(launchedPid)) {
        try { process.kill(launchedPid); } catch { /* already stopped */ }
        await delay(500);
      }
      if (applyStarted) rollback(plan, backup, journal);
      try { launchGame({ ...plan, release: { releaseId: plan.currentReleaseId || '' } }, path.join(work, 'rollback-health.json')); } catch { /* preserve primary error */ }
      throw error;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      cleanupDownloadedPlan(planPath);
    }
  }

  function cleanupDownloadedPlan(planPath) {
    const root = path.resolve(path.dirname(planPath));
    const temporaryRoot = path.resolve(os.tmpdir());
    const relative = path.relative(temporaryRoot, root);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(root).startsWith('rpg-agent-update-')) return;
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  }

  function planArgument() {
    const args = globalThis.nw && nw.App && Array.isArray(nw.App.argv) ? nw.App.argv : process.argv.slice(2);
    const candidate = [...args].reverse().find((value) => typeof value === 'string' && value.toLowerCase().endsWith('.json'));
    if (!candidate) throw new Error('The updater plan path is missing.');
    return path.resolve(candidate);
  }

  const api = { applyBinaryPatch, prepareTarget, applyTarget, rollback, runPlan, safePath, validatePlan };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (process.env.RPG_AGENT_UPDATER_TEST !== '1') {
    Promise.resolve().then(() => runPlan(planArgument())).catch((error) => {
      try {
        const file = path.join(os.tmpdir(), 'rpg-agent-updater-error.log');
        fs.writeFileSync(file, `${new Date().toISOString()} ${error && error.stack || error}\n`, 'utf8');
      } finally {
        if (globalThis.nw && nw.App) nw.App.quit();
      }
    }).then(() => { if (globalThis.nw && nw.App) nw.App.quit(); });
  }
})();
