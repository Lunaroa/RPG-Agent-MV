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
  let nativeUpdateUi = null;
  const UI_TEXT = {
    'en-US': {
      repair: 'Repair current version', exit: 'Exit', later: 'Later', reload: 'Reload',
      installApk: 'Install APK', full: 'Full update', fileDelta: 'File update', binaryDiff: 'Binary patch',
      checkFailed: 'Update check failed', playable: 'The current game can still be played.', close: 'Close',
      unknownSize: 'Unknown size', webUpdate: 'This Web release is updated by deploying new site files. Reload after the site owner has published the update.',
      androidHandoff: 'Handing the verified release information to Android…',
      androidDownloading: 'Downloading {received} / {total} · {speed}/s…',
      androidVerifying: 'Verifying the downloaded update…', androidInstalling: 'Opening the Android installer…',
      updateReady: 'The update is ready. Restart or reload the game to use it.', unchanged: 'The current game was not changed.',
      preparing: 'Preparing update…', downloading: 'Downloading {received} / {total} · {speed}/s…',
      verifiedExit: 'Download verified. Exit the game to apply the update…',
      updateTitle: 'Update {version}',
    },
    'zh-CN': {
      repair: '修复当前版本', exit: '退出游戏', later: '稍后再说', reload: '重新载入',
      installApk: '安装 APK', full: '完整更新', fileDelta: '文件更新', binaryDiff: '二进制补丁',
      checkFailed: '检查更新失败', playable: '当前游戏仍可正常游玩。', close: '关闭',
      unknownSize: '大小未知', webUpdate: 'Web 版需要由站点维护者先部署新文件。部署完成后，请重新载入页面。',
      androidHandoff: '正在把已验证的发行信息交给 Android…',
      androidDownloading: '正在下载 {received} / {total} · {speed}/秒…',
      androidVerifying: '正在校验下载内容…', androidInstalling: '正在打开 Android 安装程序…',
      updateReady: '更新已经准备完成，请重启或重新载入游戏。', unchanged: '当前游戏没有被修改。',
      preparing: '正在准备更新…', downloading: '正在下载 {received} / {total} · {speed}/秒…',
      verifiedExit: '下载和校验已完成，退出游戏后将开始安装…',
      updateTitle: '更新到 {version}',
    },
    'ja-JP': {
      repair: '現在のバージョンを修復', exit: 'ゲームを終了', later: '後で', reload: '再読み込み',
      installApk: 'APK をインストール', full: '完全更新', fileDelta: 'ファイル更新', binaryDiff: '差分パッチ',
      checkFailed: '更新の確認に失敗しました', playable: '現在のゲームは引き続きプレイできます。', close: '閉じる',
      unknownSize: 'サイズ不明', webUpdate: 'Web 版はサイト管理者が新しいファイルを公開して更新します。公開後に再読み込みしてください。',
      androidHandoff: '確認済みのリリース情報を Android に渡しています…',
      androidDownloading: '{received} / {total} をダウンロード中 · {speed}/秒…',
      androidVerifying: 'ダウンロードを検証しています…', androidInstalling: 'Android インストーラーを開いています…',
      updateReady: '更新の準備が完了しました。ゲームを再起動または再読み込みしてください。', unchanged: '現在のゲームは変更されていません。',
      preparing: '更新を準備しています…', downloading: '{received} / {total} をダウンロード中 · {speed}/秒…',
      verifiedExit: 'ダウンロードの検証が完了しました。ゲームを終了すると更新を適用します…',
      updateTitle: 'バージョン {version} に更新',
    },
  };

  function releaseConfig() {
    const config = window.$dataRPGAgentRelease;
    if (!config || typeof config !== 'object') throw new Error('RPGAgentRelease.json is not loaded.');
    if (!window.RPGAgentVersion) throw new Error('RPGAgentVersion must load before RPGAgentUpdater.');
    return config;
  }

  function platform() {
    if (window.RPGAgentAndroid && typeof window.RPGAgentAndroid.installContentUpdate === 'function') return 'android';
    if (window.process && process.versions && process.versions.nw) return 'windows';
    return 'web';
  }

  function architecture() {
    if (platform() === 'android' && window.RPGAgentAndroid.getAbi) return String(window.RPGAgentAndroid.getAbi());
    if (platform() === 'windows' && window.process) {
      return process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64';
    }
    return 'web';
  }

  function currentLanguage() {
    const config = window.$dataRPGAgentRelease;
    const value = (window.$dataSystem && $dataSystem.locale)
      || (config && config.update && config.update.defaultLanguage)
      || (window.ConfigManager && ConfigManager.language)
      || (window.navigator && navigator.language)
      || 'en-US';
    return normalizeLanguage(value);
  }

  function normalizeLanguage(value) {
    const language = String(value || 'en-US').replace(/_/g, '-');
    const lower = language.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-cn') || lower.startsWith('zh-hans')) return 'zh-CN';
    if (lower === 'ja' || lower.startsWith('ja-')) return 'ja-JP';
    if (lower === 'en' || lower.startsWith('en-')) return 'en-US';
    return language;
  }

  function ui(key, values = {}) {
    const language = currentLanguage();
    const dictionary = UI_TEXT[language] || UI_TEXT[language.split('-')[0]] || UI_TEXT['en-US'];
    const template = dictionary[key] || UI_TEXT['en-US'][key] || key;
    return template.replace(/\{([^}]+)\}/g, (_match, name) => String(values[name] == null ? '' : values[name]));
  }

  function selectText(map, language, fallback) {
    if (!map || typeof map !== 'object') throw new Error('Release text is missing.');
    if (typeof map[language] === 'string' && map[language]) return map[language];
    if (typeof map[fallback] === 'string' && map[fallback]) return map[fallback];
    throw new Error(`Release text is missing both ${language} and default language ${fallback}.`);
  }

  function validateIndex(index) {
    if (!index || index.schemaVersion !== 2 || typeof index.generatedAt !== 'string'
      || !index.games || typeof index.games !== 'object' || Array.isArray(index.games)) {
      throw new Error('The update index must use schemaVersion 2. Ask the developer to regenerate the publication index.');
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
    try { binary = atob(value); } catch (_error) { throw new Error(`${label} is not valid base64.`); }
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
    const digest = await window.crypto.subtle.digest('SHA-256', value);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function verifyGameManifest(gameId, game, configured) {
    if (!configured || configured.enabled !== true) return;
    if (configured.algorithm !== 'ECDSA-P256-SHA256'
      || typeof configured.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(configured.keyId)) {
      throw new Error('The embedded update manifest signing configuration is invalid.');
    }
    if (!window.crypto || !window.crypto.subtle) {
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
      key = await window.crypto.subtle.importKey(
        'spki',
        publicKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
    } catch (error) {
      throw new Error(`The embedded update manifest public key could not be imported: ${error instanceof Error ? error.message : String(error)}`);
    }
    const valid = await window.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signatureBytes,
      payload,
    );
    if (!valid) throw new Error('The update manifest signature verification failed.');
  }

  function gameDirectory() {
    if (platform() !== 'windows') return '';
    const path = require('path');
    return path.dirname(process.execPath);
  }

  function currentReleaseRecord() {
    if (platform() === 'android' && window.RPGAgentAndroid.getCurrentReleaseId) {
      return { releaseId: String(RPGAgentAndroid.getCurrentReleaseId() || '') };
    }
    if (platform() === 'windows') {
      try {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(gameDirectory(), '.rpg-agent', 'current-release.json');
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && typeof value.releaseId === 'string' ? value : { releaseId: '' };
      } catch (_error) { return { releaseId: '' }; }
    }
    try { return { releaseId: localStorage.getItem('rpgAgentReleaseId') || '' }; } catch (_error) { return { releaseId: '' }; }
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
      if (!channel.latestReleaseIds || typeof channel.latestReleaseIds !== 'object' || Array.isArray(channel.latestReleaseIds)) {
        throw new Error('The update index has no per-platform current releases. Ask the developer to regenerate the publication index.');
      }
      const target = platform();
      const releaseId = channel.latestReleaseIds[`${target}/${architecture()}`] || channel.latestReleaseIds[`${target}/universal`];
      const release = releaseId ? channel.releases.find((candidate) => candidate && candidate.releaseId === releaseId) : null;
      if (releaseId && !release) throw new Error('The current platform release does not exist in this channel.');
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
    const previous = document.getElementById('rpg-agent-updater-overlay');
    if (previous) previous.remove();
    const host = document.createElement('div');
    host.id = 'rpg-agent-updater-overlay';
    // Keep game input handlers from canceling clicks or receiving synthesized mouse events.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel',
      'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      host.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
    }
    host.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);font-family:sans-serif';
    const panel = document.createElement('div');
    panel.style.cssText = 'box-sizing:border-box;width:calc(100% - 32px);max-width:600px;max-height:calc(100% - 32px);overflow:auto;padding:22px;border-radius:8px;background:#171a20;color:#f3f5f7;box-shadow:0 20px 60px rgba(0,0,0,.45)';
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
    const webNotice = platform() === 'web' ? `\n\n${ui('webUpdate')}` : '';
    const body = `${summary}\n\n${release.publishedAt || ''}${maintenance ? `\n\n${maintenance}` : ''}${webNotice}`;
    const required = release.required === true || releaseConfig().update.policy === 'required';
    const packages = sortedPackages(result.packages);
    const actions = platform() === 'web'
      ? [{ label: ui('reload'), run: () => reloadGame() }]
      : packages.map((pkg) => ({
        label: `${repairing ? ui('repair') : packageLabel(pkg)} · ${formatBytes(pkg.bytes)}`,
        run: (_host, content, button) => download(result, pkg, content, button),
      }));
    actions.unshift(required
      ? { label: ui('exit'), run: () => exitGame() }
      : { label: ui('later'), run: (host) => host.remove() });
    overlay(title || ui('updateTitle', { version: release.version }), body, actions);
  }

  function sortedPackages(packages) {
    return [...packages].sort((left, right) => {
      if (platform() === 'android' && left.delivery !== right.delivery) return left.delivery === 'content' ? -1 : 1;
      const rank = { 'binary-diff': 0, 'file-delta': 1, full: 2 };
      return rank[left.packageType] - rank[right.packageType] || left.bytes - right.bytes;
    });
  }

  function packageLabel(pkg) {
    if (pkg.delivery === 'apk') return ui('installApk');
    return ({ full: ui('full'), 'file-delta': ui('fileDelta'), 'binary-diff': ui('binaryDiff') })[pkg.packageType] || pkg.packageType;
  }

  function showError(message) {
    overlay(ui('checkFailed'), `${message}\n\n${ui('playable')}`, [
      { label: ui('close'), run: (host) => host.remove() },
    ]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return ui('unknownSize');
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  function packageUrl(relative) {
    const parsed = new URL(String(relative), releaseConfig().update.indexUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('The update package URL must use HTTP or HTTPS.');
    }
    return parsed.toString();
  }

  function childUrl(base, relativePath) {
    const encoded = String(relativePath).split('/').map(encodeURIComponent).join('/');
    return new URL(encoded, base.endsWith('/') ? base : `${base}/`).toString();
  }

  async function sha256(buffer) {
    const digest = await window.crypto.subtle.digest('SHA-256', buffer);
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
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const nodeCrypto = require('crypto');
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
          if (content) content.textContent = ui('downloading', {
            received: formatBytes(completed), total: formatBytes(pkg.bytes), speed: formatBytes(bytesPerSecond),
          });
        });
        const digest = await sha256(buffer);
        if (digest !== String(file.sha256).toLowerCase() || buffer.byteLength !== file.bytes) {
          throw new Error(`Downloaded update file failed verification: ${file.path}.`);
        }
        const destination = safeDownloadPath(packageDirectory, file.path, path);
        windowsFileSystem().ensureDirectory(path.dirname(destination));
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
      removeUpdateDirectory(updateRoot);
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
    state.lastError = null;
    state.progress = null;
    button.disabled = true;
    let nativePending = false;
    try {
      if (platform() === 'android') {
        content.textContent = ui('androidHandoff');
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
        nativePending = true;
        nativeUpdateUi = { content, button };
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
      content.textContent = ui('verifiedExit');
      handoffWindowsUpdate(pkg, result.release, downloaded);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      content.textContent = `${state.lastError}\n\n${ui('unchanged')}`;
      button.disabled = false;
    } finally {
      if (!nativePending) state.downloading = false;
    }
  }

  function handleNativeEvent(input) {
    let event = input;
    if (typeof input === 'string') {
      try { event = JSON.parse(input); } catch (_error) { return false; }
    }
    if (!event || typeof event !== 'object' || typeof event.stage !== 'string') return false;
    const received = Number(event.received) || 0;
    const total = Number(event.total) || 0;
    const bytesPerSecond = Number(event.bytesPerSecond) || 0;
    if (event.stage === 'downloading') {
      state.progress = { received, total, bytesPerSecond };
      if (nativeUpdateUi) nativeUpdateUi.content.textContent = ui('androidDownloading', {
        received: formatBytes(received), total: formatBytes(total), speed: formatBytes(bytesPerSecond),
      });
      return true;
    }
    if (event.stage === 'verifying') {
      if (nativeUpdateUi) nativeUpdateUi.content.textContent = ui('androidVerifying');
      return true;
    }
    if (event.stage === 'installing') {
      if (nativeUpdateUi) nativeUpdateUi.content.textContent = ui('androidInstalling');
      return true;
    }
    if (event.stage === 'complete') {
      state.downloading = false;
      state.lastError = null;
      state.progress = { received, total, bytesPerSecond };
      if (nativeUpdateUi) nativeUpdateUi.content.textContent = ui('updateReady');
      nativeUpdateUi = null;
      return true;
    }
    if (event.stage === 'error') {
      state.downloading = false;
      state.lastError = typeof event.message === 'string' ? event.message : ui('checkFailed');
      if (nativeUpdateUi) {
        nativeUpdateUi.content.textContent = `${state.lastError}\n\n${ui('unchanged')}`;
        nativeUpdateUi.button.disabled = false;
      }
      nativeUpdateUi = null;
      return true;
    }
    return false;
  }

  function backgroundStatus() {
    const previous = document.getElementById('rpg-agent-updater-background');
    if (previous) previous.remove();
    const status = document.createElement('div');
    status.id = 'rpg-agent-updater-background';
    status.textContent = ui('preparing');
    status.style.cssText = 'box-sizing:border-box;position:fixed;right:16px;bottom:16px;z-index:999998;width:420px;max-width:calc(100% - 32px);padding:10px 12px;border:1px solid #68717e;border-radius:6px;background:#171a20;color:#f3f5f7;font:13px/1.4 sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)';
    document.body.appendChild(status);
    return status;
  }

  function discardPreparedDownload() {
    if (!preparedDownload) return;
    try {
      removeUpdateDirectory(preparedDownload.downloaded.updateRoot);
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

  function windowsFileSystem() {
    const path = require('path');
    return require(path.join(gameDirectory(), '.rpg-agent', 'updater', 'filesystem.cjs'));
  }

  function removeUpdateDirectory(directory) {
    windowsFileSystem().removeDirectory(directory);
  }

  function handoffWindowsUpdate(pkg, release, downloaded) {
    const fs = require('fs');
    const path = require('path');
    const childProcess = require('child_process');
    const directory = gameDirectory();
    const planPath = path.join(downloaded.updateRoot, 'plan.json');
    const helperDirectory = path.join(directory, '.rpg-agent', 'updater');
    const helperEntry = path.join(helperDirectory, 'launcher.js');
    const executable = path.join(directory, 'Game.exe');
    if (!fs.existsSync(helperEntry) || !fs.existsSync(executable)) {
      removeUpdateDirectory(downloaded.updateRoot);
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
    childProcess.spawn(executable, [helperEntry, planPath], {
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
        ...(typeof nw !== 'undefined' && nw.App && Array.isArray(nw.App.argv) ? nw.App.argv : []),
        ...(window.process && Array.isArray(process.argv) ? process.argv : []),
      ];
      const health = args.find((value) => String(value).startsWith('--rpg-agent-update-health='));
      const expected = args.find((value) => String(value).startsWith('--rpg-agent-expected-release='));
      if (!health || !expected) return;
      const healthFile = String(health).slice('--rpg-agent-update-health='.length);
      const expectedReleaseId = String(expected).slice('--rpg-agent-expected-release='.length);
      if (!healthFile || currentReleaseRecord().releaseId !== expectedReleaseId) {
        throw new Error('The updated game did not start with the expected release id.');
      }
      const fs = require('fs');
      const path = require('path');
      const temporary = `${healthFile}.${process.pid}.tmp`;
      windowsFileSystem().ensureDirectory(path.dirname(healthFile));
      fs.writeFileSync(temporary, JSON.stringify({ ok: true, version: RPGAgentVersion.getVersion(), releaseId: expectedReleaseId }));
      fs.renameSync(temporary, healthFile);
    } catch (error) {
      console.error('[RPGAgentUpdater] startup self-check failed', error);
    }
  }

  function exitGame() {
    if (typeof nw !== 'undefined' && nw.App) nw.App.quit();
    else if (window.SceneManager) SceneManager.exit();
  }

  function reloadGame() {
    if (window.location && typeof location.reload === 'function') location.reload();
  }

  const api = Object.freeze({
    check,
    open() { return check({ show: true, manual: true }); },
    getState() { return { ...state }; },
    handleNativeEvent,
  });
  window.RPGAgentUpdater = api;

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
