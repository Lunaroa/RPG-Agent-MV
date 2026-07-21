import fs from 'node:fs';
import path from 'node:path';

import type { MapPreviewOverrides } from '../../../../contract/types.ts';

export interface MapPreviewIframeHarnessOptions {
  sessionId: string;
  channelToken: string;
  mapId: number;
  mapRevision: string;
  operationId: number;
  viewportWidth: number;
  viewportHeight: number;
  geometry: { pixelWidth: number; pixelHeight: number };
  overrides: MapPreviewOverrides;
}

export function injectMapPreviewIframeHarness(resourceRootInput: string, options: MapPreviewIframeHarnessOptions): void {
  const resourceRoot = path.resolve(resourceRootInput);
  const scriptDirectory = path.join(resourceRoot, 'js');
  const markerName = 'rpg-agent-preview-marker.js';
  const harnessName = 'rpg-agent-preview-iframe.js';
  fs.writeFileSync(path.join(scriptDirectory, markerName), markerSource(), 'utf8');
  fs.writeFileSync(path.join(scriptDirectory, harnessName), iframeHarnessSource(options), 'utf8');

  const indexPath = path.join(resourceRoot, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const firstScript = /<script\b/i;
  if (!firstScript.test(index)) throw new Error('Cannot find an RPG Maker script entry in the isolated preview.');
  fs.writeFileSync(indexPath, index.replace(firstScript, `<script src="js/${markerName}"></script>\n<script`), 'utf8');

  const mainPath = path.join(scriptDirectory, 'main.js');
  const main = fs.readFileSync(mainPath, 'utf8');
  const dynamicPluginsEntry = /(["']js\/plugins\.js["'])(\s*\])/;
  if (dynamicPluginsEntry.test(main)) {
    fs.writeFileSync(mainPath, main.replace(dynamicPluginsEntry, `$1,\n    "js/${harnessName}"$2`), 'utf8');
    return;
  }

  const updatedIndex = fs.readFileSync(indexPath, 'utf8');
  const mainEntry = /(<script\b[^>]*\bsrc=["']js\/main\.js["'][^>]*><\/script>)/i;
  if (!mainEntry.test(updatedIndex)) throw new Error('Cannot find the RPG Maker main script in the isolated preview.');
  fs.writeFileSync(indexPath, updatedIndex.replace(mainEntry, `<script src="js/${harnessName}"></script>\n$1`), 'utf8');
}

function markerSource(): string {
  return `/* Generated only inside an isolated RPG Agent map preview. */
(function () {
  'use strict';
  var descriptor = Object.getOwnPropertyDescriptor(window, '__rpg_agent_debugger__');
  if (descriptor) {
    if (descriptor.value !== true || descriptor.writable !== false || descriptor.configurable !== false) {
      window.__rpgAgentPreviewMarkerConflict = 'The project already defines an incompatible preview debug marker.';
    }
    return;
  }
  Object.defineProperty(window, '__rpg_agent_debugger__', {
    value: true,
    writable: false,
    configurable: false,
    enumerable: false
  });
}());
`;
}

function iframeHarnessSource(options: MapPreviewIframeHarnessOptions): string {
  const config = JSON.stringify(options).replace(/</g, '\\u003c');
  return `/* Generated only inside an isolated RPG Agent map preview. */
(function () {
  'use strict';
  var config = ${config};
  if (window.__rpgAgentIframePreviewInstalled) return;
  window.__rpgAgentIframePreviewInstalled = true;
  var switchOverrides = Object.create(null);
  var variableOverrides = Object.create(null);
  var baselineSwitchValues = Object.create(null);
  var baselineVariableValues = Object.create(null);
  var failedResources = [];
  var currentMapId = Number(config.mapId);
  var currentMapRevision = String(config.mapRevision || '');
  var currentOperationId = Number(config.operationId);
  var currentGeometry = config.geometry;
  var currentSourceMapId = 0;
  var currentTargetMapId = currentMapId;
  var initialized = false;
  var loading = false;
  var suspended = false;
  var runtimeStage = 'bootstrap';
  var commandChain = Promise.resolve();
  var fpsFrames = 0;
  var fpsStartedAt = performance.now();
  var styleElement = null;

  replaceObject(switchOverrides, config.overrides && config.overrides.switches);
  replaceObject(variableOverrides, config.overrides && config.overrides.variables);

  function post(phase, value) {
    window.parent.postMessage(Object.assign({
      kind: 'rpg-agent-map-preview',
      sessionId: config.sessionId,
      channelToken: config.channelToken,
      operationId: currentOperationId,
      mapId: currentMapId,
      mapRevision: currentMapRevision,
      phase: phase
    }, value || {}), '*');
  }
  function reportError(error) {
    var message = String(error && (error.stack || error.message) || error || 'Unknown map preview error');
    var scene = window.SceneManager && SceneManager._scene;
    var resourcesReady = false;
    try { resourcesReady = !window.ImageManager || !ImageManager.isReady || ImageManager.isReady(); } catch (_) {}
    post('error', {
      failureCode: error && error.previewFailureCode || 'map-render-failed',
      stage: error && error.previewFailureStage || runtimeStage,
      sourceMapId: currentSourceMapId,
      targetMapId: currentTargetMapId,
      scene: scene && scene.constructor ? scene.constructor.name : null,
      transferring: Boolean(window.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring()),
      resourcesReady: resourcesReady,
      resources: failedResources.slice(0, 50),
      message: message.slice(0, 3000)
    });
  }
  function previewFailure(message, code, stage) {
    var error = new Error(message);
    error.previewFailureCode = code;
    error.previewFailureStage = stage;
    return error;
  }
  window.addEventListener('error', function (event) { reportError(event && (event.error || event.message)); });
  window.addEventListener('unhandledrejection', function (event) { reportError(event && event.reason); });

  function waitFor(predicate, label, timeout) {
    var deadline = Date.now() + (timeout || 15000);
    return new Promise(function (resolve, reject) {
      (function poll() {
        try {
          if (predicate()) return resolve();
          if (Date.now() >= deadline) return reject(new Error('Timed out waiting for ' + label + '.'));
        } catch (error) { return reject(error); }
        setTimeout(poll, 16);
      }());
    });
  }
  function replaceObject(target, source) {
    Object.keys(target).forEach(function (id) { delete target[id]; });
    Object.keys(source || {}).forEach(function (id) { target[id] = source[id]; });
  }
  function installResourceTracking() {
    if (!window.Bitmap || !Bitmap.prototype || Bitmap.prototype.__rpgAgentIframeErrorTracking) return;
    var original = Bitmap.prototype._onError;
    Bitmap.prototype._onError = function () {
      var resource = String(this && this._url || '');
      if (resource && failedResources.indexOf(resource) < 0) failedResources.push(resource);
      if (typeof original === 'function') return original.apply(this, arguments);
    };
    Bitmap.prototype.__rpgAgentIframeErrorTracking = true;
  }
  function installFreezeRules() {
    if (window.SceneManager) SceneManager.isGameActive = function () { return true; };
    if (window.Input) {
      if (Input.clear) Input.clear();
      Input.update = function () { this._currentState = {}; this._latestButton = null; };
      Input._onKeyDown = function () {};
      Input._onKeyUp = function () {};
    }
    if (window.TouchInput) {
      if (TouchInput.clear) TouchInput.clear();
      TouchInput.update = function () {};
      TouchInput._onMouseDown = function () {};
      TouchInput._onTouchStart = function () {};
    }
    if (window.Game_Player) {
      Game_Player.prototype.moveByInput = function () {};
      Game_Player.prototype.canMove = function () { return false; };
      Game_Player.prototype.updateScroll = function () {};
      Game_Player.prototype.updateVehicle = function () {};
      Game_Player.prototype.triggerAction = function () { return false; };
      Game_Player.prototype.checkEventTriggerHere = function () {};
      Game_Player.prototype.checkEventTriggerThere = function () {};
      Game_Player.prototype.checkEventTriggerTouch = function () {};
    }
    if (window.Game_Event && window.Game_CharacterBase && typeof Game_CharacterBase.prototype.updateAnimation === 'function') {
      Game_Event.prototype.update = function () { Game_CharacterBase.prototype.updateAnimation.call(this); };
      Game_Event.prototype.start = function () {};
      Game_Event.prototype.updateSelfMovement = function () {};
    } else {
      throw previewFailure('The RPG Maker character animation interface is unavailable.', 'map-render-failed', 'install-preview-freeze-rules');
    }
    if (window.Game_Map) {
      Game_Map.prototype.updateInterpreter = function () {};
      Game_Map.prototype.setupStartingEvent = function () { return false; };
    }
    if (window.Game_CommonEvent) Game_CommonEvent.prototype.update = function () {};
    if (window.Game_Interpreter) Game_Interpreter.prototype.update = function () {};
    if (window.Utils && Utils.RPGMAKER_NAME === 'MZ' && window.Scene_Map) {
      Scene_Map.prototype.createMenuButton = function () { this._menuButton = null; };
    }
    if (window.DataManager) {
      var mz = window.Utils && Utils.RPGMAKER_NAME === 'MZ';
      DataManager.saveGame = function () { return mz ? Promise.resolve(false) : false; };
      DataManager.saveGameWithoutRescue = function () { return mz ? Promise.resolve(false) : false; };
      if (mz && window.Scene_Base) Scene_Base.prototype.requestAutosave = function () {};
    }
    if (window.AudioManager) {
      if (AudioManager.stopAll) AudioManager.stopAll();
      AudioManager.playBgm = function () {};
      AudioManager.playBgs = function () {};
      AudioManager.playMe = function () {};
      AudioManager.playSe = function () {};
      AudioManager.playStaticSe = function () {};
    }
  }
  function installMvFullMapTilemapSupport() {
    if (!window.Utils || Utils.RPGMAKER_NAME !== 'MV' || !window.Graphics || !Graphics.isWebGL || !Graphics.isWebGL()) return;
    var tilemap = window.PIXI && PIXI.tilemap;
    var renderer = Graphics._renderer;
    var tileRenderer = renderer && renderer.plugins && renderer.plugins.tilemap;
    var tileRendererPrototype = tilemap && tilemap.TileRenderer && tilemap.TileRenderer.prototype;
    var rectLayerPrototype = tilemap && tilemap.RectTileLayer && tilemap.RectTileLayer.prototype;
    if (!tileRenderer || !tileRendererPrototype || !rectLayerPrototype) {
      throw previewFailure('The MV WebGL tilemap interface is unavailable.', 'map-render-failed', 'install-full-map-tilemap-indexing');
    }
    if (tileRendererPrototype.__rpgAgentFullMapIndexingInstalled) return;
    var originalRenderWebGL = rectLayerPrototype.renderWebGL;
    if (typeof originalRenderWebGL !== 'function') {
      throw previewFailure('The MV WebGL tile layer renderer is unavailable.', 'map-render-failed', 'install-full-map-tilemap-indexing');
    }
    tileRendererPrototype.checkIndexBuffer = function (rectCount) {
      var count = Math.max(0, Math.floor(Number(rectCount) || 0));
      var requiresUint32 = this.indices instanceof Uint32Array || count * 4 > 65535;
      var gl = this.renderer && this.renderer.gl;
      if (!gl) {
        throw previewFailure('The MV WebGL context is unavailable.', 'map-render-failed', 'render-full-map-tilemap');
      }
      if (requiresUint32 && !gl.getExtension('OES_element_index_uint')) {
        throw previewFailure('This graphics environment cannot render the complete MV tilemap with 32-bit indices.', 'map-render-failed', 'render-full-map-tilemap');
      }
      var IndexArray = requiresUint32 ? Uint32Array : Uint16Array;
      var totalIndices = count * 6;
      var indices = this.indices;
      if (indices instanceof IndexArray && totalIndices <= indices.length) {
        this.__rpgAgentIndexType = requiresUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        return;
      }
      var length = indices && indices.length || totalIndices || 6;
      while (length < totalIndices) length *= 2;
      indices = new IndexArray(length);
      for (var index = 0, vertex = 0; index + 5 < indices.length; index += 6, vertex += 4) {
        indices[index] = vertex;
        indices[index + 1] = vertex + 1;
        indices[index + 2] = vertex + 2;
        indices[index + 3] = vertex;
        indices[index + 4] = vertex + 2;
        indices[index + 5] = vertex + 3;
      }
      this.indices = indices;
      if (this.indexBuffer) this.indexBuffer.upload(indices);
      else this.indexBuffer = PIXI.glCore.GLBuffer.createIndexBuffer(gl, indices, gl.STATIC_DRAW);
      if (this.rectShader) this.rectShader.indexBuffer = this.indexBuffer;
      if (this.squareShader) this.squareShader.indexBuffer = this.indexBuffer;
      this.__rpgAgentIndexType = requiresUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    };
    rectLayerPrototype.renderWebGL = function (pixiRenderer, useSquare) {
      if (useSquare) return originalRenderWebGL.call(this, pixiRenderer, useSquare);
      var gl = pixiRenderer && pixiRenderer.gl;
      var activeTileRenderer = pixiRenderer && pixiRenderer.plugins && pixiRenderer.plugins.tilemap;
      if (!gl || !activeTileRenderer) return originalRenderWebGL.call(this, pixiRenderer, useSquare);
      var originalDrawElements = gl.drawElements;
      gl.drawElements = function (mode, count, type, offset) {
        var indexType = activeTileRenderer.__rpgAgentIndexType || type;
        return originalDrawElements.call(gl, mode, count, indexType, offset);
      };
      try {
        return originalRenderWebGL.call(this, pixiRenderer, useSquare);
      } finally {
        gl.drawElements = originalDrawElements;
      }
    };
    tileRendererPrototype.__rpgAgentFullMapIndexingInstalled = true;
  }
  function rendererMaximumTextureSize() {
    try {
      var renderer = Graphics.app && Graphics.app.renderer || Graphics._renderer;
      var gl = renderer && (renderer.gl || renderer.context && renderer.context.gl);
      return gl && gl.getParameter ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096 : 4096;
    } catch (_) { return 4096; }
  }
  function resizeGraphics(geometry) {
    var width = Math.max(1, Math.floor(Number(geometry.pixelWidth)));
    var height = Math.max(1, Math.floor(Number(geometry.pixelHeight)));
    var maximum = rendererMaximumTextureSize();
    if (width > maximum || height > maximum || width * height > 67108864) {
      throw previewFailure('The complete map is larger than the embedded renderer can create.', 'map-render-failed', 'resize-full-map-renderer');
    }
    if (typeof Graphics.resize === 'function') Graphics.resize(width, height);
    else {
      Graphics._width = width;
      Graphics._height = height;
      Graphics._boxWidth = width;
      Graphics._boxHeight = height;
      if (Graphics._updateAllElements) Graphics._updateAllElements();
    }
    Graphics._boxWidth = width;
    Graphics._boxHeight = height;
    if (window.SceneManager) {
      SceneManager._screenWidth = width;
      SceneManager._screenHeight = height;
      SceneManager._boxWidth = width;
      SceneManager._boxHeight = height;
    }
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'rpg-agent-preview-layout';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = 'html,body{width:' + width + 'px!important;height:' + height + 'px!important;margin:0!important;overflow:hidden!important;background:#000!important}'
      + 'canvas{position:absolute!important;left:0!important;top:0!important;margin:0!important;width:' + width + 'px!important;height:' + height + 'px!important;transform:none!important}'
      + '#loadingSpinner,#errorPrinter{display:none!important}';
  }
  function refreshEvents() {
    if (!window.$gameMap || !$gameMap.events) return;
    if ($gameMap.requestRefresh) $gameMap.requestRefresh();
    $gameMap.events().forEach(function (event) { if (event && event.refresh) event.refresh(); });
  }
  function currentState() {
    var switches = Object.create(null);
    var variables = Object.create(null);
    ($gameSwitches._data || []).forEach(function (value, id) { if (id > 0) switches[id] = Boolean(value); });
    ($gameVariables._data || []).forEach(function (value, id) {
      if (id > 0 && Number.isFinite(Number(value))) variables[id] = Number(value);
    });
    return { switchValues: switches, variableValues: variables };
  }
  function captureBaseline() {
    replaceObject(baselineSwitchValues, currentState().switchValues);
    replaceObject(baselineVariableValues, currentState().variableValues);
  }
  function restoreBaseline() {
    Object.keys(switchOverrides).forEach(function (id) { $gameSwitches.setValue(Number(id), Boolean(baselineSwitchValues[id])); });
    Object.keys(variableOverrides).forEach(function (id) { $gameVariables.setValue(Number(id), Number(baselineVariableValues[id] || 0)); });
    replaceObject(switchOverrides, null);
    replaceObject(variableOverrides, null);
    refreshEvents();
  }
  function applyOverrides(overrides) {
    replaceObject(switchOverrides, overrides && overrides.switches);
    replaceObject(variableOverrides, overrides && overrides.variables);
    Object.keys(switchOverrides).forEach(function (id) { $gameSwitches.setValue(Number(id), Boolean(switchOverrides[id])); });
    Object.keys(variableOverrides).forEach(function (id) { $gameVariables.setValue(Number(id), Number(variableOverrides[id])); });
    refreshEvents();
  }
  function sendState() { post('state', currentState()); }
  function resetFpsSample() {
    fpsFrames = 0;
    fpsStartedAt = performance.now();
  }
  function resumeLoop() {
    if (!suspended) return;
    suspended = false;
    resetFpsSample();
    if (window.SceneManager && typeof SceneManager.resume === 'function') SceneManager.resume();
    else if (window.SceneManager && typeof SceneManager.requestUpdate === 'function') SceneManager.requestUpdate();
  }
  function suspendLoop() {
    if (suspended) return;
    if (window.SceneManager && typeof SceneManager.stop === 'function') SceneManager.stop();
    suspended = true;
    resetFpsSample();
    post('suspended');
  }
  async function loadMap(purpose, command) {
    if (loading) throw new Error('A map preview load is already active.');
    loading = true;
    failedResources = [];
    currentSourceMapId = currentMapId;
    currentTargetMapId = Number(command.mapId);
    currentOperationId = Number(command.operationId);
    currentMapRevision = String(command.mapRevision || '');
    currentGeometry = command.geometry;
    runtimeStage = 'wait-for-engine';
    resetFpsSample();
    post('loading-map', { mapId: currentTargetMapId, mapRevision: currentMapRevision });
    try {
      await waitFor(function () {
        return window.DataManager && window.SceneManager && window.Scene_Map && DataManager.isDatabaseLoaded && DataManager.isDatabaseLoaded();
      }, 'RPG Maker database', 18000);
      if (window.__rpgAgentPreviewMarkerConflict) {
        throw previewFailure(window.__rpgAgentPreviewMarkerConflict, 'preview-debug-marker-conflict', 'preview-debug-marker');
      }
      installFreezeRules();
      installMvFullMapTilemapSupport();
      installResourceTracking();
      resumeLoop();
      runtimeStage = 'wait-for-boot';
      await waitFor(function () {
        var scene = SceneManager._scene;
        return scene && !(scene instanceof Scene_Boot) && SceneManager._sceneStarted !== false;
      }, 'RPG Maker boot sequence', 18000);
      runtimeStage = 'resize-full-map-renderer';
      resizeGraphics(currentGeometry);
      runtimeStage = 'prepare-game-objects';
      if (!initialized) {
        DataManager.setupNewGame();
        initialized = true;
      } else {
        restoreBaseline();
      }
      captureBaseline();
      applyOverrides(command.overrides || {});
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      runtimeStage = 'transfer-map';
      $gamePlayer.reserveTransfer(currentTargetMapId, 0, 0, 2, 2);
      SceneManager.goto(Scene_Map);
      await waitFor(function () {
        var scene = SceneManager._scene;
        return scene && scene instanceof Scene_Map && scene._spriteset && SceneManager._sceneStarted !== false
          && (!$gamePlayer.isTransferring || !$gamePlayer.isTransferring())
          && $gameMap.mapId() === currentTargetMapId;
      }, 'map scene', 15000);
      runtimeStage = 'map-resources';
      await waitFor(function () {
        if (failedResources.length) throw new Error('One or more map resources failed to load.');
        return (!window.ImageManager || !ImageManager.isReady || ImageManager.isReady())
          && (!SceneManager._scene.isReady || SceneManager._scene.isReady());
      }, 'map resources', 15000);
      currentMapId = currentTargetMapId;
      currentSourceMapId = currentMapId;
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      $gameMap.setDisplayPos(0, 0);
      runtimeStage = 'ready';
      resetFpsSample();
      post('ready', Object.assign({
        mapId: currentMapId,
        mapPixelWidth: Number(currentGeometry.pixelWidth),
        mapPixelHeight: Number(currentGeometry.pixelHeight),
        viewportWidth: Number(config.viewportWidth),
        viewportHeight: Number(config.viewportHeight)
      }, currentState()));
    } finally {
      loading = false;
    }
  }
  function handleCommand(command) {
    if (!command || typeof command !== 'object') return;
    if (Number(command.operationId) < currentOperationId) return;
    if (command.type === 'suspend') {
      if (Number(command.operationId) === currentOperationId) suspendLoop();
      return;
    }
    if (command.type === 'resume') {
      currentOperationId = Number(command.operationId);
      if (command.purpose === 'switch' || command.purpose === 'reload') {
        resumeLoop();
        return loadMap(command.purpose, command);
      }
      restoreBaseline();
      applyOverrides(command.overrides || {});
      resumeLoop();
      post('ready', Object.assign({
        mapId: currentMapId,
        mapPixelWidth: Number(currentGeometry.pixelWidth),
        mapPixelHeight: Number(currentGeometry.pixelHeight),
        viewportWidth: Number(config.viewportWidth),
        viewportHeight: Number(config.viewportHeight)
      }, currentState()));
      return;
    }
    if (command.type === 'set-switch') {
      switchOverrides[Number(command.id)] = Boolean(command.value);
      $gameSwitches.setValue(Number(command.id), Boolean(command.value));
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'set-variable') {
      var value = Number(command.value);
      if (!Number.isFinite(value)) throw new Error('Variable override must be finite.');
      variableOverrides[Number(command.id)] = value;
      $gameVariables.setValue(Number(command.id), value);
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'reset-overrides') {
      restoreBaseline();
      sendState();
      return;
    }
    if (command.type === 'replace-overrides') {
      restoreBaseline();
      applyOverrides(command.overrides || {});
      sendState();
    }
  }
  window.addEventListener('message', function (event) {
    var command = event && event.data;
    if (event.source !== window.parent || !command || command.kind !== 'rpg-agent-map-preview-command') return;
    if (command.sessionId !== config.sessionId || command.channelToken !== config.channelToken) return;
    commandChain = commandChain.then(function () { return handleCommand(command.command); }).catch(reportError);
  });
  (function fpsLoop() {
    requestAnimationFrame(fpsLoop);
    if (suspended || loading || !initialized || runtimeStage !== 'ready') return;
    fpsFrames += 1;
    var now = performance.now();
    if (now - fpsStartedAt < 1000) return;
    post('fps', { fps: Math.max(0, Math.min(60, Math.round(fpsFrames * 1000 / (now - fpsStartedAt)))) });
    fpsFrames = 0;
    fpsStartedAt = now;
  }());
  setTimeout(function () {
    loadMap('fresh', {
      mapId: config.mapId,
      mapRevision: config.mapRevision,
      operationId: config.operationId,
      geometry: config.geometry,
      overrides: config.overrides
    }).catch(reportError);
  }, 0);
}());
`;
}
