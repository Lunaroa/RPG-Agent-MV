/*:
 * @target MV MZ
 * @plugindesc RPG Agent update checker, package chooser, integrity verification, and platform handoff.
 * @author RPG Agent MV contributors
 * @help
 * Requires RPGAgentVersion above this plugin.
 * Use RPGAgentUpdater.open() or the RPGAgentVersion CheckForUpdates command.
 */
(() => {
  'use strict';

  const state = { checking: false, downloading: false, lastError: null, available: null, progress: null };
  let preparedDownload = null;

  function releaseConfig() {
    const config = globalThis.$dataRPGAgentRelease;
    if (!config || typeof config !== 'object') throw new Error('RPGAgentRelease.json is not loaded.');
    if (!globalThis.RPGAgentVersion) throw new Error('RPGAgentVersion must load before RPGAgentUpdater.');
    return config;
  }

  function platform() {
    if (globalThis.RPGAgentAndroid && typeof globalThis.RPGAgentAndroid.installContentUpdate === 'function') return 'android';
    if (globalThis.process && process.versions && process.versions.nw) return 'windows';
    return 'web';
  }

  function architecture() {
    if (platform() === 'android' && globalThis.RPGAgentAndroid.getAbi) return String(globalThis.RPGAgentAndroid.getAbi());
    if (platform() === 'windows' && globalThis.process) {
      return process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64';
    }
    return 'web';
  }

  function currentLanguage() {
    return globalThis.ConfigManager && ConfigManager.language
      ? String(ConfigManager.language)
      : (globalThis.navigator && navigator.language) || 'en-US';
  }

  function selectText(map, language, fallback) {
    if (!map || typeof map !== 'object') throw new Error('Release text is missing.');
    if (typeof map[language] === 'string' && map[language]) return map[language];
    if (typeof map[fallback] === 'string' && map[fallback]) return map[fallback];
    throw new Error(`Release text is missing both ${language} and default language ${fallback}.`);
  }

  function validateIndex(index) {
    if (!index || index.schemaVersion !== 1 || typeof index.generatedAt !== 'string'
      || !index.games || typeof index.games !== 'object' || Array.isArray(index.games)) {
      throw new Error('The update index has an unsupported format.');
    }
    return index;
  }

  function validateRelease(release, channelName) {
    if (!release || typeof release.releaseId !== 'string' || typeof release.version !== 'string'
      || release.channel !== channelName || typeof release.defaultLanguage !== 'string'
      || typeof release.required !== 'boolean' || !Array.isArray(release.packages)) {
      throw new Error('The current release record is invalid.');
    }
    RPGAgentVersion.compare(release.version);
    for (const pkg of release.packages) validatePackage(pkg);
    return release;
  }

  function validatePackage(pkg) {
    if (!pkg || typeof pkg.packageId !== 'string' || !['web', 'windows', 'android'].includes(pkg.platform)
      || typeof pkg.architecture !== 'string' || !['full', 'file-delta', 'binary-diff'].includes(pkg.packageType)
      || !['content', 'apk'].includes(pkg.delivery) || typeof pkg.url !== 'string'
      || !Number.isSafeInteger(pkg.bytes) || pkg.bytes < 0 || !/^[a-f0-9]{64}$/i.test(String(pkg.sha256 || ''))
      || !Array.isArray(pkg.targetFiles) || !Array.isArray(pkg.deletedFiles)) {
      throw new Error('An update package record is invalid.');
    }
  }

  function decodeBase64(value, label) {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} is not valid base64.`);
    let binary;
    try { binary = atob(value); } catch { throw new Error(`${label} is not valid base64.`); }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function manifestPayload(gameId, game) {
    return new TextEncoder().encode(`${JSON.stringify({
      schemaVersion: 1,
      gameId,
      channels: game.channels,
    }, null, 2)}\n`);
  }

  async function digestHex(value) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', value);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function verifyGameManifest(gameId, game, configured) {
    if (!configured || configured.enabled !== true) return;
    if (configured.algorithm !== 'ECDSA-P256-SHA256'
      || typeof configured.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(configured.keyId)) {
      throw new Error('The embedded update manifest signing configuration is invalid.');
    }
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error('This runtime cannot verify signed update manifests.');
    }
    const publicKeyBytes = decodeBase64(configured.publicKey, 'The embedded update manifest public key');
    if (await digestHex(publicKeyBytes) !== configured.keyId) {
      throw new Error('The embedded update manifest key id does not match its public key.');
    }
    const signature = game && game.signature;
    if (!signature || signature.schemaVersion !== 1 || signature.algorithm !== configured.algorithm
      || signature.keyId !== configured.keyId || typeof signature.payloadSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(signature.payloadSha256)) {
      throw new Error('The update manifest signature is missing or does not match this game.');
    }
    const payload = manifestPayload(gameId, game);
    if (await digestHex(payload) !== signature.payloadSha256) {
      throw new Error('The signed update manifest payload has been changed.');
    }
    const signatureBytes = decodeBase64(signature.value, 'The update manifest signature');
    if (signatureBytes.byteLength !== 64) throw new Error('The update manifest signature has an invalid length.');
    let key;
    try {
      key = await globalThis.crypto.subtle.importKey(
        'spki',
        publicKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
    } catch (error) {
      throw new Error(`The embedded update manifest public key could not be imported: ${error instanceof Error ? error.message : String(error)}`);
    }
    const valid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signatureBytes,
      payload,
    );
    if (!valid) throw new Error('The update manifest signature verification failed.');
  }

  function gameDirectory() {
    if (platform() !== 'windows') return '';
    const path = require('node:path');
    return path.dirname(process.execPath);
  }

  function currentReleaseRecord() {
    if (platform() === 'android' && globalThis.RPGAgentAndroid.getCurrentReleaseId) {
      return { releaseId: String(RPGAgentAndroid.getCurrentReleaseId() || '') };
    }
    if (platform() === 'windows') {
      try {
        const fs = require('node:fs');
        const path = require('node:path');
        const file = path.join(gameDirectory(), '.rpg-agent', 'current-release.json');
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && typeof value.releaseId === 'string' ? value : { releaseId: '' };
      } catch { return { releaseId: '' }; }
    }
    try { return { releaseId: localStorage.getItem('rpgAgentReleaseId') || '' }; } catch { return { releaseId: '' }; }
  }

  function compareReleaseVersions(left, right) {
    const pattern = /^(\d+)\.(\d+)\.(\d+)(?: *-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/;
    const a = pattern.exec(left);
    const b = pattern.exec(right);
    if (!a || !b) throw new Error('The update index contains an invalid game version.');
    for (let index = 1; index <= 3; index += 1) {
      const x = a[index].replace(/^0+(?=\d)/, '');
      const y = b[index].replace(/^0+(?=\d)/, '');
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function compatiblePackages(release) {
    const target = platform();
    const arch = architecture();
    const baseline = currentReleaseRecord().releaseId;
    return release.packages.filter((item) => {
      if (item.platform !== target) return false;
      if (item.architecture !== arch && item.architecture !== 'universal'
        && !(target === 'web' && item.architecture === 'web')) return false;
      if (item.packageType === 'full') return true;
      return Boolean(baseline && item.baseReleaseId === baseline);
    });
  }

  async function check(options = {}) {
    const config = releaseConfig();
    if (!config.update.enabled) return { status: 'disabled' };
    if (!config.update.indexUrl) throw new Error('The update index URL is empty.');
    state.checking = true;
    state.lastError = null;
    try {
      const response = await fetch(config.update.indexUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}.`);
      const index = validateIndex(await response.json());
      const game = index.games[config.gameId];
      if (!game || !game.channels || typeof game.channels !== 'object') {
        throw new Error('The configured game is missing from the update index.');
      }
      await verifyGameManifest(config.gameId, game, config.update.manifestSignature);
      const channel = game.channels[config.channel];
      if (!channel || !Array.isArray(channel.releases)) throw new Error('The configured game or channel is missing from the update index.');
      const release = channel.latestReleaseId
        ? channel.releases.find((candidate) => candidate && candidate.releaseId === channel.latestReleaseId)
        : null;
      if (!release) return { status: 'current', maintenance: channel.maintenance || null };
      validateRelease(release, config.channel);
      const compared = compareReleaseVersions(RPGAgentVersion.getVersion(), release.version);
      if (compared > 0
        || (compared === 0 && release.releaseId === currentReleaseRecord().releaseId)
        || (compared === 0 && options.manual === false)) {
        return { status: 'current', maintenance: channel.maintenance || null };
      }
      const packages = compatiblePackages(release);
      if (!packages.length) return { status: 'unavailable', release, maintenance: channel.maintenance || null };
      const result = { status: 'available', release, packages, maintenance: channel.maintenance || null };
      state.available = result;
      if (options.show !== false) show(result);
      return result;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      if (options.show !== false) showError(state.lastError);
      return { status: 'error', error: state.lastError };
    } finally {
      state.checking = false;
    }
  }

  function overlay(title, body, actions) {
    document.getElementById('rpg-agent-updater-overlay')?.remove();
    const host = document.createElement('div');
    host.id = 'rpg-agent-updater-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:999999;display:grid;place-items:center;background:rgba(0,0,0,.72);font-family:sans-serif';
    const panel = document.createElement('div');
    panel.style.cssText = 'box-sizing:border-box;width:min(600px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;padding:22px;border-radius:8px;background:#171a20;color:#f3f5f7;box-shadow:0 20px 60px rgba(0,0,0,.45)';
    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = 'margin:0 0 12px;font-size:20px';
    const content = document.createElement('div');
    content.textContent = body;
    content.style.cssText = 'white-space:pre-wrap;line-height:1.6;color:#cfd5dc';
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:18px';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.style.cssText = 'min-height:34px;padding:0 14px;border:1px solid #68717e;border-radius:4px;background:#252a32;color:#fff;cursor:pointer';
      button.onclick = () => action.run(host, content, button);
      footer.appendChild(button);
    }
    panel.append(heading, content, footer);
    host.appendChild(panel);
    document.body.appendChild(host);
    return host;
  }

  function show(result) {
    const release = result.release;
    const language = currentLanguage();
    const title = selectText(release.title, language, release.defaultLanguage);
    const summary = selectText(release.summary, language, release.defaultLanguage);
    const maintenance = result.maintenance ? selectText(result.maintenance, language, release.defaultLanguage) : '';
    const repairing = compareReleaseVersions(RPGAgentVersion.getVersion(), release.version) === 0;
    const body = `${summary}\n\n${release.publishedAt || ''}${maintenance ? `\n\n${maintenance}` : ''}`;
    const required = release.required === true || releaseConfig().update.policy === 'required';
    const packages = sortedPackages(result.packages);
    const actions = packages.map((pkg) => ({
      label: `${repairing ? 'Repair current version' : packageLabel(pkg)} · ${formatBytes(pkg.bytes)}`,
      run: (_host, content, button) => download(result, pkg, content, button),
    }));
    actions.unshift(required
      ? { label: 'Exit', run: () => exitGame() }
      : { label: 'Later', run: (host) => host.remove() });
    overlay(title || `Update ${release.version}`, body, actions);
  }

  function sortedPackages(packages) {
    return [...packages].sort((left, right) => {
      if (platform() === 'android' && left.delivery !== right.delivery) return left.delivery === 'content' ? -1 : 1;
      const rank = { 'binary-diff': 0, 'file-delta': 1, full: 2 };
      return rank[left.packageType] - rank[right.packageType] || left.bytes - right.bytes;
    });
  }

  function packageLabel(pkg) {
    if (pkg.delivery === 'apk') return 'Install APK';
    return ({ full: 'Full update', 'file-delta': 'File update', 'binary-diff': 'Binary patch' })[pkg.packageType] || pkg.packageType;
  }

  function showError(message) {
    overlay('Update check failed', `${message}\n\nThe current game can still be played.`, [
      { label: 'Close', run: (host) => host.remove() },
    ]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  function packageUrl(relative) {
    return new URL(String(relative), releaseConfig().update.indexUrl).toString();
  }

  function childUrl(base, relativePath) {
    const encoded = String(relativePath).split('/').map(encodeURIComponent).join('/');
    return new URL(encoded, base.endsWith('/') ? base : `${base}/`).toString();
  }

  async function sha256(buffer) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function fetchBuffer(url, expectedBytes, progress) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Download returned HTTP ${response.status}: ${url}`);
    const total = Number(response.headers.get('content-length')) || Number(expectedBytes) || 0;
    const reader = response.body && response.body.getReader();
    if (!reader) return response.arrayBuffer();
    const chunks = [];
    let received = 0;
    const startedAt = Date.now();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      received += part.value.byteLength;
      progress(received, total, received * 1000 / Math.max(1, Date.now() - startedAt));
    }
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  }

  async function downloadDirectory(pkg, content) {
    if (platform() !== 'windows') throw new Error('Directory update downloads are handled by the native platform bridge.');
    if (!Array.isArray(pkg.packageFiles) || !pkg.packageFiles.length) {
      throw new Error('This directory package has no downloadable file manifest.');
    }
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const nodeCrypto = require('node:crypto');
    const updateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-update-'));
    const packageDirectory = path.join(updateRoot, 'package');
    const sorted = [...pkg.packageFiles].sort((left, right) => left.path.localeCompare(right.path, 'en'));
    const directoryHash = nodeCrypto.createHash('sha256');
    let totalReceived = 0;
    const startedAt = Date.now();
    try {
      for (const file of sorted) {
        const buffer = await fetchBuffer(childUrl(packageUrl(pkg.url), file.path), file.bytes, (received) => {
          const completed = totalReceived + received;
          const bytesPerSecond = completed * 1000 / Math.max(1, Date.now() - startedAt);
          state.progress = { received: completed, total: pkg.bytes, bytesPerSecond };
          if (content) content.textContent = `Downloading ${formatBytes(completed)} / ${formatBytes(pkg.bytes)} · ${formatBytes(bytesPerSecond)}/s…`;
        });
        const digest = await sha256(buffer);
        if (digest !== String(file.sha256).toLowerCase() || buffer.byteLength !== file.bytes) {
          throw new Error(`Downloaded update file failed verification: ${file.path}.`);
        }
        const destination = safeDownloadPath(packageDirectory, file.path, path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, Buffer.from(buffer));
        totalReceived += buffer.byteLength;
        directoryHash.update(`${file.path}\0${file.bytes}\0${digest}\n`, 'utf8');
      }
      if (totalReceived !== pkg.bytes || directoryHash.digest('hex') !== String(pkg.sha256).toLowerCase()) {
        throw new Error('Downloaded update directory failed package verification.');
      }
      state.progress = { received: totalReceived, total: pkg.bytes, bytesPerSecond: totalReceived * 1000 / Math.max(1, Date.now() - startedAt) };
      return { updateRoot, packageDirectory };
    } catch (error) {
      fs.rmSync(updateRoot, { recursive: true, force: true });
      throw error;
    }
  }

  function safeDownloadPath(root, relativePath, path) {
    const portable = String(relativePath || '').replace(/\\/g, '/');
    if (!portable || path.posix.isAbsolute(portable) || path.win32.isAbsolute(relativePath)
      || portable.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Unsafe package path: ${relativePath}.`);
    }
    const target = path.resolve(root, ...portable.split('/'));
    const relative = path.relative(path.resolve(root), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe package path: ${relativePath}.`);
    return target;
  }

  async function download(result, pkg, content, button) {
    if (state.downloading) return;
    state.downloading = true;
    button.disabled = true;
    try {
      if (platform() === 'web') throw new Error('Web releases are updated by deploying the new site content. This browser copy cannot replace its own files.');
      if (platform() === 'android') {
        content.textContent = 'Handing the verified release information to Android…';
        const payload = JSON.stringify({
          indexUrl: releaseConfig().update.indexUrl,
          packageUrl: packageUrl(pkg.url),
          pkg,
          release: result.release,
        });
        const accepted = pkg.delivery === 'apk'
          ? RPGAgentAndroid.installApkUpdate(payload)
          : RPGAgentAndroid.installContentUpdate(payload);
        if (accepted === false) throw new Error('Android declined the update handoff.');
        return;
      }
      let downloaded;
      if (preparedDownload
        && preparedDownload.releaseId === result.release.releaseId
        && preparedDownload.packageId === pkg.packageId) {
        downloaded = preparedDownload.downloaded;
        preparedDownload = null;
      } else {
        discardPreparedDownload();
        downloaded = await downloadDirectory(pkg, content);
      }
      content.textContent = 'Download verified. Exit the game to apply the update…';
      handoffWindowsUpdate(pkg, result.release, downloaded);
    } catch (error) {
      content.textContent = `${error instanceof Error ? error.message : String(error)}\n\nThe current game was not changed.`;
      button.disabled = false;
    } finally {
      state.downloading = false;
    }
  }

  function backgroundStatus() {
    document.getElementById('rpg-agent-updater-background')?.remove();
    const status = document.createElement('div');
    status.id = 'rpg-agent-updater-background';
    status.textContent = 'Preparing update…';
    status.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999998;max-width:min(420px,calc(100% - 32px));padding:10px 12px;border:1px solid #68717e;border-radius:6px;background:#171a20;color:#f3f5f7;font:13px/1.4 sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)';
    document.body.appendChild(status);
    return status;
  }

  function discardPreparedDownload() {
    if (!preparedDownload) return;
    try {
      require('node:fs').rmSync(preparedDownload.downloaded.updateRoot, { recursive: true, force: true });
    } catch (error) {
      console.error('[RPGAgentUpdater] could not remove a prepared update', error);
    }
    preparedDownload = null;
  }

  async function prepareBackgroundUpdate(result) {
    if (platform() !== 'windows') {
      show(result);
      return;
    }
    const pkg = sortedPackages(result.packages)[0];
    if (!pkg) {
      show(result);
      return;
    }
    if (preparedDownload
      && preparedDownload.releaseId === result.release.releaseId
      && preparedDownload.packageId === pkg.packageId) {
      show(result);
      return;
    }
    discardPreparedDownload();
    const status = backgroundStatus();
    state.downloading = true;
    state.lastError = null;
    state.progress = { received: 0, total: pkg.bytes, bytesPerSecond: 0 };
    try {
      const downloaded = await downloadDirectory(pkg, status);
      preparedDownload = { releaseId: result.release.releaseId, packageId: pkg.packageId, downloaded };
      status.remove();
      show(result);
    } catch (error) {
      status.remove();
      state.lastError = error instanceof Error ? error.message : String(error);
      showError(state.lastError);
    } finally {
      state.downloading = false;
    }
  }

  async function runAutomaticCheck() {
    const config = releaseConfig();
    const background = config.update.backgroundDownload === true && platform() === 'windows';
    const result = await check({ show: !background, manual: false });
    if (background && result.status === 'available') await prepareBackgroundUpdate(result);
    else if (background && result.status === 'error') showError(result.error);
  }

  function handoffWindowsUpdate(pkg, release, downloaded) {
    const fs = require('node:fs');
    const path = require('node:path');
    const childProcess = require('node:child_process');
    const directory = gameDirectory();
    const planPath = path.join(downloaded.updateRoot, 'plan.json');
    const helperDirectory = path.join(directory, '.rpg-agent', 'updater');
    const executable = path.join(directory, 'Game.exe');
    if (!fs.existsSync(path.join(helperDirectory, 'package.json')) || !fs.existsSync(executable)) {
      fs.rmSync(downloaded.updateRoot, { recursive: true, force: true });
      throw new Error('The external Windows update launcher is missing from this game build.');
    }
    fs.writeFileSync(planPath, JSON.stringify({
      schemaVersion: 1,
      gameProcessId: process.pid,
      gameDirectory: directory,
      packageDirectory: downloaded.packageDirectory,
      gameId: releaseConfig().gameId,
      currentReleaseId: currentReleaseRecord().releaseId,
      pkg,
      release,
    }, null, 2));
    childProcess.spawn(executable, [helperDirectory, planPath], {
      cwd: directory,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    exitGame();
  }

  function completeWindowsHealthCheck() {
    if (platform() !== 'windows') return;
    try {
      const args = [
        ...(globalThis.nw && nw.App && Array.isArray(nw.App.argv) ? nw.App.argv : []),
        ...(globalThis.process && Array.isArray(process.argv) ? process.argv : []),
      ];
      const health = args.find((value) => String(value).startsWith('--rpg-agent-update-health='));
      const expected = args.find((value) => String(value).startsWith('--rpg-agent-expected-release='));
      if (!health || !expected) return;
      const healthFile = String(health).slice('--rpg-agent-update-health='.length);
      const expectedReleaseId = String(expected).slice('--rpg-agent-expected-release='.length);
      if (!healthFile || currentReleaseRecord().releaseId !== expectedReleaseId) {
        throw new Error('The updated game did not start with the expected release id.');
      }
      const fs = require('node:fs');
      const path = require('node:path');
      const temporary = `${healthFile}.${process.pid}.tmp`;
      fs.mkdirSync(path.dirname(healthFile), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ ok: true, version: RPGAgentVersion.getVersion(), releaseId: expectedReleaseId }));
      fs.renameSync(temporary, healthFile);
    } catch (error) {
      console.error('[RPGAgentUpdater] startup self-check failed', error);
    }
  }

  function exitGame() {
    if (globalThis.nw && nw.App) nw.App.quit();
    else if (globalThis.SceneManager) SceneManager.exit();
  }

  const api = Object.freeze({
    check,
    open() { return check({ show: true, manual: true }); },
    getState() { return { ...state }; },
  });
  globalThis.RPGAgentUpdater = api;

  const originalBootStart = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function() {
    const result = originalBootStart.apply(this, arguments);
    completeWindowsHealthCheck();
    try {
      const config = releaseConfig();
      if (config.update.enabled && config.update.checkOnStart) setTimeout(() => runAutomaticCheck(), 0);
    } catch (error) {
      console.error('[RPGAgentUpdater]', error);
    }
    return result;
  };
})();
