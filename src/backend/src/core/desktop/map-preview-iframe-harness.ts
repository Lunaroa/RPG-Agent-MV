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
  tileSize: number;
  geometry: { pixelWidth: number; pixelHeight: number };
  overrides: MapPreviewOverrides;
}

export function injectMapPreviewIframeHarness(resourceRootInput: string, options: MapPreviewIframeHarnessOptions): void {
  const resourceRoot = path.resolve(resourceRootInput);
  const scriptDirectory = path.join(resourceRoot, 'js');
  const markerName = 'rpg-agent-preview-marker.js';
  const harnessName = 'rpg-agent-preview-iframe.js';
  fs.writeFileSync(path.join(scriptDirectory, markerName), markerSource(), 'utf8');
  writeMapPreviewIframeHarness(resourceRoot, options);

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

export function writeMapPreviewIframeHarness(resourceRootInput: string, options: MapPreviewIframeHarnessOptions): void {
  const resourceRoot = path.resolve(resourceRootInput);
  fs.writeFileSync(path.join(resourceRoot, 'js', 'rpg-agent-preview-iframe.js'), iframeHarnessSource(options), 'utf8');
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
  var selfSwitchOverrides = Object.create(null);
  var baselineSwitchValues = Object.create(null);
  var baselineVariableValues = Object.create(null);
  var baselineUnsupportedVariableTypes = Object.create(null);
  var baselineSelfSwitchValues = Object.create(null);
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
  var consoleEntryId = 0;
  var eventExecutionEnabled = false;
  var executionPausedForUnsupportedInput = false;
  var executionCheckpoint = null;
  var inputWaitKind = 'none';
  var inputUnsupportedType = null;
  var observedRuntimeMapId = currentMapId;
  var originalInputKeyDown = null;
  var originalInputKeyUp = null;
  var runtimeMapChangeHandling = false;

  replaceObject(switchOverrides, config.overrides && config.overrides.switches);
  replaceObject(variableOverrides, config.overrides && config.overrides.variables);
  replaceObject(selfSwitchOverrides, config.overrides && config.overrides.selfSwitches);

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
  function reportLoadingStage(stage) {
    post('loading-progress', {
      stage: stage,
      mapId: currentTargetMapId,
      mapRevision: currentMapRevision
    });
  }
  function valueType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
  function serializeConsoleValue(value, depth, seen) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'bigint') return String(value) + 'n';
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return '[Function ' + String(value.name || 'anonymous') + ']';
    if (value instanceof Error) return String(value.stack || value.message || value);
    if (depth >= 4) return '[Max Depth]';
    if (seen.indexOf(value) >= 0) return '[Circular]';
    seen.push(value);
    try {
      if (Array.isArray(value)) {
        var arrayItems = value.slice(0, 50).map(function (entry) { return serializeConsoleValue(entry, depth + 1, seen); });
        if (value.length > 50) arrayItems.push('… ' + String(value.length - 50) + ' more');
        return '[' + arrayItems.join(', ') + ']';
      }
      var keys = Object.keys(value).sort();
      var objectItems = keys.slice(0, 50).map(function (key) {
        var rendered;
        try { rendered = serializeConsoleValue(value[key], depth + 1, seen); }
        catch (error) { rendered = '[Thrown: ' + String(error && error.message || error) + ']'; }
        return key + ': ' + rendered;
      });
      if (keys.length > 50) objectItems.push('… ' + String(keys.length - 50) + ' more');
      return '{' + objectItems.join(', ') + '}';
    } finally {
      seen.pop();
    }
  }
  function consoleText(values) {
    var text = values.map(function (value) { return serializeConsoleValue(value, 0, []); }).join(' ');
    return text.length > 16000 ? text.slice(0, 16000) + ' …[truncated]' : text;
  }
  function postConsole(level, source, values, requestId) {
    post('console', {
      entry: {
        id: ++consoleEntryId,
        level: level,
        source: source,
        timestamp: Date.now(),
        text: consoleText(values),
        requestId: requestId || undefined
      }
    });
  }
  function installConsoleCapture() {
    ['debug', 'log', 'info', 'warn', 'error'].forEach(function (level) {
      var original = window.console && console[level];
      if (typeof original !== 'function') return;
      console[level] = function () {
        var values = Array.prototype.slice.call(arguments);
        try { postConsole(level, 'console', values); } catch (_) {}
        return original.apply(console, values);
      };
    });
  }
  async function evaluateCode(command) {
    var requestId = String(command.requestId || '');
    try {
      var result = (0, eval)(String(command.code || ''));
      if (result && typeof result.then === 'function') result = await result;
      postConsole('result', 'evaluation', [result], requestId);
    } catch (error) {
      postConsole('error', 'evaluation', [error], requestId);
    }
  }
  function previewFailure(message, code, stage) {
    var error = new Error(message);
    error.previewFailureCode = code;
    error.previewFailureStage = stage;
    return error;
  }
  installConsoleCapture();
  window.addEventListener('error', function (event) {
    postConsole('error', 'exception', [event && (event.error || event.message)]);
    if (eventExecutionEnabled) {
      if (event && event.preventDefault) event.preventDefault();
      recoverExecutionError(event && (event.error || event.message));
      return;
    }
    reportError(event && (event.error || event.message));
  });
  window.addEventListener('unhandledrejection', function (event) {
    postConsole('error', 'exception', [event && event.reason]);
    if (eventExecutionEnabled) {
      if (event && event.preventDefault) event.preventDefault();
      recoverExecutionError(event && event.reason);
      return;
    }
    reportError(event && event.reason);
  });

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
    if (window.__rpgAgentPreviewFreezeRulesInstalled) return;
    window.__rpgAgentPreviewFreezeRulesInstalled = true;
    if (window.SceneManager) SceneManager.isGameActive = function () { return true; };
    if (window.Input) {
      var originalInputUpdate = Input.update;
      originalInputKeyDown = Input._onKeyDown;
      originalInputKeyUp = Input._onKeyUp;
      if (Input.clear) Input.clear();
      Input.update = function () {
        if (inputWaitKind === 'message' || inputWaitKind === 'choice') return originalInputUpdate.apply(this, arguments);
        if (this.clear) this.clear();
      };
      Input._onKeyDown = function (event) {
        if ((inputWaitKind === 'message' || inputWaitKind === 'choice') && originalInputKeyDown) return originalInputKeyDown.call(this, event);
      };
      Input._onKeyUp = function (event) {
        if ((inputWaitKind === 'message' || inputWaitKind === 'choice') && originalInputKeyUp) return originalInputKeyUp.call(this, event);
      };
    }
    if (window.TouchInput) {
      var originalTouchUpdate = TouchInput.update;
      var originalMouseDown = TouchInput._onMouseDown;
      var originalTouchStart = TouchInput._onTouchStart;
      if (TouchInput.clear) TouchInput.clear();
      TouchInput.update = function () {
        if (inputWaitKind === 'message' || inputWaitKind === 'choice') return originalTouchUpdate.apply(this, arguments);
        if (this.clear) this.clear();
      };
      TouchInput._onMouseDown = function (event) {
        if ((inputWaitKind === 'message' || inputWaitKind === 'choice') && originalMouseDown) return originalMouseDown.call(this, event);
      };
      TouchInput._onTouchStart = function (event) {
        if ((inputWaitKind === 'message' || inputWaitKind === 'choice') && originalTouchStart) return originalTouchStart.call(this, event);
      };
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
    if (window.Game_Event && typeof Game_Event.prototype.update === 'function') {
      var originalEventStart = Game_Event.prototype.start;
      var originalUpdateParallel = Game_Event.prototype.updateParallel;
      Game_Event.prototype.start = function () {
        if (canExecuteEvents() && originalEventStart) return originalEventStart.apply(this, arguments);
      };
      if (typeof originalUpdateParallel === 'function') {
        Game_Event.prototype.updateParallel = function () {
          if (canExecuteEvents()) return originalUpdateParallel.apply(this, arguments);
        };
      }
    } else {
      throw previewFailure('The RPG Maker event update interface is unavailable.', 'map-render-failed', 'install-preview-freeze-rules');
    }
    if (window.Game_Map) {
      var originalMapUpdateInterpreter = Game_Map.prototype.updateInterpreter;
      var originalSetupStartingEvent = Game_Map.prototype.setupStartingEvent;
      Game_Map.prototype.updateInterpreter = function () {
        if (canExecuteEvents()) return originalMapUpdateInterpreter.apply(this, arguments);
      };
      Game_Map.prototype.setupStartingEvent = function () {
        return canExecuteEvents() ? originalSetupStartingEvent.apply(this, arguments) : false;
      };
    }
    if (window.Game_CommonEvent) {
      var originalCommonEventUpdate = Game_CommonEvent.prototype.update;
      Game_CommonEvent.prototype.update = function () {
        if (canExecuteEvents()) return originalCommonEventUpdate.apply(this, arguments);
      };
    }
    if (window.Game_Interpreter) {
      var originalInterpreterUpdate = Game_Interpreter.prototype.update;
      Game_Interpreter.prototype.update = function () {
        if (canExecuteEvents()) return originalInterpreterUpdate.apply(this, arguments);
      };
    }
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
  function canExecuteEvents() {
    return eventExecutionEnabled && !executionPausedForUnsupportedInput;
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
    var unsupportedVariableTypes = Object.create(null);
    var selfSwitches = Object.create(null);
    ($gameSwitches._data || []).forEach(function (value, id) { if (id > 0) switches[id] = Boolean(value); });
    ($gameVariables._data || []).forEach(function (value, id) {
      if (id <= 0) return;
      if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) variables[id] = value;
      else if (value !== undefined) unsupportedVariableTypes[id] = valueType(value);
    });
    Object.keys($gameSelfSwitches && $gameSelfSwitches._data || {}).forEach(function (key) {
      selfSwitches[key] = Boolean($gameSelfSwitches._data[key]);
    });
    Object.keys(baselineUnsupportedVariableTypes).forEach(function (id) {
      unsupportedVariableTypes[id] = baselineUnsupportedVariableTypes[id];
      delete variables[id];
    });
    var eventStates = [];
    if (window.$gameMap && $gameMap.events) {
      $gameMap.events().forEach(function (event) {
        if (!event) return;
        var active = Number(event._pageIndex) >= 0;
        var transparent = event.isTransparent && event.isTransparent();
        var hasGraphic = Number(event.tileId && event.tileId() || 0) > 0 || Boolean(event.characterName && event.characterName());
        var hiddenReason = !active ? 'inactive' : event._erased ? 'erased' : transparent ? 'transparent' : !hasGraphic ? 'no-graphic' : undefined;
        eventStates.push({
          id: Number(event.eventId && event.eventId() || event._eventId),
          x: Number(event.x || 0),
          y: Number(event.y || 0),
          active: active,
          visible: Boolean(active && !event._erased && !transparent && hasGraphic),
          hiddenReason: hiddenReason
        });
      });
    }
    return {
      switchValues: switches,
      variableValues: variables,
      unsupportedVariableTypes: unsupportedVariableTypes,
      selfSwitchValues: selfSwitches,
      eventStates: eventStates
    };
  }
  function cloneRuntimeValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }
  function captureExecutionCheckpoint() {
    return {
      mapId: Number($gameMap.mapId()),
      switches: cloneRuntimeValue($gameSwitches._data || []),
      variables: cloneRuntimeValue($gameVariables._data || []),
      selfSwitches: cloneRuntimeValue($gameSelfSwitches._data || {})
    };
  }
  function stopEventInterpreters() {
    try {
      if ($gameMap && $gameMap._interpreter && $gameMap._interpreter.clear) $gameMap._interpreter.clear();
      if ($gameMap && $gameMap.events) $gameMap.events().forEach(function (event) {
        if (event && event._interpreter && event._interpreter.clear) event._interpreter.clear();
        if (event) event._starting = false;
      });
      if ($gameMap && $gameMap._commonEvents) $gameMap._commonEvents.forEach(function (commonEvent) {
        if (commonEvent && commonEvent._interpreter && commonEvent._interpreter.clear) commonEvent._interpreter.clear();
      });
    } catch (_) {}
  }
  function setInputWait(kind, unsupportedType) {
    if (inputWaitKind === kind && inputUnsupportedType === (unsupportedType || null)) return;
    var previous = inputWaitKind;
    inputWaitKind = kind;
    inputUnsupportedType = unsupportedType || null;
    if (kind === 'none') {
      if (previous !== 'none') post('input-ended');
      return;
    }
    post('input-waiting', {
      input: kind,
      unsupportedType: inputUnsupportedType || undefined,
      sourceMapId: Number($gameMap && $gameMap.mapId && $gameMap.mapId() || currentMapId),
      eventId: Number($gameMap && $gameMap._interpreter && $gameMap._interpreter._eventId || 0) || undefined
    });
  }
  function detectInputWait() {
    if (!eventExecutionEnabled) {
      setInputWait('none');
      return;
    }
    var message = window.$gameMessage;
    var scene = window.SceneManager && SceneManager._scene;
    var unsupported = null;
    if (scene && window.Scene_Name && scene instanceof Scene_Name) unsupported = 'name';
    else if (message && message.isNumberInput && message.isNumberInput()) unsupported = 'number';
    else if (message && message.isItemChoice && message.isItemChoice()) unsupported = 'item';
    if (unsupported) {
      executionPausedForUnsupportedInput = true;
      stopEventInterpreters();
      setInputWait('unsupported', unsupported);
      return;
    }
    if (executionPausedForUnsupportedInput) return;
    if (message && message.isChoice && message.isChoice()) setInputWait('choice');
    else if (message && message.isBusy && message.isBusy()) setInputWait('message');
    else setInputWait('none');
  }
  function sendInputKey(key) {
    if (inputWaitKind !== 'message' && inputWaitKind !== 'choice') return;
    var codes = { left: 37, up: 38, right: 39, down: 40, ok: 13, cancel: 27 };
    var keyCode = codes[String(key || '')];
    if (!keyCode || !originalInputKeyDown || !originalInputKeyUp) return;
    var inputEvent = { keyCode: keyCode, preventDefault: function () {} };
    originalInputKeyDown.call(Input, inputEvent);
    setTimeout(function () { originalInputKeyUp.call(Input, inputEvent); }, 34);
  }
  async function restoreExecutionCheckpoint(reason) {
    if (!executionCheckpoint) return;
    eventExecutionEnabled = false;
    executionPausedForUnsupportedInput = false;
    setInputWait('none');
    stopEventInterpreters();
    $gameSwitches._data = cloneRuntimeValue(executionCheckpoint.switches || []);
    $gameVariables._data = cloneRuntimeValue(executionCheckpoint.variables || []);
    $gameSelfSwitches._data = cloneRuntimeValue(executionCheckpoint.selfSwitches || {});
    var targetMapId = Number(executionCheckpoint.mapId);
    runtimeStage = 'restore-execution-checkpoint';
    $gamePlayer.reserveTransfer(targetMapId, 0, 0, 2, 2);
    SceneManager.goto(Scene_Map);
    await waitFor(function () {
      var scene = SceneManager._scene;
      return scene && scene instanceof Scene_Map && scene._spriteset && SceneManager._sceneStarted !== false
        && (!$gamePlayer.isTransferring || !$gamePlayer.isTransferring())
        && $gameMap.mapId() === targetMapId;
    }, 'execution checkpoint map', 15000);
    currentMapId = targetMapId;
    observedRuntimeMapId = targetMapId;
    currentGeometry = {
      pixelWidth: Number($dataMap.width) * Number(config.tileSize),
      pixelHeight: Number($dataMap.height) * Number(config.tileSize)
    };
    resizeGraphics(currentGeometry);
    $gamePlayer.setTransparent(true);
    $gamePlayer.setThrough(true);
    $gameMap.setDisplayPos(0, 0);
    refreshEvents();
    runtimeStage = 'ready';
    post('runtime-map-changed', Object.assign({
      reason: reason || 'execution-disabled',
      mapId: currentMapId,
      mapPixelWidth: Number(currentGeometry.pixelWidth),
      mapPixelHeight: Number(currentGeometry.pixelHeight),
      eventExecutionEnabled: false,
      checkpointMapId: targetMapId
    }, currentState()));
  }
  async function setEventExecution(enabled) {
    if (enabled) {
      executionCheckpoint = captureExecutionCheckpoint();
      executionPausedForUnsupportedInput = false;
      eventExecutionEnabled = true;
      post('state', Object.assign({ eventExecutionEnabled: true, checkpointMapId: executionCheckpoint.mapId }, currentState()));
      return;
    }
    await restoreExecutionCheckpoint('execution-disabled');
  }
  function recoverExecutionError(error) {
    var message = String(error && (error.stack || error.message) || error || 'Unknown event execution error');
    eventExecutionEnabled = false;
    commandChain = commandChain.then(function () {
      return restoreExecutionCheckpoint('execution-error');
    }).then(function () {
      post('execution-error', {
        message: message.slice(0, 3000),
        sourceMapId: currentSourceMapId || currentMapId,
        checkpointMapId: executionCheckpoint && executionCheckpoint.mapId
      });
    }).catch(reportError);
  }
  async function handleRuntimeMapChange(mapId) {
    if (runtimeMapChangeHandling || !eventExecutionEnabled) return;
    runtimeMapChangeHandling = true;
    try {
      var width = Number(window.$dataMap && $dataMap.width);
      var height = Number(window.$dataMap && $dataMap.height);
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new Error('The transferred map has invalid dimensions.');
      }
      currentMapId = Number(mapId);
      observedRuntimeMapId = currentMapId;
      currentGeometry = {
        pixelWidth: width * Number(config.tileSize),
        pixelHeight: height * Number(config.tileSize)
      };
      resizeGraphics(currentGeometry);
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      $gameMap.setDisplayPos(0, 0);
      post('runtime-map-changed', Object.assign({
        reason: 'event-transfer',
        mapId: currentMapId,
        mapPixelWidth: Number(currentGeometry.pixelWidth),
        mapPixelHeight: Number(currentGeometry.pixelHeight),
        eventExecutionEnabled: true,
        checkpointMapId: executionCheckpoint && executionCheckpoint.mapId
      }, currentState()));
    } catch (error) {
      recoverExecutionError(error);
    } finally {
      runtimeMapChangeHandling = false;
    }
  }
  function resetEventExecution() {
    eventExecutionEnabled = false;
    executionPausedForUnsupportedInput = false;
    executionCheckpoint = null;
    setInputWait('none');
    stopEventInterpreters();
  }
  function captureBaseline() {
    var state = currentState();
    replaceObject(baselineSwitchValues, state.switchValues);
    replaceObject(baselineVariableValues, state.variableValues);
    replaceObject(baselineUnsupportedVariableTypes, state.unsupportedVariableTypes);
    replaceObject(baselineSelfSwitchValues, state.selfSwitchValues);
  }
  function restoreBaseline() {
    Object.keys(switchOverrides).forEach(function (id) { $gameSwitches.setValue(Number(id), Boolean(baselineSwitchValues[id])); });
    Object.keys(variableOverrides).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(baselineUnsupportedVariableTypes, id)) return;
      $gameVariables.setValue(Number(id), Object.prototype.hasOwnProperty.call(baselineVariableValues, id) ? baselineVariableValues[id] : 0);
    });
    Object.keys(selfSwitchOverrides).forEach(function (key) {
      $gameSelfSwitches.setValue(key.split(','), Boolean(baselineSelfSwitchValues[key]));
    });
    replaceObject(switchOverrides, null);
    replaceObject(variableOverrides, null);
    replaceObject(selfSwitchOverrides, null);
    refreshEvents();
  }
  function applyOverrides(overrides) {
    replaceObject(switchOverrides, overrides && overrides.switches);
    replaceObject(variableOverrides, overrides && overrides.variables);
    replaceObject(selfSwitchOverrides, overrides && overrides.selfSwitches);
    Object.keys(switchOverrides).forEach(function (id) { $gameSwitches.setValue(Number(id), Boolean(switchOverrides[id])); });
    Object.keys(variableOverrides).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(baselineUnsupportedVariableTypes, id)) return;
      $gameVariables.setValue(Number(id), variableOverrides[id]);
    });
    Object.keys(selfSwitchOverrides).forEach(function (key) { $gameSelfSwitches.setValue(key.split(','), Boolean(selfSwitchOverrides[key])); });
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
    reportLoadingStage('waiting-for-engine');
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
      reportLoadingStage('waiting-for-boot');
      await waitFor(function () {
        var scene = SceneManager._scene;
        return scene && !(scene instanceof Scene_Boot) && SceneManager._sceneStarted !== false;
      }, 'RPG Maker boot sequence', 18000);
      runtimeStage = 'resize-full-map-renderer';
      resizeGraphics(currentGeometry);
      runtimeStage = 'prepare-game-objects';
      resetEventExecution();
      reportLoadingStage('resetting-game-state');
      DataManager.setupNewGame();
      initialized = true;
      captureBaseline();
      applyOverrides(command.overrides || {});
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      runtimeStage = 'transfer-map';
      reportLoadingStage('loading-map');
      $gamePlayer.reserveTransfer(currentTargetMapId, 0, 0, 2, 2);
      SceneManager.goto(Scene_Map);
      await waitFor(function () {
        var scene = SceneManager._scene;
        return scene && scene instanceof Scene_Map && scene._spriteset && SceneManager._sceneStarted !== false
          && (!$gamePlayer.isTransferring || !$gamePlayer.isTransferring())
          && $gameMap.mapId() === currentTargetMapId;
      }, 'map scene', 15000);
      runtimeStage = 'map-resources';
      reportLoadingStage('loading-map-resources');
      await waitFor(function () {
        if (failedResources.length) throw new Error('One or more map resources failed to load.');
        return (!window.ImageManager || !ImageManager.isReady || ImageManager.isReady())
          && (!SceneManager._scene.isReady || SceneManager._scene.isReady());
      }, 'map resources', 15000);
      currentMapId = currentTargetMapId;
      observedRuntimeMapId = currentMapId;
      currentSourceMapId = currentMapId;
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      $gameMap.setDisplayPos(0, 0);
      runtimeStage = 'ready';
      loading = false;
      resetFpsSample();
      post('ready', Object.assign({
        mapId: currentMapId,
        mapPixelWidth: Number(currentGeometry.pixelWidth),
        mapPixelHeight: Number(currentGeometry.pixelHeight),
        viewportWidth: Number(config.viewportWidth),
        viewportHeight: Number(config.viewportHeight),
        eventExecutionEnabled: false,
        checkpointMapId: undefined,
        input: 'none'
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
      resetEventExecution();
      restoreBaseline();
      applyOverrides(command.overrides || {});
      resumeLoop();
      post('ready', Object.assign({
        mapId: currentMapId,
        mapPixelWidth: Number(currentGeometry.pixelWidth),
        mapPixelHeight: Number(currentGeometry.pixelHeight),
        viewportWidth: Number(config.viewportWidth),
        viewportHeight: Number(config.viewportHeight),
        eventExecutionEnabled: false,
        checkpointMapId: undefined,
        input: 'none'
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
      var value = command.value;
      if (!(typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('Variable override must be a finite number or string.');
      }
      variableOverrides[Number(command.id)] = value;
      $gameVariables.setValue(Number(command.id), value);
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'set-self-switch') {
      var key = String(command.key || '');
      if (!/^[1-9]\\d*,[1-9]\\d*,[ABCD]$/.test(key)) throw new Error('Self switch key is invalid.');
      selfSwitchOverrides[key] = Boolean(command.value);
      $gameSelfSwitches.setValue(key.split(','), Boolean(command.value));
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'evaluate') {
      return evaluateCode(command);
    }
    if (command.type === 'reset-overrides') {
      restoreBaseline();
      sendState();
      return;
    }
    if (command.type === 'set-event-execution') {
      return setEventExecution(Boolean(command.enabled));
    }
    if (command.type === 'input-key') {
      sendInputKey(command.key);
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
    detectInputWait();
    if (eventExecutionEnabled && window.$gameMap && $gameMap.mapId && !$gamePlayer.isTransferring()) {
      var runtimeMapId = Number($gameMap.mapId());
      if (runtimeMapId > 0 && runtimeMapId !== observedRuntimeMapId) void handleRuntimeMapChange(runtimeMapId);
    }
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
