/*:
 * @author Luna RPG Agent
 * @plugindesc MZ UI Designer Runtime v1.1.0 (MV/MZ)
 * @target MZ
 * @target MV
 * @param AutoRegister
 * @text Scan and register stable Scene_*.json files on boot
 * @type boolean
 * @default true
 */
(function installMZUIRuntime(global) {
  'use strict';

  var VERSION = '1.1.0';
  var SCENE_DIRECTORY_DEFAULT = 'js/plugins/mzui-data';
  var BUILTIN_SCENE_NAMES = {
    Scene_Title: true,
    Scene_Map: true,
    Scene_Menu: true,
    Scene_Item: true,
    Scene_Skill: true,
    Scene_Equip: true,
    Scene_Status: true,
    Scene_Options: true,
    Scene_Load: true,
    Scene_Save: true,
    Scene_Battle: true,
    Scene_Shop: true,
    Scene_Name: true,
    Scene_Gameover: true,
    Scene_End: true,
    Scene_GameEnd: true,
    Scene_Debug: true,
  };
  var NODE_TYPES = {
    container: true,
    sprite: true,
    nineSlice: true,
    frameAnimation: true,
    button: true,
    text: true,
    progressBar: true,
    overlay: true,
    video: true,
    particle: true,
  };
  // All trusted Runtime callbacks use one stable ABI.  The named helpers are
  // injected once per invocation; the Function objects themselves are still
  // compiled once when the scene is mounted.
  var CODE_ARGUMENTS = ['runtime', 'context', 'node', 'props', 'event', 'self', 'scene', '$sw', '$var', '$setSw', '$setVar'];

  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function finite(value, fallback) { return typeof value === 'number' && isFinite(value) ? value : fallback; }
  function errorText(error) { return error && error.message ? error.message : String(error); }

  function ensureSceneMessageHost(scene) {
    if (!scene) throw new Error('The active MV/MZ scene is unavailable for message display.');
    if (scene._messageWindow) return scene._messageWindow;
    if (!global.$gameMessage || typeof global.$gameMessage.add !== 'function') throw new Error('The project MV/MZ game-message state is unavailable.');
    if (typeof scene.createWindowLayer !== 'function') throw new Error('The active MV/MZ scene cannot create an official message window layer.');
    if (!scene._windowLayer) scene.createWindowLayer();
    var engine = global.Utils && String(global.Utils.RPGMAKER_NAME || '').toUpperCase();
    if (engine === 'MZ') {
      var messagePrototype = global.Scene_Message && global.Scene_Message.prototype;
      var required = ['createAllWindows', 'createMessageWindow', 'messageWindowRect', 'createScrollTextWindow', 'scrollTextWindowRect', 'createGoldWindow', 'goldWindowRect', 'createNameBoxWindow', 'createChoiceListWindow', 'createNumberInputWindow', 'createEventItemWindow', 'eventItemWindowRect', 'associateWindows'];
      if (!messagePrototype) throw new Error('The project MZ Scene_Message contract is unavailable.');
      required.forEach(function (name) {
        if (typeof messagePrototype[name] !== 'function') throw new Error('The project MZ Scene_Message contract is incomplete: ' + name);
        if (typeof scene[name] !== 'function') scene[name] = messagePrototype[name];
      });
      scene.createAllWindows();
    } else if (engine === 'MV') {
      var mapPrototype = global.Scene_Map && global.Scene_Map.prototype;
      if (!mapPrototype || typeof mapPrototype.createMessageWindow !== 'function') throw new Error('The project MV message-window contract is unavailable.');
      mapPrototype.createMessageWindow.call(scene);
    } else {
      throw new Error('The RPG Maker engine is unsupported for message display: ' + String(engine || 'unknown'));
    }
    if (!scene._messageWindow) throw new Error('The project MV/MZ message window was not created.');
    return scene._messageWindow;
  }

  function canonicalizeLegacySceneScriptSource(source) {
    var output = '';
    var index = 0;
    var state = 'code';
    while (index < source.length) {
      var current = source[index];
      var next = source[index + 1];
      if (state === 'line-comment') { output += current; index += 1; if (current === '\n') state = 'code'; continue; }
      if (state === 'block-comment') {
        output += current; index += 1;
        if (current === '*' && next === '/') { output += next; index += 1; state = 'code'; }
        continue;
      }
      if (state !== 'code') {
        output += current; index += 1;
        if (current === '\\' && index < source.length) { output += source[index]; index += 1; continue; }
        if ((state === 'single' && current === "'") || (state === 'double' && current === '"') || (state === 'template' && current === '`') || (state === 'regex' && current === '/')) state = 'code';
        continue;
      }
      if (current === '/' && next === '/') { output += '//'; index += 2; state = 'line-comment'; continue; }
      if (current === '/' && next === '*') { output += '/*'; index += 2; state = 'block-comment'; continue; }
      if (current === '/') {
        var previousMatch = source.slice(0, index).match(/\S(?=\s*$)/);
        var previous = previousMatch ? previousMatch[0] : '';
        if (!previous || /[({\[=,:;!&|?+\-*%^~<>]/.test(previous)) { output += current; index += 1; state = 'regex'; continue; }
      }
      if (current === "'") { output += current; index += 1; state = 'single'; continue; }
      if (current === '"') { output += current; index += 1; state = 'double'; continue; }
      if (current === '`') { output += current; index += 1; state = 'template'; continue; }
      var lifecycle = source.slice(index, index + 7) === 'onReady' ? 'onReady' : source.slice(index, index + 8) === 'onUpdate' ? 'onUpdate' : null;
      if (lifecycle) {
        var before = source[index - 1] || '';
        var after = source[index + lifecycle.length] || '';
        if (!/[\w$]/.test(before) && before !== '.' && !/[\w$]/.test(after)) { output += 'scene.' + lifecycle; index += lifecycle.length; continue; }
      }
      output += current;
      index += 1;
    }
    return output;
  }

  function canonicalizeRuntimeScene(scene) {
    if (!object(scene)) throw new Error('UI scene must be an object.');
    if (scene.version === '1.1.0') {
      if (!object(scene.sceneScript) || typeof scene.sceneScript.source !== 'string') throw new Error('UI scene requires a one-file sceneScript.');
      if (scene.sceneScript.version === '1.1.0') return scene;
      if (scene.sceneScript.version !== '1.0.0') throw new Error('UI sceneScript version is unsupported.');
      return Object.assign({}, scene, { sceneScript: { version: '1.1.0', source: canonicalizeLegacySceneScriptSource(scene.sceneScript.source) } });
    }
    if (scene.version !== '1.0.0' || !object(scene.code) || typeof scene.code.ready !== 'string' || typeof scene.code.update !== 'string') throw new Error('UI scene version is unsupported.');
    if (scene.runtimeVersion !== '>=1.0.0') throw new Error('Legacy UI scene runtime version is unsupported.');
    var source = ['scene.onReady(function () {', scene.code.ready, '});', '', 'scene.onUpdate(function ({ frame, deltaMs }) {', scene.code.update, '});', ''].join('\n');
    var canonical = Object.assign({}, scene, { version: '1.1.0', runtimeVersion: '>=1.1.0', sceneScript: { version: '1.1.0', source: source } });
    delete canonical.code;
    return canonical;
  }

  function compileBody(source, args) {
    if (typeof source !== 'string' || !source.trim()) return null;
    try {
      // Project code is compiled once per scene; this plugin does not claim a
      // JavaScript sandbox. Each callback is isolated when it is invoked.
      return Function.apply(null, args.concat(source));
    } catch (error) {
      return { compileError: errorText(error) };
    }
  }

  function compileExpression(source, args) {
    if (typeof source !== 'string' || !source.trim()) return null;
    try {
      return Function.apply(null, args.concat('return (' + source + ');'));
    } catch (error) {
      return { compileError: errorText(error) };
    }
  }

  function compileCondition(condition, target, key) {
    if (!condition || typeof condition !== 'object') return;
    if (condition.type === 'code') {
      target[key] = compileExpression(condition.code, CODE_ARGUMENTS);
      return;
    }
    if ((condition.type === 'and' || condition.type === 'or') && Array.isArray(condition.children)) {
      condition.children.forEach(function (child, index) { compileCondition(child, target, key + ':' + index); });
    }
  }

  function makeRuntime() {
    var runtime = {
      version: VERSION,
      sceneName: null,
      scene: null,
      context: {},
      displayRoot: null,
      hostRoot: null,
      nodeViews: {},
      nodeIndex: {},
      compiled: { setup: null, ready: [], update: [], properties: {}, conditions: {}, scripts: {} },
      listeners: [],
      errors: [],
      disabledHandlers: {},
      tweens: [],
      actionQueues: [],
      frame: 0,
      mounted: false,
      conditionVisibility: {},
      effectiveVisibility: {},
      visibilityEventsReady: false,
      conditionCache: {},
      frameAnimationState: {},
      tileScrollState: {},
      nodes: {},
      deltaMs: 1000 / 60,
      sceneTransition: null,
      sceneFilters: [],
      focusedNodeId: null,
      touchHoveredNodeId: null,
      touchPressedNodeId: null,
      executionMode: 'full-preview',
      allowsUserExecution: function allowsUserExecution() { return this.executionMode !== 'authoring'; },
      makeInvocationArgs: function makeInvocationArgs(node, event, props) {
        var runtime = this;
        var context = this.context || {};
        var sceneApi = context.sceneApi || runtime;
        var selfView = node && this.nodeViews[node.id] ? this.nodeViews[node.id] : sceneApi;
        var readSwitch = function readSwitch(id) {
          if (global.$gameSwitches && typeof global.$gameSwitches.value === 'function') return Boolean(global.$gameSwitches.value(id));
          var values = context.switches || (global.$gameSwitches && global.$gameSwitches._data) || {};
          return Boolean(values[id]);
        };
        var readVariable = function readVariable(id) {
          if (global.$gameVariables && typeof global.$gameVariables.value === 'function') return global.$gameVariables.value(id);
          var values = context.variables || (global.$gameVariables && global.$gameVariables._data) || {};
          return values[id];
        };
        var writeSwitch = function writeSwitch(id, value) {
          if (global.$gameSwitches && typeof global.$gameSwitches.setValue === 'function') {
            var current = typeof global.$gameSwitches.value === 'function' ? Boolean(global.$gameSwitches.value(id)) : Boolean(global.$gameSwitches._data && global.$gameSwitches._data[id]);
            var gameNext = value === 'toggle' ? !current : value === 'on' ? true : value === 'off' ? false : Boolean(value);
            global.$gameSwitches.setValue(id, gameNext);
            return gameNext;
          }
          var values = context.switches || (context.switches = {});
          var next = value === 'toggle' ? !Boolean(values[id]) : value === 'on' ? true : value === 'off' ? false : Boolean(value);
          values[id] = next;
          return next;
        };
        var writeVariable = function writeVariable(id, value) {
          if (global.$gameVariables && typeof global.$gameVariables.setValue === 'function') {
            global.$gameVariables.setValue(id, value);
            return value;
          }
          var values = context.variables || (context.variables = {});
          values[id] = value;
          return value;
        };
        return [runtime, context, node || null, props || (node && node.props) || {}, event || null, selfView, sceneApi, readSwitch, readVariable, writeSwitch, writeVariable];
      },
      mount: function mount(scene, options) {
        this.cleanup();
        scene = canonicalizeRuntimeScene(scene);
        var executionMode = options && options.executionMode ? String(options.executionMode) : 'full-preview';
        if (executionMode !== 'authoring' && executionMode !== 'editor-preview' && executionMode !== 'full-preview') throw new Error('UI Runtime execution mode is unsupported.');
        this.executionMode = executionMode;
        this.scene = scene;
        this.sceneName = scene && scene.meta ? scene.meta.sceneName : null;
        var sceneApi = options && options.sceneApi ? options.sceneApi : null;
        var providedContext = typeof api.contextProvider === 'function' ? api.contextProvider(sceneApi) : null;
        this.context = mergeRuntimeContext(providedContext, options && options.context ? options.context : {});
        if (options && options.sceneApi && !this.context.sceneApi) this.context.sceneApi = options.sceneApi;
        this.deltaMs = finite(options && options.deltaMs, frameDeltaMs());
        this.hostRoot = options && options.root ? options.root : null;
        this.displayRoot = createContainer();
        if (!this.displayRoot && !this.hostRoot) this.displayRoot = createContainer();
        if (this.hostRoot && this.displayRoot && typeof this.hostRoot.addChild === 'function') this.hostRoot.addChild(this.displayRoot);
        this.errors = [];
        applySceneEffects(this, scene);
        this.conditionVisibility = {};
        this.effectiveVisibility = {};
        this.visibilityEventsReady = false;
        this.frame = 0;
        this.touchHoveredNodeId = null;
        this.touchPressedNodeId = null;
        this.nodeIndex = {};
        (Array.isArray(scene && scene.nodes) ? scene.nodes : []).forEach(function (node) {
          if (node && typeof node.id === 'string') this.nodeIndex[node.id] = node;
        }, this);
        this.indexAndCompile();
        this.buildDisplayTree();
        this.nodes = {};
        Object.keys(this.nodeViews).forEach(function (id) {
          var node = this.nodeIndex[id];
          if (node && node.name) this.nodes[node.name] = this.nodeViews[id];
        }, this);
        if (this.context.sceneApi && typeof this.context.sceneApi === 'object') {
          this.context.sceneApi.nodes = this.nodes;
          if (typeof this.context.sceneApi.getNode !== 'function') this.context.sceneApi.getNode = this.getNode.bind(this);
          if (typeof this.context.sceneApi.showNode !== 'function') this.context.sceneApi.showNode = this.showNode.bind(this);
          if (typeof this.context.sceneApi.hideNode !== 'function') this.context.sceneApi.hideNode = this.hideNode.bind(this);
          if (typeof this.context.sceneApi.setNodeProp !== 'function') this.context.sceneApi.setNodeProp = this.setNodeProp.bind(this);
          if (typeof this.context.sceneApi.tween !== 'function') this.context.sceneApi.tween = this.tween.bind(this);
          if (typeof this.context.sceneApi.focusNode !== 'function') this.context.sceneApi.focusNode = this.focusNode.bind(this);
          if (typeof this.context.sceneApi.blurNode !== 'function') this.context.sceneApi.blurNode = this.blurNode.bind(this);
        }
        if (this.allowsUserExecution()) this.registerSceneScript();
        if (this.allowsUserExecution()) installKeyboardFocusManager(this);
        this.mounted = true;
        if (this.allowsUserExecution()) {
          var readyArgs = this.makeInvocationArgs(null, null, null);
          this.compiled.ready.forEach(function (handler, index) {
            this.invoke(handler, readyArgs, 'scene-script:ready', 'scene-script:ready:' + index, { phase: 'ready' });
          }, this);
        }
        this.visibilityEventsReady = true;
        if (this.allowsUserExecution()) this.dispatchInitialVisibility();
        return this;
      },
      indexAndCompile: function indexAndCompile() {
        var self = this;
        var nodes = orderedNodes(this.scene);
        this.nodeViews = {};
        var sceneScriptSource = this.scene && this.scene.sceneScript && this.scene.sceneScript.source;
        this.compiled = { setup: compileBody(sceneScriptSource, CODE_ARGUMENTS), ready: [], update: [], properties: {}, conditions: {}, scripts: {}, actions: {} };
        nodes.forEach(function (node) {
          if (!node || typeof node.id !== 'string' || !NODE_TYPES[node.type]) return;
          var modes = node.propModes || {};
          var codes = node.propCodes || {};
          Object.keys(modes).forEach(function (key) {
            if (modes[key] === 'code' && typeof codes[key] === 'string') self.compiled.properties[node.id + ':' + key] = compileExpression(codes[key], CODE_ARGUMENTS);
          });
          compileCondition(node.condition, self.compiled.conditions, node.id + ':condition');
          Object.keys(node.events || {}).forEach(function (eventName) {
            var handler = node.events[eventName];
            if (!handler || !Array.isArray(handler.actions)) return;
            handler.actions.forEach(function (action, actionIndex) {
              var key = node.id + ':' + eventName + ':' + actionIndex;
              if (action && action.type === 'script') self.compiled.actions[key] = compileBody(action.code, CODE_ARGUMENTS);
              if (action && action.condition && action.condition.type === 'code') self.compiled.actions[key + ':condition'] = compileExpression(action.condition.code, CODE_ARGUMENTS);
            });
          });
          if (node.type === 'button' && node.props && typeof node.props.disabledCondition === 'string' && node.props.disabledCondition.trim()) {
            self.compiled.properties[node.id + ':disabled'] = compileExpression(node.props.disabledCondition, CODE_ARGUMENTS);
          }
        });
      },
      registerSceneScript: function registerSceneScript() {
        var self = this;
        var sceneApi = this.context.sceneApi || this;
        var register = function register(kind, label) {
          return function registerLifecycle(handler) {
            if (typeof handler !== 'function') throw new TypeError(label + ' requires a function callback.');
            if (!self.sceneScriptRegistrationOpen) throw new Error(label + ' can only be called synchronously while the scene script is initializing.');
            self.compiled[kind].push(handler);
          };
        };
        this.sceneScriptRegistrationOpen = true;
        sceneApi.onReady = register('ready', 'scene.onReady');
        sceneApi.onUpdate = register('update', 'scene.onUpdate');
        var args = this.makeInvocationArgs(null, null, null);
        try {
          this.invoke(this.compiled.setup, args, 'scene-script:setup', 'scene-script:setup', { phase: 'setup' });
        } finally {
          this.sceneScriptRegistrationOpen = false;
        }
      },
      buildDisplayTree: function buildDisplayTree() {
        var self = this;
        var nodes = orderedNodes(this.scene);
        nodes.forEach(function (node) {
          if (!node || !NODE_TYPES[node.type]) return;
          try {
            self.conditionVisibility[node.id] = self.evaluateNodeCondition(node);
            self.nodeViews[node.id] = createDisplayNode(node, self);
            if (!self.nodeViews[node.id]) {
              self.reportError(new Error('Node type is not available in this MV/MZ runtime.'), 'node:create', { node: node.id, type: node.type });
              return;
            }
            self.nodeViews[node.id].__mzuiContext = self.context;
            self.nodeViews[node.id].__mzuiRuntime = self;
            self.nodeViews[node.id].__mzuiNode = node;
            applyNodeProps(node, self.nodeViews[node.id], self.scene, self.conditionVisibility[node.id]);
            self.effectiveVisibility[node.id] = effectiveNodeVisibility(node, self.conditionVisibility[node.id]);
            self.updateButtonDisabled(node);
            bindNodeEvents(self, node, self.nodeViews[node.id]);
          } catch (error) {
            delete self.nodeViews[node.id];
            self.reportError(error, 'node:' + node.type, { node: node.id, type: node.type });
          }
        });
        // The tree's last sibling is the front-most layer; PIXI paints the
        // last-added child on top, so attach views in tree order.
        nodes.forEach(function (node) {
          var view = self.nodeViews[node.id];
          if (!view) return;
          var parent = node.parentId ? self.nodeViews[node.parentId] : self.displayRoot;
          if (parent && typeof parent.addChild === 'function') parent.addChild(view);
        });
      },
      update: function update() {
        if (!this.mounted) return;
        this.frame += 1;
        var self = this;
        var nodes = this.scene && Array.isArray(this.scene.nodes) ? this.scene.nodes : [];
        if (this.allowsUserExecution()) this.advanceActionQueues();
        updateSceneTransition(this);
        this.updateTweens();
        if (!this.allowsUserExecution()) {
          nodes.forEach(function (node) {
            if (!node || !node.id || !self.nodeViews[node.id]) return;
            try {
              var visibleByCondition = true;
              var animationPending = shouldRunNodeAnimation(node, visibleByCondition);
              if (animationPending) applyNodeAnimation(node, self.frame, visibleByCondition);
              var props = node.props || {};
              var progressAnimated = node.type === 'progressBar' && props.animateValue === true;
              if (animationPending || progressAnimated) applyNodeProps(node, self.nodeViews[node.id], self.scene, visibleByCondition);
              updateSpriteScroll(node, self.nodeViews[node.id]);
              updateFrameAnimation(node, self.nodeViews[node.id], self.frame, self);
              updateParticleNode(node, self.nodeViews[node.id], self.frame, self);
            } catch (error) {
              self.disabledHandlers['node:' + node.id + ':update'] = true;
              self.reportError(error, 'node:update', { node: node.id, type: node.type, phase: 'update' });
            }
          });
          return;
        }
        nodes.forEach(function (node) {
          if (!node || !node.id || self.disabledHandlers['node:' + node.id + ':update']) return;
          try {
            var visibleByCondition = self.evaluateNodeCondition(node);
            self.conditionVisibility[node.id] = visibleByCondition;
            if (!visibleByCondition) {
              self.syncNodeVisibility(node, false);
              var exitActive = applyNodeAnimation(node, self.frame, false);
              applyNodeProps(node, self.nodeViews[node.id], self.scene, exitActive);
              return;
            }
            self.runPropertyCodes(node);
            self.syncNodeVisibility(node, true);
            self.updateButtonDisabled(node);
            applyNodeAnimation(node, self.frame, true);
            applyNodeProps(node, self.nodeViews[node.id], self.scene, true);
            updateSpriteScroll(node, self.nodeViews[node.id]);
            updateFrameAnimation(node, self.nodeViews[node.id], self.frame, self);
            updateParticleNode(node, self.nodeViews[node.id], self.frame, self);
            self.dispatchActionsForNode(node, 'onUpdate', null);
          } catch (error) {
            self.disabledHandlers['node:' + node.id + ':update'] = true;
            self.reportError(error, 'node:update', { node: node.id, type: node.type, phase: 'update' });
          }
        });
        updateTouchInputBridge(this);
        if (this.allowsUserExecution()) {
          // The Runtime itself already carries frame/deltaMs. Passing the
          // established invocation tuple keeps v1.0 callbacks compatible,
          // while v1.1 callbacks can destructure the first argument as
          // ({ frame, deltaMs }).
          var updateArgs = this.makeInvocationArgs(null, null, null);
          this.compiled.update.forEach(function (handler, index) {
            this.invoke(handler, updateArgs, 'scene-script:update', 'scene-script:update:' + index, { phase: 'update' });
          }, this);
        }
      },
      startExit: function startExit() {
        var transition = this.scene && this.scene.transitions && this.scene.transitions.exit;
        if (!transition || transition.type === 'none' || !this.displayRoot) return this;
        this.sceneTransition = { phase: 'exit', elapsed: 0, config: transition, baseX: finite(this.displayRoot.x, 0), baseY: finite(this.displayRoot.y, 0), width: finite(this.scene.meta && this.scene.meta.canvasWidth, 816), height: finite(this.scene.meta && this.scene.meta.canvasHeight, 624) };
        return this;
      },
      evaluateCondition: function evaluateCondition(condition, node, key) {
        if (!condition || condition.type === 'none') return true;
        if (!this.allowsUserExecution()) return true;
        var switches = this.context.switches || (global.$gameSwitches && global.$gameSwitches._data) || {};
        var variables = this.context.variables || (global.$gameVariables && global.$gameVariables._data) || {};
        if (condition.type === 'switch_on' || condition.type === 'switch_off') {
          var state = Boolean(switches[condition.switchId]);
          return condition.type === 'switch_on' ? state : !state;
        }
        if (condition.type === 'variable') {
          var actual = Number(variables[condition.variableId]);
          var expected = Number(condition.value);
          return { '==': actual === expected, '!=': actual !== expected, '>=': actual >= expected, '<=': actual <= expected, '>': actual > expected, '<': actual < expected }[condition.operator] === true;
        }
        if (condition.type === 'and' || condition.type === 'or') {
          var values = (condition.children || []).map(function (child, index) { return this.evaluateCondition(child, node, (key || node.id + ':condition') + ':' + index); }, this);
          return condition.type === 'and' ? values.every(Boolean) : values.some(Boolean);
        }
        if (condition.type === 'code') return Boolean(this.invoke(this.compiled.conditions[key || node.id + ':condition'], this.makeInvocationArgs(node, null, node.props || {}), 'condition', 'condition:' + (key || node.id), { node: node.id }));
        return false;
      },
      evaluateNodeCondition: function evaluateNodeCondition(node) {
        var frequency = node && node.conditionFrequency ? node.conditionFrequency : 'per-frame';
        var interval = frequency === 'every-10-frames' ? 10 : frequency === 'per-second' ? 60 : 1;
        var cached = this.conditionCache[node.id];
        if (cached && this.frame - cached.frame < interval) return cached.value;
        var value = this.evaluateCondition(node.condition, node, node.id + ':condition');
        this.conditionCache[node.id] = { frame: this.frame, value: value };
        return value;
      },
      runPropertyCodes: function runPropertyCodes(node) {
        if (!this.allowsUserExecution()) return;
        var self = this;
        var props = node.props || {};
        Object.keys(node.propModes || {}).forEach(function (key) {
          if (node.propModes[key] !== 'code') return;
          var value = self.invoke(self.compiled.properties[node.id + ':' + key], self.makeInvocationArgs(node, null, props), 'property:' + key, 'property:' + node.id + ':' + key, { node: node.id });
          if (value !== undefined) props[key] = value;
        });
      },
      dispatchActions: function dispatchActions(eventName, event) {
        if (!this.allowsUserExecution()) return;
        var self = this;
        var nodes = this.scene && Array.isArray(this.scene.nodes) ? this.scene.nodes : [];
        nodes.forEach(function (node) { self.dispatchActionsForNode(node, eventName, event); });
      },
      dispatchInitialVisibility: function dispatchInitialVisibility() {
        var self = this;
        var nodes = this.scene && Array.isArray(this.scene.nodes) ? this.scene.nodes : [];
        nodes.forEach(function (node) {
          if (!node || !self.nodeViews[node.id]) return;
          var visible = effectiveNodeVisibility(node, self.conditionVisibility[node.id]);
          self.effectiveVisibility[node.id] = visible;
          if (visible) self.dispatchActionsForNode(node, 'onShow', null);
        });
      },
      syncNodeVisibility: function syncNodeVisibility(node, conditionVisible) {
        if (!node || !node.id || !this.nodeViews[node.id]) return false;
        var next = effectiveNodeVisibility(node, conditionVisible);
        var previous = this.effectiveVisibility[node.id];
        this.effectiveVisibility[node.id] = next;
        if (!this.visibilityEventsReady || previous === undefined || previous === next) return next;
        this.dispatchActionsForNode(node, next ? 'onShow' : 'onHide', null);
        return next;
      },
      dispatchActionsForNode: function dispatchActionsForNode(node, eventName, event) {
        if (!this.allowsUserExecution()) return;
        var handler = node && node.events && node.events[eventName];
        if (!handler || !Array.isArray(handler.actions)) return;
        if (eventName === 'onUpdate' && this.actionQueues.some(function (queue) { return queue.node === node && queue.eventName === eventName; })) return;
        var queue = { node: node, eventName: eventName, event: event, actions: handler.actions, index: 0, waitFrames: 0 };
        this.actionQueues.push(queue);
        this.advanceActionQueue(queue);
      },
      advanceActionQueues: function advanceActionQueues() {
        var self = this;
        this.actionQueues.slice().forEach(function (queue) {
          if (queue.waitFrames > 0) queue.waitFrames -= 1;
          if (queue.waitFrames <= 0) self.advanceActionQueue(queue);
        });
      },
      advanceActionQueue: function advanceActionQueue(queue) {
        if (!queue || queue.waitFrames > 0) return;
        while (queue.index < queue.actions.length) {
          var actionIndex = queue.index++;
          var action = queue.actions[actionIndex];
          var key = queue.node.id + ':' + queue.eventName + ':' + actionIndex;
          if (!action || (action.condition && !this.evaluateActionCondition(action.condition, queue.node, key))) continue;
          if (action.type === 'wait') {
            queue.waitFrames = Math.max(0, Math.round(action.waitFrames || 0));
            if (queue.waitFrames > 0) break;
            continue;
          }
          try { this.runAction(action, queue.node, queue.event, key); } catch (error) { this.reportError(error, 'action:' + action.type, { node: queue.node.id, event: queue.eventName, action: actionIndex }); }
        }
        if (queue.index >= queue.actions.length && queue.waitFrames <= 0) {
          var position = this.actionQueues.indexOf(queue);
          if (position >= 0) this.actionQueues.splice(position, 1);
        }
      },
      evaluateActionCondition: function evaluateActionCondition(condition, node, key) {
        if (condition.type === 'switch') return Boolean(((this.context.switches || (global.$gameSwitches && global.$gameSwitches._data) || {}))[condition.switchId]);
        if (condition.type === 'variable') return this.evaluateCondition({ type: 'variable', variableId: condition.variableId, operator: condition.operator || '==', value: condition.value }, node);
        if (condition.type === 'code') return Boolean(this.invoke(this.compiled.actions[key + ':condition'], this.makeInvocationArgs(node, null, node.props || {}), 'action-condition', key + ':condition', { node: node.id, event: key.split(':')[1] }));
        return false;
      },
      updateButtonDisabled: function updateButtonDisabled(node) {
        if (!node || node.type !== 'button') return;
        var view = this.nodeViews[node.id];
        if (!view) return;
        var disabled = Boolean(node.props && node.props.disabled);
        if (this.allowsUserExecution() && node.props && typeof node.props.disabledCondition === 'string' && node.props.disabledCondition.trim()) {
          var value = this.invoke(this.compiled.properties[node.id + ':disabled'], this.makeInvocationArgs(node, null, node.props), 'button-disabled', 'button:' + node.id + ':disabled', { node: node.id, event: 'disabledCondition' });
          if (value !== undefined) disabled = Boolean(value);
        }
        view.__mzuiDisabled = disabled;
        if (disabled && this.focusedNodeId === node.id) this.blurNode(node.id);
        renderButtonState(view, node.props || {});
      },
      runAction: function runAction(action, node, event, key) {
        var handlers = this.context.actions || {};
        if (typeof handlers[action.type] === 'function') { handlers[action.type](action, node, event, this); return; }
        if (action.type === 'toggleNode') {
          var target = findNode(this.scene, action.targetNodeId);
          if (target && target.props) {
            target.props.visible = !target.props.visible;
            this.syncNodeVisibility(target, this.conditionVisibility[target.id] !== false);
            applyNodeProps(target, this.nodeViews[target.id], this.scene, this.conditionVisibility[target.id] !== false);
          }
        } else if (action.type === 'setVariable') {
          var variables = this.context.variables || ((this.context.variables = {}));
          var current = Number(variables[action.variableId] || 0);
          var nextValue = action.variableOp === '=' ? action.variableVal : action.variableOp === '+' ? current + action.variableVal : action.variableOp === '-' ? current - action.variableVal : action.variableOp === '*' ? current * action.variableVal : current / action.variableVal;
          variables[action.variableId] = nextValue;
          if (global.$gameVariables && typeof global.$gameVariables.setValue === 'function') global.$gameVariables.setValue(action.variableId, nextValue);
        } else if (action.type === 'setSwitch') {
          var switches = this.context.switches || ((this.context.switches = {}));
          switches[action.switchId] = action.switchVal === 'toggle' ? !switches[action.switchId] : action.switchVal === 'on';
          if (global.$gameSwitches && typeof global.$gameSwitches.setValue === 'function') global.$gameSwitches.setValue(action.switchId, switches[action.switchId]);
        } else if (action.type === 'tweenProp') {
          var targetNode = findNode(this.scene, action.tweenNodeId);
          if (targetNode && targetNode.props) this.tweens.push({ node: targetNode, prop: action.tweenProp, from: finite(targetNode.props[action.tweenProp], 0), to: action.tweenTarget, duration: Math.max(0, action.tweenDuration || 0), elapsed: 0, easing: action.tweenEasing || 'Linear' });
        } else if (action.type === 'script') {
          this.invoke(this.compiled.actions[key], this.makeInvocationArgs(node, event, node.props || {}), 'script', key, { node: node.id, event: key.split(':')[1] });
        } else if (action.type === 'playSe' && global.AudioManager && typeof global.AudioManager.playSe === 'function') {
          global.AudioManager.playSe({ name: action.seName, volume: 90, pitch: 100, pan: 0 });
        } else if (action.type === 'gotoScene' && global.SceneManager && typeof global.SceneManager.push === 'function' && typeof global[action.sceneName] === 'function') {
          global.SceneManager.push(global[action.sceneName]);
        } else if (action.type === 'newGame' && global.DataManager && typeof global.DataManager.setupNewGame === 'function') {
          global.DataManager.setupNewGame();
          if (global.SceneManager && typeof global.SceneManager.goto === 'function' && typeof global.Scene_Map === 'function') global.SceneManager.goto(global.Scene_Map);
        } else if (action.type === 'continue' && global.SceneManager && typeof global.SceneManager.push === 'function' && typeof global.Scene_Load === 'function') {
          global.SceneManager.push(global.Scene_Load);
        } else if (action.type === 'options' && global.SceneManager && typeof global.SceneManager.push === 'function' && typeof global.Scene_Options === 'function') {
          global.SceneManager.push(global.Scene_Options);
        } else if (action.type === 'exit' && global.SceneManager && typeof global.SceneManager.exit === 'function') {
          global.SceneManager.exit();
        } else if (action.type === 'showMessage') {
          ensureSceneMessageHost(global.SceneManager && global.SceneManager._scene);
          global.$gameMessage.add(String(action.message || ''));
        } else if (action.type === 'wait') {
          // Wait is consumed by the per-event action queue above. Keeping it
          // out of global runtime state prevents one node from blocking all
          // other handlers.
        } else if (action.type === 'url' && event && (event.type === 'pointertap' || event.type === 'click')) {
          try {
            var parsedUrl = new URL(action.url);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error('Only http(s) URLs can be opened from a UI action.');
            var shell = global.nw && global.nw.Shell;
            if (!shell || typeof shell.openExternal !== 'function') throw new Error('The MV/MZ external-link bridge is unavailable.');
            shell.openExternal(parsedUrl.href);
          } catch (error) { this.reportError(error, 'action:url', { node: node.id, event: key.split(':')[1] }); }
        }
      },
      focusNode: function focusNode(id) {
        var node = findNode(this.scene, id);
        var view = node && this.nodeViews[id];
        if (!node || !view || node.type !== 'button' || view.__mzuiDisabled || !effectiveViewVisibility(view)) return false;
        if (this.focusedNodeId === id) {
          view.__mzuiFocused = true;
          if (view.__mzuiButtonState !== 'pressed') view.__mzuiButtonState = 'hover';
          renderButtonState(view, node.props || {});
          return true;
        }
        if (this.focusedNodeId && this.focusedNodeId !== id) this.blurNode(this.focusedNodeId);
        this.focusedNodeId = id;
        view.__mzuiFocused = true;
        if (view.__mzuiButtonState !== 'pressed') view.__mzuiButtonState = 'hover';
        renderButtonState(view, node.props || {});
        this.dispatchActionsForNode(node, 'onFocus', { type: 'focus', target: view });
        return true;
      },
      blurNode: function blurNode(id) {
        var node = findNode(this.scene, id);
        var view = node && this.nodeViews[id];
        if (!node || !view) return false;
        view.__mzuiFocused = false;
        if (this.focusedNodeId === id) this.focusedNodeId = null;
        if (view.__mzuiButtonState !== 'pressed') view.__mzuiButtonState = view.__mzuiPointerHover ? 'hover' : 'normal';
        renderButtonState(view, node.props || {});
        this.dispatchActionsForNode(node, 'onBlur', { type: 'blur', target: view });
        return true;
      },
      invoke: function invoke(fn, args, label, key, details) {
        if (!fn) return undefined;
        var handlerKey = key || label;
        if (this.disabledHandlers[handlerKey]) return undefined;
        if (fn.compileError) { this.disabledHandlers[handlerKey] = true; this.reportError(new Error(fn.compileError), label, details); return undefined; }
        var receiver = this.context.sceneApi || this;
        if (receiver && typeof receiver === 'object') {
          receiver.nodes = this.nodes;
          if (typeof receiver.getNode !== 'function') receiver.getNode = this.getNode.bind(this);
          if (typeof receiver.showNode !== 'function') receiver.showNode = this.showNode.bind(this);
          if (typeof receiver.hideNode !== 'function') receiver.hideNode = this.hideNode.bind(this);
          if (typeof receiver.setNodeProp !== 'function') receiver.setNodeProp = this.setNodeProp.bind(this);
          if (typeof receiver.tween !== 'function') receiver.tween = this.tween.bind(this);
        }
        try { return fn.apply(receiver, args); } catch (error) { this.disabledHandlers[handlerKey] = true; this.reportError(error, label, details); return undefined; }
      },
      reportError: function reportError(error, label, details) {
        var entry = { scene: this.sceneName || null, file: this.scene && this.scene.meta && this.scene.meta.sourcePath ? this.scene.meta.sourcePath : null, node: details && details.node ? details.node : null, type: details && details.type ? details.type : null, phase: details && details.phase ? details.phase : null, event: details && details.event ? details.event : null, label: label, message: errorText(error) };
        var duplicate = this.errors.some(function (existing) { return existing.scene === entry.scene && existing.file === entry.file && existing.node === entry.node && existing.type === entry.type && existing.phase === entry.phase && existing.event === entry.event && existing.label === entry.label && existing.message === entry.message; });
        if (duplicate) return;
        this.errors.push(entry);
        reportApiError(entry);
      },
      getNode: function getNode(id) { return this.nodeIndex[id] || null; },
      showNode: function showNode(id) { var node = this.getNode(id); if (node && node.props) { node.props.visible = true; this.syncNodeVisibility(node, this.conditionVisibility[id] !== false); applyNodeProps(node, this.nodeViews[id], this.scene, this.conditionVisibility[id] !== false); } },
      hideNode: function hideNode(id) { var node = this.getNode(id); if (node && node.props) { node.props.visible = false; this.syncNodeVisibility(node, this.conditionVisibility[id] !== false); applyNodeProps(node, this.nodeViews[id], this.scene, this.conditionVisibility[id] !== false); } },
      setNodeProp: function setNodeProp(id, property, value) { var node = this.getNode(id); if (node && node.props) { node.props[property] = value; if (property === 'visible') this.syncNodeVisibility(node, this.conditionVisibility[id] !== false); applyNodeProps(node, this.nodeViews[id], this.scene, this.conditionVisibility[id] !== false); } },
      patchNodes: function patchNodes(patches) {
        if (!this.mounted) throw new Error('UI renderer patch requires a mounted scene.');
        if (!Array.isArray(patches)) throw new TypeError('UI renderer patches must be an array.');
        var self = this;
        var changedNodeIds = [];
        var changedNodeSet = Object.create(null);
        patches.forEach(function (patch) {
          if (!patch || typeof patch.nodeId !== 'string' || !object(patch.props)) throw new TypeError('UI renderer patch is invalid.');
          var node = self.nodeIndex[patch.nodeId];
          if (!node || !node.props || !self.nodeViews[patch.nodeId]) throw new Error('UI renderer patch targets an unknown node: ' + patch.nodeId);
          Object.keys(patch.props).forEach(function (key) { node.props[key] = patch.props[key]; });
          if (!changedNodeSet[patch.nodeId]) {
            changedNodeSet[patch.nodeId] = true;
            changedNodeIds.push(patch.nodeId);
          }
        });
        self.conditionCache = {};
        changedNodeIds.forEach(function (nodeId) {
          var node = self.nodeIndex[nodeId];
          var visible = self.evaluateNodeCondition(node);
          self.conditionVisibility[node.id] = visible;
          self.syncNodeVisibility(node, visible);
          self.updateButtonDisabled(node);
          applyNodeProps(node, self.nodeViews[node.id], self.scene, visible);
        });
        var affectedNodeIds = affectedBoundsNodeIds(this, changedNodeIds);
        affectedNodeIds.forEach(function (nodeId) {
          if (changedNodeSet[nodeId]) return;
          var node = self.nodeIndex[nodeId];
          applyNodeTransform(node, self.nodeViews[nodeId], self.scene);
        });
        return this.getNodeBounds(affectedNodeIds);
      },
      getNodeBounds: function getNodeBounds(nodeIds) {
        var self = this;
        var ids = Array.isArray(nodeIds)
          ? nodeIds.filter(function (id, index, list) { return typeof id === 'string' && list.indexOf(id) === index && self.nodeIndex[id]; })
          : orderedNodes(this.scene).map(function (node) { return node.id; });
        return ids.map(function (id) {
          var node = self.nodeIndex[id];
          if (!node) return null;
          var view = self.nodeViews[node.id];
          if (!view) return null;
          var bounds = worldAabbForView(view, node);
          var visible = effectiveViewVisibility(view);
          return {
            nodeId: node.id,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            // x/y/width/height are already the canonical world-space AABB.
            // Applying the view's world rotation to that rectangle again
            // would mix coordinate spaces and enlarge the editor overlay.
            rotation: 0,
            visible: visible,
            interactive: Boolean(visible && view.interactive === true),
          };
        }).filter(Boolean);
      },
      handleRendererInput: function handleRendererInput(input) {
        if (!input || typeof input.type !== 'string') throw new TypeError('UI renderer input is invalid.');
        if (!this.allowsUserExecution()) return false;
        var node = input.nodeId ? this.getNode(input.nodeId) : null;
        if (!node) {
          if (input.type === 'pointercancel' && this.focusedNodeId) this.blurNode(this.focusedNodeId);
          return false;
        }
        var view = this.nodeViews[node.id];
        if (!view || view.visible === false) return false;
        if (input.type === 'pointerdown' && node.type === 'button') this.focusNode(node.id);
        if (input.type === 'pointerup') this.dispatchActionsForNode(node, 'onClick', input);
        if (input.type === 'pointercancel' && node.type === 'button') this.blurNode(node.id);
        return true;
      },
      tween: function tween(id, property, target, duration, easing) { var node = this.getNode(id); if (node && node.props) this.tweens.push({ node: node, prop: property, from: finite(node.props[property], 0), to: target, duration: Math.max(0, duration || 0), elapsed: 0, easing: easing || 'Linear' }); },
      updateTweens: function updateTweens() {
        var self = this;
        this.tweens = this.tweens.filter(function (tween) {
          tween.elapsed += self.deltaMs || frameDeltaMs();
          var progress = tween.duration <= 0 ? 1 : Math.min(1, tween.elapsed / tween.duration);
          var eased = applyEasing(progress, tween.easing);
          if (tween.node && tween.node.props) tween.node.props[tween.prop] = tween.from + (tween.to - tween.from) * eased;
          return progress < 1;
        });
      },
      cleanup: function cleanup() {
        this.sceneScriptRegistrationOpen = false;
        this.visibilityEventsReady = false;
        var self = this;
        Object.keys(this.effectiveVisibility).forEach(function (id) {
          if (self.effectiveVisibility[id] !== true) return;
          self.effectiveVisibility[id] = false;
          var node = self.nodeIndex[id];
          if (node) self.dispatchActionsForNode(node, 'onHide', null);
        });
        this.listeners.splice(0).forEach(function (remove) { try { remove(); } catch (_) {} });
        var ownedRoot = this.displayRoot;
        Object.keys(this.nodeViews).forEach(function (id) {
          var view = this.nodeViews[id];
          if (view && view.__mzuiNode && view.__mzuiNode.type === 'particle') {
            disposeParticleState(self.frameAnimationState[id], view);
            disposeParticleVisual(view);
          }
          if (view && view.__mzuiVideo) {
            try {
              view.__mzuiVideo.autoplay = false;
              if (typeof view.__mzuiVideo.pause === 'function') view.__mzuiVideo.pause();
              if ('src' in view.__mzuiVideo && view.__mzuiVideo.__mzuiOriginalSrc) {
                view.__mzuiVideo.src = '';
                if (typeof view.__mzuiVideo.load === 'function') view.__mzuiVideo.load();
              }
            } catch (_) {}
          }
          if (view) view.__mzuiDestroyed = true;
          if (view && typeof view.destroy === 'function') { try { view.destroy({ children: true, texture: false, baseTexture: false }); } catch (_) {} }
        }, this);
        // Only remove/destroy the runtime-owned container. The host Scene or
        // caller-provided root may contain unrelated engine children.
        if (ownedRoot && ownedRoot.parent && typeof ownedRoot.parent.removeChild === 'function') ownedRoot.parent.removeChild(ownedRoot);
        if (ownedRoot && typeof ownedRoot.destroy === 'function') { try { ownedRoot.destroy({ children: true }); } catch (_) {} }
        if (ownedRoot && ownedRoot.filters) ownedRoot.filters = null;
        this.nodeViews = {};
        this.nodeIndex = {};
        this.nodes = {};
        this.compiled = { setup: null, ready: [], update: [], properties: {}, conditions: {}, scripts: {}, actions: {} };
        this.scene = null;
        this.sceneName = null;
        this.displayRoot = null;
        this.hostRoot = null;
        this.conditionVisibility = {};
        this.effectiveVisibility = {};
        this.conditionCache = {};
        this.frameAnimationState = {};
        this.tileScrollState = {};
        this.mounted = false;
        this.tweens = [];
        this.disabledHandlers = {};
        this.actionQueues = [];
        this.sceneTransition = null;
        this.sceneFilters = [];
        this.focusedNodeId = null;
        this.touchHoveredNodeId = null;
        this.touchPressedNodeId = null;
        this.executionMode = 'full-preview';
      },
    };
    return runtime;
  }

  function createContainer() {
    if (global.PIXI && typeof global.PIXI.Container === 'function') return new global.PIXI.Container();
    return null;
  }

  function frameDeltaMs() {
    var graphics = global.Graphics;
    var value = graphics && (graphics.deltaTime !== undefined ? graphics.deltaTime : graphics._deltaTime);
    if (typeof value === 'number' && isFinite(value) && value > 0) return value > 5 ? value : value * 1000;
    return 1000 / 60;
  }

  function applyEasing(progress, easing) {
    var p = Math.max(0, Math.min(1, progress));
    if (easing === 'EaseIn') return p * p;
    if (easing === 'EaseOut') return 1 - (1 - p) * (1 - p);
    if (easing === 'EaseInOut') return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    if (easing === 'Bounce') {
      var n1 = 7.5625; var d1 = 2.75;
      if (p < 1 / d1) return n1 * p * p;
      if (p < 2 / d1) { p -= 1.5 / d1; return n1 * p * p + 0.75; }
      if (p < 2.5 / d1) { p -= 2.25 / d1; return n1 * p * p + 0.9375; }
      p -= 2.625 / d1; return n1 * p * p + 0.984375;
    }
    return p;
  }

  function applySceneEffects(runtime, scene) {
    var root = runtime.displayRoot;
    if (!root) return;
    var filter = scene && scene.globalFilter ? scene.globalFilter : {};
    runtime.sceneFilters = [];
    if (finite(filter.blur, 0) > 0 && global.PIXI && global.PIXI.filters && typeof global.PIXI.filters.BlurFilter === 'function') {
      var blur = new global.PIXI.filters.BlurFilter();
      blur.blur = finite(filter.blur, 0);
      runtime.sceneFilters.push(blur);
    }
    if (finite(filter.glow, 0) > 0 && global.PIXI && global.PIXI.filters && typeof global.PIXI.filters.GlowFilter === 'function') {
      var glow = new global.PIXI.filters.GlowFilter();
      glow.distance = finite(filter.glow, 0);
      runtime.sceneFilters.push(glow);
    }
    if (filter.preset && !runtime.sceneFilters.length) runtime.reportError(new Error('The configured globalFilter preset is not supported by this MV/MZ runtime.'), 'global-filter', {});
    if (runtime.sceneFilters.length) root.filters = runtime.sceneFilters;
    var transition = scene && scene.transitions && scene.transitions.enter;
    runtime.sceneTransition = transition && transition.type !== 'none'
      ? { phase: 'enter', elapsed: 0, config: transition, baseX: finite(root.x, 0), baseY: finite(root.y, 0), width: finite(scene && scene.meta && scene.meta.canvasWidth, 816), height: finite(scene && scene.meta && scene.meta.canvasHeight, 624) }
      : null;
    if (runtime.sceneTransition) {
      root.alpha = transition.type === 'fade' ? 0 : 1;
      if (transition.type === 'slideLeft') root.x = -runtime.sceneTransition.width;
      if (transition.type === 'slideRight') root.x = runtime.sceneTransition.width;
    }
  }

  function updateSceneTransition(runtime) {
    var transition = runtime.sceneTransition;
    if (!transition || !runtime.displayRoot) return;
    transition.elapsed += runtime.deltaMs || frameDeltaMs();
    var duration = Math.max(1, finite(transition.config && transition.config.duration, 0));
    var progress = applyEasing(Math.min(1, transition.elapsed / duration), transition.config && transition.config.easing);
    if (transition.config.type === 'fade') runtime.displayRoot.alpha = transition.phase === 'enter' ? progress : 1 - progress;
    if (transition.config.type === 'slideLeft') runtime.displayRoot.x = transition.phase === 'enter'
      ? transition.baseX - transition.width * (1 - progress)
      : transition.baseX - transition.width * progress;
    if (transition.config.type === 'slideRight') runtime.displayRoot.x = transition.phase === 'enter'
      ? transition.baseX + transition.width * (1 - progress)
      : transition.baseX + transition.width * progress;
    if (transition.elapsed >= duration) {
      runtime.displayRoot.alpha = transition.phase === 'enter' ? 1 : 0;
      runtime.sceneTransition = null;
    }
  }

  function hasTextMarkup(value) {
    return typeof value === 'string' && /\\(?:v|c|i)\[\d+\]|\\n|<\/?(?:b|i)>|<\/?color(?:=[^>]+)?>/i.test(value);
  }

  function singleLineText(value) {
    return String(value == null ? '' : value).replace(/\r\n?|\n/g, ' ').replace(/\\n/gi, ' ');
  }

  function horizontalTextScale(layoutWidth, naturalWidth) {
    var width = Math.max(1, finite(layoutWidth, 1));
    var natural = Math.max(0, finite(naturalWidth, 0));
    return natural > width ? width / natural : 1;
  }

  function parseTextRuns(value, context) {
    var source = String(value || '');
    var variables = context && context.variables || (global.$gameVariables && global.$gameVariables._data) || {};
    var color = null;
    var bold = false;
    var italic = false;
    var runs = [];
    var buffer = '';
    function flush() {
      if (!buffer) return;
      runs.push({ kind: 'text', text: buffer, color: color, bold: bold, italic: italic });
      buffer = '';
    }
    var index = 0;
    while (index < source.length) {
      var rest = source.slice(index);
      var match = rest.match(/^\\v\[(\d+)\]/i);
      if (match) { flush(); runs.push({ kind: 'text', text: String(variables[Number(match[1])] ?? ''), color: color, bold: bold, italic: italic }); index += match[0].length; continue; }
      match = rest.match(/^\\c\[(\d+)\]/i);
      if (match) { flush(); color = textColorForIndex(Number(match[1])); index += match[0].length; continue; }
      match = rest.match(/^\\i\[(\d+)\]/i);
      if (match) { flush(); runs.push({ kind: 'icon', iconId: Number(match[1]), color: color, bold: bold, italic: italic }); index += match[0].length; continue; }
      if (rest.startsWith('\\n')) { flush(); runs.push({ kind: 'newline' }); index += 2; continue; }
      if (/^<b>/i.test(rest)) { flush(); bold = true; index += 3; continue; }
      if (/^<\/b>/i.test(rest)) { flush(); bold = false; index += 4; continue; }
      if (/^<i>/i.test(rest)) { flush(); italic = true; index += 3; continue; }
      if (/^<\/i>/i.test(rest)) { flush(); italic = false; index += 4; continue; }
      match = rest.match(/^<color=(#[0-9a-f]{3,8})>/i);
      if (match) { flush(); color = match[1]; index += match[0].length; continue; }
      if (/^<\/color>/i.test(rest)) { flush(); color = null; index += 8; continue; }
      buffer += source[index];
      index += 1;
    }
    flush();
    return runs;
  }

  function textColorForIndex(index) {
    if (global.ColorManager && typeof global.ColorManager.textColor === 'function') {
      try { return global.ColorManager.textColor(index); } catch (_) {}
    }
    if (global.Window_Base && typeof global.Window_Base.prototype.textColor === 'function') {
      try { return global.Window_Base.prototype.textColor.call({ contents: null }, index); } catch (_) {}
    }
    return '#ffffff';
  }

  function renderTextRuns(view, props, context) {
    if (!view || !view.__mzuiTextRuns || typeof view.addChild === 'undefined') return;
    var resolved = parseTextRuns(singleLineText(props.content), context);
    var key = JSON.stringify({ content: props.content, variables: context && context.variables, font: props.fontFile, size: props.fontSize, color: props.textColor, width: props.width, align: props.align });
    if (view.__mzuiTextRunsKey === key) return;
    view.__mzuiTextRunsKey = key;
    if (Array.isArray(view.children) && typeof view.removeChild === 'function') {
      view.children.slice().forEach(function (child) {
        view.removeChild(child);
        if (child && typeof child.destroy === 'function') { try { child.destroy({ children: true }); } catch (_) {} }
      });
    }
    var fontFamily = resolveTextFontFamily(props);
    var fontSize = finite(props.fontSize, nativeTextProfile().fontSize);
    var stroke = nativeStroke(props);
    var cursorX = 0;
    resolved.forEach(function (run) {
      if (run.kind === 'newline') return;
      if (run.kind === 'icon') {
        if (global.Sprite && typeof global.Sprite === 'function') {
          var icon = new global.Sprite(loadBitmap('img/system/IconSet'));
          icon.__mzuiIconId = run.iconId;
          if (typeof icon.setFrame === 'function') {
            var columns = 16;
            var size = 32;
            icon.setFrame((run.iconId % columns) * size, Math.floor(run.iconId / columns) * size, size, size);
          }
          icon.x = cursorX; icon.y = 0; icon.width = fontSize; icon.height = fontSize;
          view.addChild(icon);
          cursorX += fontSize;
        }
        return;
      }
      if (!global.PIXI || typeof global.PIXI.Text !== 'function') return;
      var text = new global.PIXI.Text(run.text, {});
      text.style = text.style || {};
      Object.assign(text.style, {
        fontSize: fontSize,
        fontWeight: run.bold ? 'bold' : props.fontWeight || 'normal',
        fontStyle: run.italic || props.italic ? 'italic' : 'normal',
        fontFamily: fontFamily,
        fill: run.color || props.textColor || '#ffffff',
        stroke: stroke.color,
        strokeThickness: stroke.width,
      });
      text.x = cursorX; text.y = 0;
      view.addChild(text);
      if (typeof text.updateText === 'function') { try { text.updateText(true); } catch (_) {} }
      var measuredWidth = finite(text.width, 0) || run.text.length * fontSize * 0.5;
      cursorX += measuredWidth;
    });
    var compression = horizontalTextScale(props.width, cursorX);
    var renderedWidth = cursorX * compression;
    var start = props.align === 'right' ? Math.max(0, finite(props.width, 0) - renderedWidth)
      : props.align === 'center' ? Math.max(0, (finite(props.width, 0) - renderedWidth) / 2) : 0;
    if (Array.isArray(view.children)) view.children.forEach(function (child) {
      child.x = start + finite(child.x, 0) * compression;
      child.scale = child.scale || { x: 1, y: 1 };
      child.scale.x = finite(child.scale.x, 1) * compression;
    });
    view.__mzuiTextHorizontalScale = 1;
    view.__mzuiRichText = 'safe-runs';
    renderTextBackground(view, props);
  }

  // One shared style applier for plain text nodes so the freshly created
  // object and every later props update render the same native profile:
  // engine main font family/size by default, designer props on top, and the
  // engine's native window-text outline unless the designer sets a stroke.
  function applyPlainTextStyle(view, props) {
    if (!view) return;
    view.text = singleLineText(props.content);
    view.style = view.style || {};
    var native = nativeTextProfile();
    var stroke = nativeStroke(props);
    Object.assign(view.style, {
      fontSize: finite(props.fontSize, native.fontSize),
      fontWeight: props.fontWeight || 'normal',
      fontStyle: props.italic ? 'italic' : 'normal',
      fontFamily: resolveTextFontFamily(props),
      fill: props.textColor || '#ffffff',
      stroke: stroke.color,
      strokeThickness: stroke.width,
      letterSpacing: finite(props.letterSpacing, 0),
      wordWrap: false,
      wordWrapWidth: 0,
      align: props.align || 'left',
    });
    view.style.dropShadow = finite(props.shadowBlur, 0) > 0 || Boolean(props.shadowColor);
    view.style.dropShadowColor = props.shadowColor || '#000000';
    view.style.dropShadowDistance = Math.max(Math.abs(finite(props.shadowOffsetX, 0)), Math.abs(finite(props.shadowOffsetY, 0)));
    var textPadding = props.padding || {};
    // PIXI.TextStyle.padding is one numeric texture padding value in both
    // the MV and MZ Pixi versions. Passing the editor's four-edge object
    // prevents the text canvas from being generated.
    view.style.padding = Math.max(
      0,
      finite(textPadding.top, 0),
      finite(textPadding.right, 0),
      finite(textPadding.bottom, 0),
      finite(textPadding.left, 0)
    );
    view.style.textBaseline = 'alphabetic';
    if (typeof view.updateText === 'function') { try { view.updateText(true); } catch (_) {} }
    var designerScaleX = Math.abs(finite(view.__mzuiDesignerScaleX, finite(props.scaleX, 1))) || 1;
    var naturalWidth = Math.abs(finite(view.width, 0)) / designerScaleX;
    if (!naturalWidth) naturalWidth = view.text.length * finite(view.style.fontSize, 24) * 0.6;
    view.__mzuiTextNaturalWidth = naturalWidth;
    view.__mzuiTextHorizontalScale = horizontalTextScale(props.width, naturalWidth);
  }

  // Plain text vertical alignment moves the glyph block inside the node box.
  // Never mapped to canvas textBaseline: PIXI positions lines assuming the
  // 'alphabetic' baseline, so any override shifts glyphs past the generated
  // texture and cuts them off.
  function plainTextVerticalOffset(view, props) {
    var align = props.verticalAlign || 'top';
    if (align !== 'middle' && align !== 'bottom') return 0;
    if (typeof view.updateText === 'function') { try { view.updateText(true); } catch (_) {} }
    var spare = Math.max(0, Math.abs(finite(props.height, 0) * finite(props.scaleY, 1)) - Math.abs(finite(view.height, 0)));
    return align === 'middle' ? spare / 2 : spare;
  }

  function plainTextHorizontalOffset(view, props) {
    var width = Math.max(1, finite(props.width, 1));
    var natural = Math.max(0, finite(view.__mzuiTextNaturalWidth, width));
    var compression = finite(view.__mzuiTextHorizontalScale, 1);
    var rendered = natural * compression;
    var start = props.align === 'right' ? Math.max(0, width - rendered)
      : props.align === 'center' ? Math.max(0, (width - rendered) / 2) : 0;
    return (start + finite(props.anchorX, 0) * rendered - finite(props.anchorX, 0) * width) * finite(props.scaleX, 1);
  }

  function createDisplayNode(node, runtime) {
    var props = node.props || {};
    var PIXI = global.PIXI || {};
    var view;
    if (node.type === 'container' && typeof PIXI.Container === 'function') view = new PIXI.Container();
    else if (node.type === 'sprite' && typeof global.Sprite === 'function') {
      var spriteBitmap = loadBitmap(props.path || '');
      var spriteTexture = textureFromBitmap(spriteBitmap) || spriteBitmap;
      if (effectiveRepeatMode(props.repeatMode, props.fillMode) !== 'none' && typeof PIXI.TilingSprite === 'function') {
        var tilingTexture = textureFromBitmap(spriteBitmap) || PIXI.Texture && PIXI.Texture.EMPTY || spriteTexture;
        try { view = new PIXI.TilingSprite(tilingTexture, finite(props.width, 0), finite(props.height, 0)); } catch (_) { view = new global.Sprite(spriteBitmap); }
      } else {
        view = new global.Sprite(spriteBitmap);
      }
      view.__mzuiSourceBitmap = spriteBitmap;
      view.__mzuiSourceTexture = textureFromBitmap(spriteBitmap) || spriteTexture;
      listenForBitmapTexture(spriteBitmap, function (texture) {
        if (!view || view.__mzuiDestroyed) return;
        view.__mzuiSourceTexture = texture;
        // RPG Maker Sprite owns its Bitmap and refreshes its frame first.
        // TilingSprite has no Bitmap binding, so it still needs the texture.
        if (view.tileScale || view.bitmap !== spriteBitmap) applyReadyTexture(view, texture);
        onNodeTextureReady(runtime, node, view);
      });
    }
    else if (node.type === 'nineSlice' && props.path) {
      // PixiJS 4 (RPG Maker MV) exposes NineSlicePlane under PIXI.mesh,
      // while PixiJS 5 (RPG Maker MZ) exposes it directly on PIXI.
      var NineSlicePlane = typeof PIXI.NineSlicePlane === 'function'
        ? PIXI.NineSlicePlane
        : PIXI.mesh && typeof PIXI.mesh.NineSlicePlane === 'function'
          ? PIXI.mesh.NineSlicePlane
          : null;
      if (!NineSlicePlane) return null;
      var nineBitmap = loadBitmap(props.path);
      var nineTexture = textureFromBitmap(nineBitmap);
      var nineFallback = nineTexture || PIXI.Texture && PIXI.Texture.EMPTY || null;
      var nineView = new NineSlicePlane(nineFallback, 0, 0, 0, 0);
      nineView.__mzuiSourceBitmap = nineBitmap;
      nineView.__mzuiSourceTexture = nineFallback;
      nineView.__mzuiNineSlice = true;
      listenForBitmapTexture(nineBitmap, function (texture) {
        if (!nineView || nineView.__mzuiDestroyed || !texture) return;
        nineView.__mzuiSourceTexture = texture;
        applyReadyTexture(nineView, texture);
        onNodeTextureReady(runtime, node, nineView);
      });
      view = nineView;
    }
    else if (node.type === 'frameAnimation' && typeof global.Sprite === 'function') {
      var frameIndex = Math.max(0, Math.min((props.frames && props.frames.length || 1) - 1, Math.round(finite(props.initialFrame, 0))));
      var framePath = props.frames && props.frames[frameIndex] && props.frames[frameIndex].path || '';
      var frameReady = function (texture) {
        if (!view || view.__mzuiDestroyed || !texture) return;
        applyReadyTexture(view, texture);
        onNodeTextureReady(runtime, node, view);
      };
      if (props.fillMode === 'tile' && PIXI.TilingSprite) {
        try { view = new PIXI.TilingSprite(loadTexture(framePath, frameReady) || loadBitmap(framePath), finite(props.width, 0), finite(props.height, 0)); } catch (_) { view = new global.Sprite(loadBitmap(framePath)); }
      } else view = new global.Sprite(loadBitmap(framePath));
      if (view && framePath) loadTexture(framePath, frameReady);
    }
    else if (node.type === 'text' && (props.richText === true || hasTextMarkup(props.content)) && typeof PIXI.Container === 'function') {
      view = new PIXI.Container();
      view.__mzuiTextRuns = true;
      view.__mzuiTextNode = true;
    }
    else if (node.type === 'text' && typeof PIXI.Text === 'function') {
      view = new PIXI.Text(String(props.content || ''), {});
      view.__mzuiTextNode = true;
      applyPlainTextStyle(view, props);
    }
    else if (node.type === 'button') view = createButtonWindow(props);
    else if ((node.type === 'progressBar' || node.type === 'overlay') && typeof PIXI.Graphics === 'function') view = new PIXI.Graphics();
    else if (node.type === 'video' && typeof PIXI.Sprite === 'function' && PIXI.Texture && typeof PIXI.Texture.from === 'function' && props.path) {
      var videoTexture = createVideoTexture(props.path);
      view = new PIXI.Sprite(videoTexture.texture);
      if (videoTexture.video) view.__mzuiVideo = videoTexture.video;
    }
    // ParticleContainer only accepts textured Sprite children in the MV/MZ
    // PIXI versions. Keep a regular Container as the transform/filter owner;
    // updateParticleNode installs the capability-appropriate inner layer.
    else if (node.type === 'particle' && typeof PIXI.Container === 'function') view = new PIXI.Container();
    return view || null;
  }

  function createButtonWindow(props) {
    if (typeof global.Window_Base !== 'function') return null;
    var rect = new RectangleLike(props.x, props.y, props.width, props.height);
    var engine = global.Utils && typeof global.Utils.RPGMAKER_NAME === 'string' ? global.Utils.RPGMAKER_NAME.toUpperCase() : '';
    if (engine === 'MV') {
      try { return new global.Window_Base(rect.x, rect.y, rect.width, rect.height); } catch (_) { return null; }
    }
    if (engine === 'MZ') {
      try { return new global.Window_Base(rect); } catch (_) { return null; }
    }
    // Unknown test/embedded hosts use constructor arity as a conservative
    // signal; never pass a Rectangle to a known MV four-argument constructor.
    if (global.Window_Base.length >= 4) {
      try { return new global.Window_Base(rect.x, rect.y, rect.width, rect.height); } catch (_) { return null; }
    }
    try { return new global.Window_Base(rect); } catch (_) {}
    try { return new global.Window_Base(rect.x, rect.y, rect.width, rect.height); } catch (_) { return null; }
  }

  // Button labels stay on the engine's native pipeline: the window's own
  // contents Bitmap with the engine drawText signature (text, x, y,
  // maxWidth, lineHeight, align).  The designer's text props are applied on
  // top of the native window font profile, and lines are laid out inside the
  // window content area (engine padding) with the engine baseline formula
  // doing the vertical centering.  MV's Bitmap has no fontBold; bold labels
  // render at the engine weight there, matching what the shipped game does.
  function renderButtonText(view, props) {
    if (!view || !view.contents || typeof view.contents.drawText !== 'function') return;
    var contents = view.contents;
    var native = nativeTextProfile();
    var stroke = nativeStroke(props);
    contents.fontFace = resolveTextFontFamily(props);
    contents.fontSize = finite(props.fontSize, native.fontSize);
    contents.fontBold = props.fontWeight === 'bold';
    contents.fontItalic = props.italic === true;
    contents.textColor = props.textColor || '#ffffff';
    contents.outlineColor = stroke.color;
    contents.outlineWidth = stroke.width;
    var padding = typeof view.standardPadding === 'function' ? view.standardPadding() : (typeof view.padding === 'number' ? view.padding : 0);
    var contentWidth = Math.max(1, finite(props.width, 0) - padding * 2);
    var contentHeight = Math.max(0, finite(props.height, 0) - padding * 2);
    var lineHeight = Math.max(1, Math.ceil(contents.fontSize * 1.3));
    var label = singleLineText(props.content);
    var totalHeight = lineHeight;
    var top = props.verticalAlign === 'middle' || !props.verticalAlign
      ? Math.max(0, (contentHeight - totalHeight) / 2)
      : props.verticalAlign === 'bottom'
        ? Math.max(0, contentHeight - totalHeight)
        : 0;
    var align = props.align || 'center';
    contents.drawText(label, 0, Math.round(top), contentWidth, lineHeight, align);
  }

  function RectangleLike(x, y, width, height) {
    this.x = finite(x, 0); this.y = finite(y, 0); this.width = finite(width, 0); this.height = finite(height, 0);
  }

  function loadBitmap(path) {
    if (!path) return null;
    var normalizedPath = String(path).replace(/\\/g, '/');
    if (global.ImageManager && typeof global.ImageManager.loadBitmap === 'function') {
      var slash = normalizedPath.lastIndexOf('/');
      var folder = normalizedPath.slice(0, slash + 1);
      var fileName = normalizedPath.slice(slash + 1);
      // MV and MZ ImageManager append ".png" themselves.  The editor stores
      // the real project-relative path including its extension, so passing the
      // persisted name through unchanged requests "name.png.png".
      if (/\.png$/i.test(fileName)) return global.ImageManager.loadBitmap(folder, fileName.slice(0, -4));
      if (!/\.[^/]+$/.test(fileName)) return global.ImageManager.loadBitmap(folder, fileName);
    }
    // Non-PNG resources use their exact persisted URL instead of the
    // ImageManager convention, which is deliberately PNG-only in MV/MZ.
    if (global.Bitmap && typeof global.Bitmap.load === 'function') return global.Bitmap.load(normalizedPath);
    return null;
  }

  function loadTexture(path, onReady) {
    var bitmap = loadBitmap(path);
    if (!bitmap) return null;
    var texture = textureFromBitmap(bitmap);
    listenForBitmapTexture(bitmap, onReady);
    return texture;
  }

  function listenForBitmapTexture(bitmap, onReady) {
    if (!bitmap || typeof onReady !== 'function' || typeof bitmap.addLoadListener !== 'function') return;
    bitmap.addLoadListener(function () {
      var ready = textureFromBitmap(bitmap);
      if (ready) onReady(ready);
    });
  }

  function textureFromBitmap(bitmap) {
    if (!bitmap) return null;
    if (bitmap.texture) return bitmap.texture;
    if (bitmap.baseTexture) {
      if (global.PIXI && typeof global.PIXI.Texture === 'function') {
        try { return new global.PIXI.Texture(bitmap.baseTexture); } catch (_) {}
      }
      return bitmap.baseTexture;
    }
    if (bitmap._baseTexture) {
      if (global.PIXI && typeof global.PIXI.Texture === 'function') {
        try { return new global.PIXI.Texture(bitmap._baseTexture); } catch (_) {}
      }
      return bitmap._baseTexture;
    }
    // Official MV/MZ Bitmap owns its HTMLImageElement.onload handler. Passing
    // that in-flight image to PIXI.Texture.from replaces the engine listener,
    // leaving Bitmap in "loading" and RPG Maker Sprite with a zero-size frame.
    if (typeof bitmap.addLoadListener === 'function') return null;
    if (global.PIXI && global.PIXI.Texture && typeof global.PIXI.Texture.from === 'function') {
      try { return global.PIXI.Texture.from(bitmap._image || bitmap.canvas || bitmap); } catch (_) {}
    }
    return bitmap;
  }

  function applyReadyTexture(view, texture) {
    if (!view || !texture || view.__mzuiDestroyed) return;
    if (typeof view.setTexture === 'function') view.setTexture(texture);
    else if (view.texture !== undefined) view.texture = texture;
    else if (view.bitmap !== undefined) view.texture = texture;
  }

  function onNodeTextureReady(runtime, node, view) {
    if (!view || view.__mzuiDestroyed || !node) return;
    var props = node.props || {};
    applyNodeDimensions(view, props);
    if (node.type === 'sprite') { applySpriteFill(view, props); rememberNodeWorldScale(view); }
    if (node.type === 'frameAnimation') { applyFillMode(view, finite(props.width, view.width || 0), finite(props.height, view.height || 0), props.fillMode, props.scaleX, props.scaleY); rememberNodeWorldScale(view); }
    if (node.type === 'button') renderButtonState(view, props);
    if (node.type === 'progressBar') {
      var ratio = Math.max(0, Math.min(1, finite(props.currentValue, 0) / Math.max(1, finite(props.maxValue, 1))));
      applyProgressImages(view, props, ratio);
    }
    if (node.type === 'nineSlice') {
      applyNineSliceBorders(view, props);
    }
    applyNodeTransform(node, view, runtime && runtime.scene);
    if (runtime && runtime.updateButtonDisabled && node.type === 'button') runtime.updateButtonDisabled(node);
  }

  function createVideoTexture(path) {
    if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
      try {
        var video = document.createElement('video');
        video.src = String(path);
        video.preload = 'auto';
        video.playsInline = true;
        return { texture: global.PIXI.Texture.from(video), video: video };
      } catch (_) {}
    }
    return { texture: global.PIXI.Texture.from(path), video: null };
  }

  function updateFrameAnimation(node, view, frame, runtime) {
    if (!view || node.type !== 'frameAnimation') return;
    var props = node.props || {};
    var frames = Array.isArray(props.frames) ? props.frames : [];
    if (!frames.length) return;
    var state = runtime.frameAnimationState[node.id] || (runtime.frameAnimationState[node.id] = { index: Math.max(0, Math.min(frames.length - 1, Math.round(finite(props.initialFrame, 0)))), elapsed: 0, last: -1 });
    state.elapsed += 1;
    var current = frames[state.index] || frames[0];
    var duration = Math.max(1, finite(current.duration, finite(props.defaultFrameDuration, 100)) / Math.max(1, runtime.deltaMs || 1000 / 60) / Math.max(0.01, finite(props.speed, 1)));
    if (state.elapsed >= duration) {
      state.elapsed = 0;
      state.index += 1;
      if (state.index >= frames.length) state.index = props.loop === false ? frames.length - 1 : 0;
    }
    if (state.last !== state.index) {
      var frameData = frames[state.index];
      var framePath = frameData && frameData.path || '';
      var bitmap = loadBitmap(framePath);
      if (bitmap && 'bitmap' in view) view.bitmap = bitmap;
      var applyFrameTexture = function (texture) {
        if (!texture || view.__mzuiDestroyed) return;
        applyReadyTexture(view, texture);
        onNodeTextureReady(runtime, node, view);
      };
      if (bitmap && typeof view.setTexture === 'function') applyFrameTexture(loadTexture(framePath, applyFrameTexture));
      else if (bitmap && view.texture !== undefined) applyFrameTexture(loadTexture(framePath, applyFrameTexture));
      onNodeTextureReady(runtime, node, view);
      state.last = state.index;
    }
  }

  // Runtime JSON validation permits at most 10,000 particles. Keep the staged
  // standalone plugin on the same bound; the Inspector's lower UI maximum is
  // an authoring guard, not a second persistence/runtime contract.
  var PARTICLE_MAX_COUNT = 10000;

  function updateParticleNode(node, view, frame, runtime) {
    if (!view || node.type !== 'particle' || typeof view.addChild !== 'function') return;
    var props = node.props || {};
    var state = runtime.frameAnimationState[node.id] || (runtime.frameAnimationState[node.id] = { particles: [], pool: [], elapsed: 0, layer: null, layerKey: '' });
    var maxParticles = particleCountLimit(props.maxParticles, runtime, node);
    var layerKey = particleLayerKey(props);
    if (!ensureParticleLayer(node, view, state, props, runtime, layerKey)) return;
    configureParticleLayer(state.layer, props);
    trimActiveParticles(state, maxParticles);
    trimParticlePool(state, maxParticles);

    // The editor contract expresses emissionInterval/lifetime in game frames,
    // not milliseconds. Keep the simulation tied to update ticks so a 30fps
    // host does not silently double a particle's lifetime or emission cadence.
    state.elapsed += 1;
    var interval = Math.max(1, Math.round(finite(props.emissionInterval, 1)));
    if (state.elapsed % interval === 0 && state.particles.length < maxParticles) {
      var particle = state.pool.pop() || createParticleObject(props, runtime, node);
      if (particle) {
        resetParticleObject(particle, props, frame);
        state.layer.addChild(particle);
        state.particles.push(particle);
      }
    }
    var active = [];
    state.particles.forEach(function (particle) {
      var age = frame - particle.__mzuiBirth;
      var life = Math.max(1, particle.__mzuiLife);
      var lifeProgress = Math.max(0, Math.min(1, age / life));
      particle.x += finite(particle.__mzuiVelocityX, props.velocityX) + finite(props.gravityX, 0) * age / 60;
      particle.y += finite(particle.__mzuiVelocityY, props.velocityY) + finite(props.gravityY, 0) * age / 60;
      particle.alpha = particleOpacity(props.startOpacity, props.endOpacity, lifeProgress);
      if (particle.scale) {
        var scale = Math.max(0, finite(props.startScale, 1) + (finite(props.endScale, 1) - finite(props.startScale, 1)) * lifeProgress);
        particle.scale.x = particle.scale.y = scale;
      }
      if (particle.tint !== undefined) particle.tint = mixColor(props.startColor, props.endColor, lifeProgress);
      particle.rotation = finite(particle.rotation, 0) + finite(props.rotationSpeed, 0) / 60;
      if (age < life) active.push(particle);
      else recycleParticle(state, particle, maxParticles);
    });
    state.particles = active;
  }

  function particleCountLimit(value, runtime, node) {
    var requested = Math.max(0, Math.floor(finite(value, 0)));
    if (requested > PARTICLE_MAX_COUNT && runtime && node) {
      runtime.reportError(new Error('Particle maxParticles exceeds the Runtime limit of ' + PARTICLE_MAX_COUNT + '.'), 'particle-limit', { node: node.id, type: 'particle', phase: 'update' });
    }
    return Math.min(PARTICLE_MAX_COUNT, requested);
  }

  function particleLayerKey(props) {
    var imagePath = typeof props.imagePath === 'string' ? props.imagePath.trim() : '';
    if (!imagePath) return 'shape:' + String(props.shape || 'circle') + ':' + Math.max(1, finite(props.size, 8));
    return 'image:' + imagePath;
  }

  function ensureParticleLayer(node, view, state, props, runtime, layerKey) {
    if (state.layer && state.layerKey === layerKey) return true;
    disposeParticleState(state, view);
    state.particles = [];
    state.pool = [];
    state.elapsed = 0;
    state.layerKey = layerKey;
    var PIXI = global.PIXI || {};
    if (typeof PIXI.Container !== 'function') {
      reportParticleCapability(runtime, node, 'The current MV/MZ PIXI host does not provide Container for particle rendering.');
      return false;
    }
    // MV/MZ ParticleContainer accepts only textured sprites and does not expose
    // every per-child property required by this contract (notably tint across
    // the supported PIXI versions). A real PIXI.Container is therefore the one
    // canonical layer for both Graphics shapes and textured Sprites.
    var layer = new PIXI.Container();
    layer.__mzuiUsesContainerTint = false;
    layer.__mzuiParticleChildType = layerKey.indexOf('shape:') === 0 ? 'graphics' : 'sprite';
    state.layer = layer;
    view.__mzuiParticleLayer = layer;
    view.addChild(layer);
    configureParticleLayer(layer, props);
    return true;
  }

  function configureParticleLayer(layer, props) {
    if (!layer) return;
    layer.blendMode = resolveBlendMode(props.blendMode);
  }

  function createParticleObject(props, runtime, node) {
    var imagePath = typeof props.imagePath === 'string' ? props.imagePath.trim() : '';
    if (imagePath) {
      if (typeof global.Sprite !== 'function') {
        reportParticleCapability(runtime, node, 'The current MV/MZ host does not provide Sprite for textured particles.');
        return null;
      }
      return new global.Sprite(loadBitmap(imagePath));
    }
    return createParticleShape(props.shape, props, runtime, node);
  }

  function resetParticleObject(particle, props, frame) {
    var position = particleEmissionPosition(props);
    particle.visible = true;
    particle.x = position.x;
    particle.y = position.y;
    particle.alpha = particleOpacity(props.startOpacity, props.endOpacity, 0);
    particle.scale = particle.scale || { x: 1, y: 1 };
    particle.scale.x = particle.scale.y = Math.max(0, finite(props.startScale, 1));
    particle.rotation = 0;
    particle.tint = parseColor(props.startColor, 0xffffff);
    particle.blendMode = resolveBlendMode(props.blendMode);
    particle.__mzuiVelocityX = finite(props.velocityX, 0) + (Math.random() - 0.5) * finite(props.velocityRandomX, 0);
    particle.__mzuiVelocityY = finite(props.velocityY, 0) + (Math.random() - 0.5) * finite(props.velocityRandomY, 0);
    var lifetime = finite(props.lifetime, 1);
    var randomLifetime = finite(props.lifetimeRandom, 0);
    particle.__mzuiBirth = frame;
    particle.__mzuiLife = Math.max(1, Math.round(lifetime + (Math.random() - 0.5) * randomLifetime));
  }

  function particleEmissionPosition(props) {
    var area = props.emissionArea || 'point';
    var width = finite(props.width, 0);
    var height = finite(props.height, 0);
    if (area === 'rectangle') return { x: Math.random() * width, y: Math.random() * height };
    if (area === 'circle') {
      var angle = Math.random() * Math.PI * 2;
      var radius = Math.sqrt(Math.random()) * Math.min(width, height) / 2;
      return { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius };
    }
    return { x: width / 2, y: height / 2 };
  }

  function particleOpacity(from, to, progress) {
    var value = finite(from, 255) + (finite(to, 0) - finite(from, 255)) * progress;
    return Math.max(0, Math.min(255, value)) / 255;
  }

  function recycleParticle(state, particle, maxParticles) {
    if (particle.parent && typeof particle.parent.removeChild === 'function') particle.parent.removeChild(particle);
    particle.visible = false;
    if (state.pool.length < maxParticles) state.pool.push(particle);
    else destroyParticleObject(particle);
  }

  function trimActiveParticles(state, maxParticles) {
    while (state.particles.length > maxParticles) recycleParticle(state, state.particles.pop(), maxParticles);
  }

  function trimParticlePool(state, maxParticles) {
    while (state.pool.length > maxParticles) destroyParticleObject(state.pool.pop());
  }

  function disposeParticleState(state, view) {
    if (!state) return;
    var particles = (state.particles || []).concat(state.pool || []);
    particles.forEach(destroyParticleObject);
    state.particles = [];
    state.pool = [];
    var layer = state.layer || view && view.__mzuiParticleLayer;
    if (layer && layer.parent && typeof layer.parent.removeChild === 'function') layer.parent.removeChild(layer);
    if (layer) layer.__mzuiParticleDestroyed = true;
    if (layer && typeof layer.destroy === 'function') { try { layer.destroy({ children: false, texture: false, baseTexture: false }); } catch (_) {} }
    state.layer = null;
    state.layerKey = '';
    if (view) view.__mzuiParticleLayer = null;
  }

  function destroyParticleObject(particle) {
    if (!particle || particle.__mzuiParticleDestroyed) return;
    particle.__mzuiParticleDestroyed = true;
    if (particle.parent && typeof particle.parent.removeChild === 'function') particle.parent.removeChild(particle);
    if (typeof particle.destroy === 'function') { try { particle.destroy({ children: true, texture: false, baseTexture: false }); } catch (_) {} }
  }

  function reportParticleCapability(runtime, node, message) {
    if (runtime && node) runtime.reportError(new Error(message), 'particle-capability', { node: node.id, type: 'particle', phase: 'update' });
  }

  function createParticleShape(shape, props, runtime, node) {
    if (!global.PIXI || typeof global.PIXI.Graphics !== 'function') {
      reportParticleCapability(runtime, node, 'The current MV/MZ PIXI host does not provide Graphics for shape particles.');
      return null;
    }
    var graphics = new global.PIXI.Graphics();
    var size = Math.max(1, finite(props.size, 8));
    // White geometry keeps start/end tint interpolation exact instead of
    // multiplying a baked fill color by a second tint color.
    if (typeof graphics.beginFill === 'function') graphics.beginFill(0xffffff);
    if (shape === 'circle' && typeof graphics.drawCircle === 'function') graphics.drawCircle(0, 0, size / 2);
    else if (shape === 'star' && typeof graphics.drawStar === 'function') graphics.drawStar(0, 0, 5, size / 2);
    else if (shape === 'square' && typeof graphics.drawRect === 'function') graphics.drawRect(-size / 2, -size / 2, size, size);
    else {
      if (typeof graphics.destroy === 'function') { try { graphics.destroy(); } catch (_) {} }
      reportParticleCapability(runtime, node, 'Unsupported particle shape: ' + String(shape));
      return null;
    }
    if (typeof graphics.endFill === 'function') graphics.endFill();
    return graphics;
  }

  function resolveBlendMode(mode) {
    var normalized = typeof mode === 'string' ? mode.toLowerCase() : 'normal';
    var modes = global.PIXI && global.PIXI.BLEND_MODES;
    if (modes) {
      if (normalized === 'add') return modes.ADD !== undefined ? modes.ADD : 'add';
      if (normalized === 'multiply') return modes.MULTIPLY !== undefined ? modes.MULTIPLY : 'multiply';
      if (normalized === 'screen') return modes.SCREEN !== undefined ? modes.SCREEN : 'screen';
      if (normalized === 'overlay') return modes.OVERLAY !== undefined ? modes.OVERLAY : 'overlay';
    }
    return normalized === 'add' || normalized === 'multiply' || normalized === 'screen' || normalized === 'overlay'
      ? normalized
      : (modes && modes.NORMAL !== undefined ? modes.NORMAL : 'normal');
  }

  function applyParticleVisual(view, props) {
    if (!view) return;
    reportUnsupportedBlendMode(view, props.blendMode, 'particle');
    view.blendMode = resolveBlendMode(props.blendMode);
    var glow = Math.max(0, finite(props.glow, 0));
    if (glow > 0 && global.PIXI && typeof global.PIXI.Filter === 'function') {
      if (!view.__mzuiGlowFilter) view.__mzuiGlowFilter = createParticleGlowFilter();
      var runtime = view.__mzuiRuntime;
      var scene = runtime && runtime.scene;
      var width = Math.max(1, finite(scene && scene.meta && scene.meta.canvasWidth, finite(global.Graphics && global.Graphics.width, 816)));
      var height = Math.max(1, finite(scene && scene.meta && scene.meta.canvasHeight, finite(global.Graphics && global.Graphics.height, 624)));
      view.__mzuiGlowFilter.uniforms.mzuiGlowOffset = [glow / width, glow / height];
      view.__mzuiGlowFilter.uniforms.mzuiGlowStrength = Math.min(1, glow / 8);
      view.__mzuiGlowFilter.padding = Math.ceil(glow);
      view.filters = [view.__mzuiGlowFilter];
    } else {
      if (glow > 0 && view.__mzuiRuntime && view.__mzuiNode) {
        reportParticleCapability(view.__mzuiRuntime, view.__mzuiNode, 'The current MV/MZ PIXI host does not provide Filter for particle glow.');
      }
      disposeParticleVisual(view);
    }
  }

  function mergeRuntimeContext(provided, explicit) {
    var result = {};
    var providedContext = object(provided) ? provided : {};
    var explicitContext = object(explicit) ? explicit : {};
    Object.keys(providedContext).forEach(function (key) { if (key !== 'actions') result[key] = providedContext[key]; });
    Object.keys(explicitContext).forEach(function (key) { if (key !== 'actions') result[key] = explicitContext[key]; });
    var actions = {};
    if (object(explicitContext.actions)) Object.keys(explicitContext.actions).forEach(function (key) { actions[key] = explicitContext.actions[key]; });
    if (object(providedContext.actions)) Object.keys(providedContext.actions).forEach(function (key) { actions[key] = providedContext.actions[key]; });
    if (Object.keys(actions).length) result.actions = actions;
    return result;
  }

  function createParticleGlowFilter() {
    var fragment = [
      'varying vec2 vTextureCoord;',
      'uniform sampler2D uSampler;',
      'uniform vec2 mzuiGlowOffset;',
      'uniform float mzuiGlowStrength;',
      'float mzuiSampleAlpha(vec2 uv) {',
      '  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));',
      '  return texture2D(uSampler, clamp(uv, vec2(0.0), vec2(1.0))).a * inside.x * inside.y;',
      '}',
      'void main(void) {',
      '  vec4 base = texture2D(uSampler, vTextureCoord);',
      '  vec2 d = mzuiGlowOffset;',
      '  vec2 diagonal = d * 0.70710678;',
      '  float halo = mzuiSampleAlpha(vTextureCoord + vec2(d.x, 0.0));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord - vec2(d.x, 0.0)));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord + vec2(0.0, d.y)));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord - vec2(0.0, d.y)));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord + diagonal));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord - diagonal));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord + vec2(diagonal.x, -diagonal.y)));',
      '  halo = max(halo, mzuiSampleAlpha(vTextureCoord + vec2(-diagonal.x, diagonal.y)));',
      '  float glowAlpha = max(0.0, halo - base.a) * mzuiGlowStrength;',
      '  vec3 premultipliedGlow = vec3(glowAlpha) * (1.0 - base.a);',
      '  gl_FragColor = vec4(base.rgb + premultipliedGlow, max(base.a, glowAlpha));',
      '}',
    ].join('\n');
    // Let each bundled PIXI version extract its own uniform metadata; passing
    // raw values here is incompatible with MV's PIXI 4 uniformData shape.
    return new global.PIXI.Filter(undefined, fragment);
  }

  function disposeParticleVisual(view) {
    if (!view) return;
    view.filters = null;
    if (view.__mzuiGlowFilter && typeof view.__mzuiGlowFilter.destroy === 'function') {
      try { view.__mzuiGlowFilter.destroy(); } catch (_) {}
    }
    view.__mzuiGlowFilter = null;
  }

  function updateSpriteScroll(node, view) {
    if (!node || node.type !== 'sprite' || !view || !view.tilePosition) return;
    // scrollX/scrollY are pixel offsets per update frame, not absolute values.
    view.tilePosition.x += finite(node.props && node.props.scrollX, 0);
    view.tilePosition.y += finite(node.props && node.props.scrollY, 0);
  }

  function reportUnsupportedBlendMode(view, mode, type) {
    var normalized = typeof mode === 'string' && mode.trim() ? mode.toLowerCase() : 'normal';
    var supported = { normal: 'NORMAL', add: 'ADD', multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY' };
    var runtime = view && view.__mzuiRuntime;
    var node = view && view.__mzuiNode;
    if (!runtime || !node) return;
    if (!Object.prototype.hasOwnProperty.call(supported, normalized)) {
      runtime.reportError(new Error('Unsupported blend mode: ' + normalized), 'blend-mode', { node: node.id, type: type, phase: 'props' });
      return;
    }
    var modes = global.PIXI && global.PIXI.BLEND_MODES;
    if (modes && normalized !== 'normal' && modes[supported[normalized]] === undefined) {
      runtime.reportError(new Error('The current PIXI/MV/MZ host does not provide blend mode: ' + normalized), 'blend-mode', { node: node.id, type: type, phase: 'props' });
    }
  }

  function effectiveNodeVisibility(node, conditionVisible) {
    return Boolean(node && node.props && node.props.visible !== false && conditionVisible !== false);
  }

  function applyNodeProps(node, view, scene, conditionVisible) {
    if (!view) return;
    var props = node.props || {};
    applyNodeDimensions(view, props);
    view.alpha = Math.max(0, Math.min(255, finite(props.opacity, 255))) / 255;
    view.visible = props.visible !== false && conditionVisible !== false;
    applyNodeAnchor(view, props);
    view.zIndex = finite(props.zIndex, 0);
    if (node.type === 'sprite') {
      if ('tint' in view && typeof props.tint === 'string') view.tint = parseColor(props.tint, 0xffffff);
      reportUnsupportedBlendMode(view, props.blendMode, 'sprite');
      if ('blendMode' in view) view.blendMode = resolveBlendMode(props.blendMode);
      if (view.tilePosition && !view.__mzuiScrollInitialized) { view.tilePosition.x = 0; view.tilePosition.y = 0; view.__mzuiScrollInitialized = true; }
      applySpriteFill(view, props);
      rememberNodeWorldScale(view);
    }
    if (node.type === 'container') applyContainerVisual(view, props);
    if (node.type === 'text') {
      if (view.__mzuiTextRuns) {
        renderTextRuns(view, props, view.__mzuiContext || {});
      } else if (view.text !== undefined) {
        applyPlainTextStyle(view, props);
        view.__mzuiRichText = 'plain-text';
        if (props.backgroundColor) view.__mzuiBackgroundColor = props.backgroundColor;
        renderTextBackground(view, props);
      }
    }
    if (node.type === 'button') {
      if ('contents' in view && view.contents && typeof view.contents.clear === 'function') view.contents.clear();
      renderButtonText(view, props);
      if ('openness' in view) view.openness = 255;
      applyButtonVisual(view, props);
    }
    if ((node.type === 'progressBar' || node.type === 'overlay') && typeof view.clear === 'function' && typeof view.beginFill === 'function') {
      view.clear();
      if (node.type === 'overlay') {
        view.beginFill(parseColor(props.fillColor, 0x000000), parseAlpha(props.fillColor));
        drawRect(view, 0, 0, finite(props.width, 0), finite(props.height, 0), finite(props.borderRadius, 0)); view.endFill();
        view.interactive = props.clickThrough !== true;
      } else {
        var ratio = Math.max(0, Math.min(1, finite(props.currentValue, 0) / Math.max(1, finite(props.maxValue, 1))));
        if (props.animateValue) {
          var previousRatio = typeof view.__mzuiAnimatedRatio === 'number' ? view.__mzuiAnimatedRatio : ratio;
          view.__mzuiAnimatedRatio = previousRatio + (ratio - previousRatio) * 0.2;
          ratio = view.__mzuiAnimatedRatio;
        } else view.__mzuiAnimatedRatio = ratio;
        view.beginFill(parseColor(props.trackColor, 0x444444), parseAlpha(props.trackColor));
        drawRect(view, 0, 0, finite(props.width, 0), finite(props.height, 0), finite(props.trackRadius, 0)); view.endFill();
        view.beginFill(parseColor(props.fillColor, 0x66ccaa), parseAlpha(props.fillColor));
        var fillWidth = finite(props.width, 0) * ratio; var fillHeight = finite(props.height, 0) * ratio;
        if (props.fillDirection === 'rightToLeft') drawRect(view, finite(props.width, 0) - fillWidth, 0, fillWidth, finite(props.height, 0), finite(props.fillRadius, 0));
        else if (props.fillDirection === 'bottomToTop') drawRect(view, 0, finite(props.height, 0) - fillHeight, finite(props.width, 0), fillHeight, finite(props.fillRadius, 0));
        else if (props.fillDirection === 'topToBottom') drawRect(view, 0, 0, finite(props.width, 0), fillHeight, finite(props.fillRadius, 0));
        else drawRect(view, 0, 0, fillWidth, finite(props.height, 0), finite(props.fillRadius, 0));
        view.endFill();
        applyProgressImages(view, props, ratio);
      }
    }
    if (node.type === 'particle') applyParticleVisual(view, props);
    var linkedVideo = view.__mzuiVideo || view.texture && view.texture.baseTexture && view.texture.baseTexture.resource && view.texture.baseTexture.resource.source;
    if (node.type === 'video' && linkedVideo && typeof linkedVideo === 'object') {
      var video = linkedVideo;
      video.autoplay = props.autoplay !== false; video.loop = props.loop === true; video.muted = props.muted === true; video.playbackRate = finite(props.playbackRate, 1);
      video.controls = false;
      if (props.posterPath) video.poster = props.posterPath;
      video.__mzuiOriginalSrc = video.src || props.path;
      if (props.autoplay !== false && typeof video.play === 'function') {
        var playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(function () {});
      }
      view.__mzuiVideo = video;
    }
    if (node.type === 'nineSlice' && view) {
      applyNineSliceBorders(view, props);
    }
    syncInteractiveHitArea(node, view);
    applyNodeTransform(node, view, scene);
  }

  function fitNineSliceBorderPair(start, end, limit) {
    var safeStart = Math.max(0, finite(start, 0));
    var safeEnd = Math.max(0, finite(end, 0));
    var safeLimit = Math.max(0, finite(limit, 0));
    var total = safeStart + safeEnd;
    if (total <= safeLimit || total === 0) return [safeStart, safeEnd];
    var ratio = safeLimit / total;
    return [safeStart * ratio, safeEnd * ratio];
  }

  function applyNineSliceBorders(view, props) {
    if (!view) return;
    var source = sourceDimensions(view);
    var horizontalLimit = Math.min(Math.max(0, finite(props.width, view.width || 0)), source ? source.width : Number.MAX_VALUE);
    var verticalLimit = Math.min(Math.max(0, finite(props.height, view.height || 0)), source ? source.height : Number.MAX_VALUE);
    var horizontal = fitNineSliceBorderPair(props.borderLeft, props.borderRight, horizontalLimit);
    var vertical = fitNineSliceBorderPair(props.borderTop, props.borderBottom, verticalLimit);
    view.leftWidth = horizontal[0];
    view.rightWidth = horizontal[1];
    view.topHeight = vertical[0];
    view.bottomHeight = vertical[1];
  }

  function applyNodeDimensions(view, props) {
    var width = finite(props.width, view.width || 0);
    var height = finite(props.height, view.height || 0);
    var scaleX = finite(props.scaleX, 1);
    var scaleY = finite(props.scaleY, 1);
    view.scale = view.scale || { x: 1, y: 1 };
    if (view.__mzuiTextNode) {
      // A text box constrains wrapping and alignment; it must not stretch the
      // glyph texture to the box rectangle. Designer scaling is applied once.
      view.scale.x = scaleX;
      view.scale.y = scaleY;
      view.__mzuiDesignerScaleX = scaleX;
      view.__mzuiDesignerScaleY = scaleY;
      view.__mzuiWorldScaleX = scaleX;
      view.__mzuiWorldScaleY = scaleY;
      view.__mzuiDimensions = { width: width, height: height, scaleX: scaleX, scaleY: scaleY };
      return;
    }
    if (view.__mzuiNineSlice) {
      view.width = width;
      view.height = height;
      view.scale.x = scaleX;
      view.scale.y = scaleY;
      view.__mzuiDesignerScaleX = scaleX;
      view.__mzuiDesignerScaleY = scaleY;
      view.__mzuiWorldScaleX = scaleX;
      view.__mzuiWorldScaleY = scaleY;
      view.__mzuiDimensions = { width: width, height: height, scaleX: scaleX, scaleY: scaleY };
      return;
    }
    var source = sourceDimensions(view);
    if (source) {
      // PIXI Sprite.width/height setters mutate scale. Compute one final
      // texture-to-logical-size scale so width/height and designer scale do
      // not multiply an already-sized sprite a second time.
      view.scale.x = width / source.width * scaleX;
      view.scale.y = height / source.height * scaleY;
    } else {
      view.width = width;
      view.height = height;
      view.scale.x = scaleX;
      view.scale.y = scaleY;
    }
    view.__mzuiDesignerScaleX = view.scale.x;
    view.__mzuiDesignerScaleY = view.scale.y;
    view.__mzuiWorldScaleX = view.scale.x;
    view.__mzuiWorldScaleY = view.scale.y;
    view.__mzuiDimensions = { width: width, height: height, scaleX: scaleX, scaleY: scaleY };
  }

  function rememberNodeWorldScale(view) {
    if (!view || !view.scale) return;
    view.__mzuiDesignerScaleX = finite(view.scale.x, 1);
    view.__mzuiDesignerScaleY = finite(view.scale.y, 1);
    view.__mzuiWorldScaleX = view.__mzuiDesignerScaleX;
    view.__mzuiWorldScaleY = view.__mzuiDesignerScaleY;
  }

  function applyNodeAnchor(view, props) {
    var anchorX = finite(props.anchorX, 0);
    var anchorY = finite(props.anchorY, 0);
    if (view.anchor && typeof view.anchor === 'object') {
      view.anchor.x = anchorX;
      view.anchor.y = anchorY;
      if (view.pivot && typeof view.pivot === 'object') { view.pivot.x = 0; view.pivot.y = 0; }
      return;
    }
    if (view.pivot && typeof view.pivot === 'object') {
      view.pivot.x = finite(props.width, 0) * anchorX;
      view.pivot.y = finite(props.height, 0) * anchorY;
    }
  }

  function nodeWorldMatrix(node, scaleX, scaleY, offsetY) {
    var props = node && node.props ? node.props : {};
    var rotation = finite(props.rotate, 0) * Math.PI / 180;
    var cosine = Math.cos(rotation);
    var sine = Math.sin(rotation);
    var a = cosine * finite(scaleX, finite(props.scaleX, 1));
    var b = sine * finite(scaleX, finite(props.scaleX, 1));
    var c = -sine * finite(scaleY, finite(props.scaleY, 1));
    var d = cosine * finite(scaleY, finite(props.scaleY, 1));
    var pivotX = finite(props.width, 0) * finite(props.anchorX, 0);
    var pivotY = finite(props.height, 0) * finite(props.anchorY, 0);
    var worldX = finite(props.x, 0);
    var worldY = finite(props.y, 0) + finite(offsetY, 0);
    return {
      a: a, b: b, c: c, d: d,
      tx: worldX - a * pivotX - c * pivotY,
      ty: worldY - b * pivotX - d * pivotY,
    };
  }

  function decomposeNodeLinearTransform(a, b, c, d) {
    var epsilon = 1e-10;
    var scaleX = Math.sqrt(a * a + b * b);
    var columnY = Math.sqrt(c * c + d * d);
    if (scaleX <= epsilon) {
      if (columnY <= epsilon) return { rotation: 0, skewX: 0, skewY: 0, scaleX: 0, scaleY: 0 };
      return { rotation: Math.atan2(-c, d), skewX: 0, skewY: 0, scaleX: 0, scaleY: columnY };
    }
    var determinant = a * d - b * c;
    var scaleY = determinant < 0 ? -columnY : columnY;
    var rotation = Math.atan2(b, a);
    var secondAngle = columnY <= epsilon ? rotation : Math.atan2(-c / scaleY, d / scaleY);
    return { rotation: rotation, skewX: rotation - secondAngle, skewY: 0, scaleX: scaleX, scaleY: scaleY };
  }

  function applyNodeTransform(node, view, scene) {
    if (!node || !view) return;
    var props = node.props || {};
    var offsetX = 0;
    var offsetY = 0;
    if (node.type === 'text' && !view.__mzuiTextRuns && view.text !== undefined) {
      offsetX = plainTextHorizontalOffset(view, props);
      offsetY = plainTextVerticalOffset(view, props);
    }
    var worldScaleX = finite(view.__mzuiWorldScaleX, finite(props.scaleX, 1)) * finite(view.__mzuiTextHorizontalScale, 1);
    var worldScaleY = finite(view.__mzuiWorldScaleY, finite(props.scaleY, 1));
    var desired = nodeWorldMatrix(node, worldScaleX, worldScaleY, offsetY);
    var parent = node.parentId ? findNode(scene, node.parentId) : null;
    var local = desired;
    var rotation = finite(props.rotate, 0) * Math.PI / 180;
    var worldX = finite(props.x, 0) + Math.cos(rotation) * offsetX - Math.sin(rotation) * offsetY;
    var worldY = finite(props.y, 0) + Math.sin(rotation) * offsetX + Math.cos(rotation) * offsetY;
    var localX = worldX;
    var localY = worldY;
    if (parent) {
      var parentProps = parent.props || {};
      var parentWorld = nodeWorldMatrix(parent, finite(parentProps.scaleX, 1), finite(parentProps.scaleY, 1));
      var determinant = parentWorld.a * parentWorld.d - parentWorld.b * parentWorld.c;
      if (Math.abs(determinant) <= 1e-10) throw new Error('UI renderer cannot place a child inside a container with a zero scale.');
      var inverseA = parentWorld.d / determinant;
      var inverseB = -parentWorld.b / determinant;
      var inverseC = -parentWorld.c / determinant;
      var inverseD = parentWorld.a / determinant;
      var dx = worldX - parentWorld.tx;
      var dy = worldY - parentWorld.ty;
      localX = inverseA * dx + inverseC * dy;
      localY = inverseB * dx + inverseD * dy;
      local = {
        a: inverseA * desired.a + inverseC * desired.b,
        b: inverseB * desired.a + inverseD * desired.b,
        c: inverseA * desired.c + inverseC * desired.d,
        d: inverseB * desired.c + inverseD * desired.d,
      };
    }
    var decomposed = decomposeNodeLinearTransform(local.a, local.b, local.c, local.d);
    view.x = localX;
    view.y = localY;
    view.rotation = decomposed.rotation;
    view.scale = view.scale || { x: 1, y: 1 };
    view.scale.x = decomposed.scaleX;
    view.scale.y = decomposed.scaleY;
    view.skew = view.skew || { x: 0, y: 0 };
    view.skew.x = decomposed.skewX;
    view.skew.y = decomposed.skewY;
  }

  function renderTextBackground(view, props) {
    if (!view || !props.backgroundColor || !global.PIXI || typeof global.PIXI.Graphics !== 'function' || typeof view.addChildAt !== 'function') return;
    if (!view.__mzuiTextBackground) {
      view.__mzuiTextBackground = new global.PIXI.Graphics();
      view.__mzuiTextBackground.renderable = true;
      view.addChildAt(view.__mzuiTextBackground, 0);
    }
    var background = view.__mzuiTextBackground;
    if (typeof background.clear === 'function') background.clear();
    if (typeof background.beginFill === 'function') background.beginFill(parseColor(props.backgroundColor, 0x000000), parseAlpha(props.backgroundColor));
    drawRect(background, 0, 0, finite(props.width, 0), finite(props.height, 0), 0);
    if (typeof background.endFill === 'function') background.endFill();
  }

  function loadFontFile(path) {
    if (typeof path !== 'string' || !path.trim()) return '';
    var normalized = path.trim().replace(/\\/g, '/');
    var family = 'MZUI_' + normalized.replace(/[^A-Za-z0-9_$]/g, '_');
    // MZ exposes FontManager; MV/NW and isolated hosts expose the standard
    // FontFace API.  Keep both branches explicit so a missing loader is a
    // diagnosed unsupported font path rather than an arbitrary fallback.
    if (global.FontManager && typeof global.FontManager.load === 'function') {
      try { global.FontManager.load(family, normalized); return family; } catch (_) { return ''; }
    }
    if (typeof document === 'undefined' || !document || typeof document.fonts === 'undefined' || typeof global.FontFace !== 'function') return '';
    if (document.fonts && typeof document.fonts.check === 'function' && document.fonts.check('12px ' + family)) return family;
    try {
      var face = new global.FontFace(family, 'url(' + normalized + ')');
      var loaded = face.load();
      if (loaded && typeof loaded.then === 'function') loaded.then(function () { document.fonts.add(face); }).catch(function () {});
      return family;
    } catch (_) {
      return '';
    }
  }

  function applySpriteFill(view, props) {
    if (!view) return;
    var width = finite(props.width, view.width || 0);
    var height = finite(props.height, view.height || 0);
    applyFillMode(view, width, height, props.fillMode, props.scaleX, props.scaleY);
    view.__mzuiFillMode = props.fillMode || 'stretch';
    applyRepeatMode(view, effectiveRepeatMode(props.repeatMode, props.fillMode), width, height, props.scaleX, props.scaleY);
  }

  function effectiveRepeatMode(mode, fillMode) {
    if (mode === 'horizontal' || mode === 'vertical' || mode === 'both') return mode;
    return fillMode === 'tile' ? 'both' : 'none';
  }

  function repeatAxes(mode) {
    return {
      x: mode === 'horizontal' || mode === 'both',
      y: mode === 'vertical' || mode === 'both',
    };
  }

  function applyRepeatMode(view, mode, width, height, scaleX, scaleY) {
    var axes = repeatAxes(mode);
    view.__mzuiRepeatMode = mode;
    view.__mzuiRepeatAxes = axes;
    if (!view.tileScale) return;
    var source = sourceDimensions(view);
    // PIXI.TilingSprite repeats over both axes.  Scale the non-repeating axis
    // to exactly one source tile, preserving the requested target geometry;
    // this gives horizontal/vertical repeat a real rendering distinction.
    var xScale = finite(scaleX, 1);
    var yScale = finite(scaleY, 1);
    if (!axes.x && source && source.width > 0) xScale = width / source.width;
    if (!axes.y && source && source.height > 0) yScale = height / source.height;
    view.tileScale.x = xScale;
    view.tileScale.y = yScale;
  }

  function applyFillMode(view, width, height, mode, scaleX, scaleY) {
    if (!view) return;
    var normalized = mode || 'stretch';
    if (normalized === 'tile' && view.tileScale) {
      view.width = width; view.height = height;
      view.tileScale.x = finite(scaleX, 1); view.tileScale.y = finite(scaleY, 1);
      return;
    }
    if (normalized === 'stretch') {
      var stretchSource = sourceDimensions(view);
      if (stretchSource && !view.tileScale) {
        if (view.scale) {
          view.scale.x = width / stretchSource.width * finite(scaleX, 1);
          view.scale.y = height / stretchSource.height * finite(scaleY, 1);
        }
      } else {
        view.width = width; view.height = height;
        if (view.scale) { view.scale.x = finite(scaleX, 1); view.scale.y = finite(scaleY, 1); }
      }
      return;
    }
    var fillSource = sourceDimensions(view);
    var ratio = fillSource
      ? normalized === 'cover' ? Math.max(width / fillSource.width, height / fillSource.height) : Math.min(width / fillSource.width, height / fillSource.height)
      : 1;
    if (view.scale) { view.scale.x = ratio * finite(scaleX, 1); view.scale.y = ratio * finite(scaleY, 1); }
    view.__mzuiFrame = { width: width, height: height, scale: ratio, mode: normalized };
  }

  function sourceDimensions(view) {
    var texture = view && (view.__mzuiSourceTexture || view.texture || view.__mzuiSourceBitmap || view.bitmap);
    var baseTexture = texture && (texture.baseTexture || texture._baseTexture);
    var bitmap = view && view.__mzuiSourceBitmap;
    var width = finite(texture && (
      texture.orig && texture.orig.width
      || texture.frame && texture.frame.width
      || texture.width
      || texture.widthOriginal
      || texture._image && texture._image.width
      || baseTexture && (baseTexture.realWidth || baseTexture.width)
    ), finite(bitmap && bitmap.width, 0));
    var height = finite(texture && (
      texture.orig && texture.orig.height
      || texture.frame && texture.frame.height
      || texture.height
      || texture.heightOriginal
      || texture._image && texture._image.height
      || baseTexture && (baseTexture.realHeight || baseTexture.height)
    ), finite(bitmap && bitmap.height, 0));
    return width > 0 && height > 0 ? { width: width, height: height } : null;
  }

  function applyContainerVisual(view, props) {
    if (!view) return;
    if (props.backgroundPath && typeof view.addChild === 'function' && !view.__mzuiBackground) {
      var repeatMode = effectiveRepeatMode(props.backgroundRepeatMode, props.backgroundFillMode);
      var repeat = repeatMode !== 'none';
      var background = repeat && global.PIXI && typeof global.PIXI.TilingSprite === 'function'
        ? new global.PIXI.TilingSprite(loadTexture(props.backgroundPath) || loadBitmap(props.backgroundPath), finite(props.width, 0), finite(props.height, 0))
        : typeof global.Sprite === 'function' ? new global.Sprite(loadBitmap(props.backgroundPath)) : null;
      if (background) { background.__mzuiBackground = true; view.__mzuiBackground = background; view.addChildAt ? view.addChildAt(background, 0) : view.addChild(background); }
    }
    var background = view.__mzuiBackground;
    if (background) {
      // The container's own scale is applied by its parent; do not multiply
      // it into the background child a second time.
      var backgroundWidth = finite(props.width, background.width || 0);
      var backgroundHeight = finite(props.height, background.height || 0);
      applyFillMode(background, backgroundWidth, backgroundHeight, props.backgroundFillMode, 1, 1);
      background.__mzuiFillMode = props.backgroundFillMode || 'stretch';
      applyRepeatMode(background, effectiveRepeatMode(props.backgroundRepeatMode, props.backgroundFillMode), backgroundWidth, backgroundHeight, 1, 1);
      if (effectiveRepeatMode(props.backgroundRepeatMode, props.backgroundFillMode) !== 'none') {
        if (background.tilePosition) { background.tilePosition.x = 0; background.tilePosition.y = 0; }
      }
    }
    if (props.clip && global.PIXI && typeof global.PIXI.Graphics === 'function') {
      if (!view.__mzuiMask) view.__mzuiMask = new global.PIXI.Graphics();
      var mask = view.__mzuiMask;
      if (typeof mask.clear === 'function') mask.clear();
      if (typeof mask.beginFill === 'function') mask.beginFill(0xffffff);
      drawRect(mask, 0, 0, finite(props.width, 0), finite(props.height, 0), 0);
      if (typeof mask.endFill === 'function') mask.endFill();
      mask.renderable = false;
      view.mask = mask;
      if (typeof view.addChild === 'function' && !mask.parent) view.addChild(mask);
    } else if (view.mask) view.mask = null;
  }

  function applyButtonVisual(view, props) {
    if (!view) return;
    view.__mzuiButtonStates = props.imageStates || { normal: '', hover: '', pressed: '', disabled: '' };
    view.__mzuiHoverTint = props.hoverTint || '#ffffff';
    view.__mzuiFocusColor = props.focusColor || '#ffffff';
    view.__mzuiFocusWidth = finite(props.focusWidth, 1);
    view.__mzuiSe = { hover: props.hoverSe || '', click: props.clickSe || '' };
    view.__mzuiButtonState = view.__mzuiButtonState || 'normal';
    view.__mzuiPointerHover = Boolean(view.__mzuiPointerHover);
    view.__mzuiDisabledCondition = props.disabledCondition || '';
    if (typeof view.__mzuiDisabled !== 'boolean') view.__mzuiDisabled = Boolean(props.disabled);
    renderButtonChrome(view, props);
    renderButtonState(view, props);
  }

  function renderButtonChrome(view, props) {
    if (!view) return;
    var states = view.__mzuiButtonStates || props.imageStates || {};
    var usesStateImages = Object.keys(states).some(function (key) { return Boolean(states[key]); });
    // Window_Base owns the engine windowskin background/frame independently
    // from ordinary PIXI children. Its opacity hides that native chrome while
    // leaving contents and our custom state-image child visible.
    view.opacity = usesStateImages ? 0 : 255;
    ['_windowBackSprite', '_windowFrameSprite', '_backSprite', '_frameSprite'].forEach(function (key) {
      if (view[key]) view[key].visible = !usesStateImages;
    });
    if (!global.PIXI || typeof global.PIXI.Graphics !== 'function' || typeof view.addChildAt !== 'function') return;
    if (!view.__mzuiButtonChrome) {
      view.__mzuiButtonChrome = new global.PIXI.Graphics();
      view.__mzuiButtonChrome.renderable = true;
      view.addChildAt(view.__mzuiButtonChrome, 0);
    }
    var chrome = view.__mzuiButtonChrome;
    if (typeof chrome.clear === 'function') chrome.clear();
    chrome.visible = !usesStateImages;
    if (!chrome.visible) return;
    if (props.backgroundColor && typeof chrome.beginFill === 'function') chrome.beginFill(parseColor(props.backgroundColor, 0x000000), parseAlpha(props.backgroundColor));
    if (props.backgroundColor) drawRect(chrome, 0, 0, finite(props.width, 0), finite(props.height, 0), finite(props.borderRadius, 0));
    if (props.backgroundColor && typeof chrome.endFill === 'function') chrome.endFill();
    if (finite(props.borderWidth, 0) > 0 && typeof chrome.lineStyle === 'function') {
      chrome.lineStyle(finite(props.borderWidth, 1), parseColor(props.borderColor, 0xffffff), parseAlpha(props.borderColor));
      if (typeof chrome.drawRoundedRect === 'function') chrome.drawRoundedRect(0, 0, finite(props.width, 0), finite(props.height, 0), finite(props.borderRadius, 0));
      else if (typeof chrome.drawRect === 'function') chrome.drawRect(0, 0, finite(props.width, 0), finite(props.height, 0));
    }
  }

  function renderButtonState(view, props) {
    if (!view || typeof view.addChild !== 'function' || typeof global.Sprite !== 'function') return;
    var states = view.__mzuiButtonStates || {};
    var state = view.__mzuiDisabled ? 'disabled' : (view.__mzuiButtonState || 'normal');
    var path = states[state] || states.normal || '';
    if (path && (!view.__mzuiButtonImage || view.__mzuiButtonImagePath !== path)) {
      if (view.__mzuiButtonImage && view.__mzuiButtonImage.parent && typeof view.__mzuiButtonImage.parent.removeChild === 'function') view.__mzuiButtonImage.parent.removeChild(view.__mzuiButtonImage);
      var buttonImage = new global.Sprite(loadBitmap(path));
      view.__mzuiButtonImage = buttonImage;
      view.__mzuiButtonImagePath = path;
      view.addChildAt ? view.addChildAt(buttonImage, 0) : view.addChild(buttonImage);
      loadTexture(path, function (texture) {
        if (buttonImage.__mzuiDestroyed || view.__mzuiDestroyed) return;
        applyReadyTexture(buttonImage, texture);
        onNodeTextureReady(view.__mzuiRuntime, view.__mzuiNode, view);
      });
    }
    if (view.__mzuiButtonImage) {
      view.__mzuiButtonImage.visible = Boolean(path);
      view.__mzuiButtonImage.width = finite(props.width, 0);
      view.__mzuiButtonImage.height = finite(props.height, 0);
      view.__mzuiButtonImage.tint = state === 'hover' && props.hoverTint ? parseColor(props.hoverTint, 0xffffff) : 0xffffff;
    }
    if (view.__mzuiFocusFrame) view.__mzuiFocusFrame.visible = Boolean(view.__mzuiFocused);
    if (view.__mzuiFocused && global.PIXI && typeof global.PIXI.Graphics === 'function' && !view.__mzuiFocusFrame) {
      var frame = new global.PIXI.Graphics();
      if (typeof frame.lineStyle === 'function') frame.lineStyle(Math.max(1, finite(props.focusWidth, 1)), parseColor(props.focusColor, 0xffffff), 1);
      if (typeof frame.drawRoundedRect === 'function') frame.drawRoundedRect(0, 0, finite(props.width, 0), finite(props.height, 0), finite(props.borderRadius, 0));
      else if (typeof frame.drawRect === 'function') frame.drawRect(0, 0, finite(props.width, 0), finite(props.height, 0));
      frame.renderable = true;
      view.__mzuiFocusFrame = frame;
      view.addChild(frame);
    }
  }

  function applyProgressImages(view, props, ratio) {
    if (!view || typeof view.addChild !== 'function' || typeof global.Sprite !== 'function') return;
    var width = finite(props.width, 0); var height = finite(props.height, 0);
    if (props.trackImage && !view.__mzuiTrackImage) {
      var trackImage = new global.Sprite(loadBitmap(props.trackImage));
      view.__mzuiTrackImage = trackImage;
      view.addChildAt ? view.addChildAt(view.__mzuiTrackImage, 0) : view.addChild(view.__mzuiTrackImage);
      loadTexture(props.trackImage, function (texture) {
        if (trackImage.__mzuiDestroyed || view.__mzuiDestroyed) return;
        applyReadyTexture(trackImage, texture);
        onNodeTextureReady(view.__mzuiRuntime, view.__mzuiNode, view);
      });
    }
    if (props.fillImage && !view.__mzuiFillImage) {
      var fillImage = new global.Sprite(loadBitmap(props.fillImage));
      view.__mzuiFillImage = fillImage;
      view.addChild(view.__mzuiFillImage);
      loadTexture(props.fillImage, function (texture) {
        if (fillImage.__mzuiDestroyed || view.__mzuiDestroyed) return;
        applyReadyTexture(fillImage, texture);
        onNodeTextureReady(view.__mzuiRuntime, view.__mzuiNode, view);
      });
    }
    if (view.__mzuiTrackImage) { view.__mzuiTrackImage.width = width; view.__mzuiTrackImage.height = height; }
    if (view.__mzuiFillImage) {
      var horizontal = props.fillDirection === 'leftToRight' || props.fillDirection === 'rightToLeft';
      var vertical = props.fillDirection === 'bottomToTop' || props.fillDirection === 'topToBottom';
      view.__mzuiFillImage.width = horizontal ? width * ratio : width;
      view.__mzuiFillImage.height = vertical ? height * ratio : height;
      view.__mzuiFillImage.x = props.fillDirection === 'rightToLeft' ? width - view.__mzuiFillImage.width : 0;
      view.__mzuiFillImage.y = props.fillDirection === 'bottomToTop' ? height - view.__mzuiFillImage.height : 0;
      view.__mzuiFillImage.visible = ratio > 0;
      if (global.PIXI && typeof global.PIXI.Graphics === 'function') {
        if (!view.__mzuiFillMask) view.__mzuiFillMask = new global.PIXI.Graphics();
        var mask = view.__mzuiFillMask;
        if (typeof mask.clear === 'function') mask.clear();
        if (typeof mask.beginFill === 'function') mask.beginFill(0xffffff);
        drawRect(mask, view.__mzuiFillImage.x, view.__mzuiFillImage.y, view.__mzuiFillImage.width, view.__mzuiFillImage.height, finite(props.fillRadius, 0));
        if (typeof mask.endFill === 'function') mask.endFill();
        mask.renderable = false;
        view.__mzuiFillImage.mask = mask;
        if (!mask.parent && typeof view.addChild === 'function') view.addChild(mask);
      }
    }
  }

  function drawRect(view, x, y, width, height, radius) {
    if (radius > 0 && typeof view.drawRoundedRect === 'function') view.drawRoundedRect(x, y, width, height, radius);
    else if (typeof view.drawRect === 'function') view.drawRect(x, y, width, height);
  }

  function parseColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var text = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(text)) text = text.split('').map(function (part) { return part + part; }).join('');
    if (/^[0-9a-f]{8}$/i.test(text)) text = text.slice(0, 6);
    if (!/^[0-9a-f]{6}$/i.test(text)) return fallback;
    return parseInt(text, 16);
  }

  function mixColor(from, to, progress) {
    var start = parseColor(from, 0xffffff);
    var end = parseColor(to, 0xffffff);
    var p = Math.max(0, Math.min(1, finite(progress, 0)));
    var r = Math.round(((start >> 16) & 0xff) + (((end >> 16) & 0xff) - ((start >> 16) & 0xff)) * p);
    var g = Math.round(((start >> 8) & 0xff) + (((end >> 8) & 0xff) - ((start >> 8) & 0xff)) * p);
    var b = Math.round((start & 0xff) + ((end & 0xff) - (start & 0xff)) * p);
    return (r << 16) | (g << 8) | b;
  }

  function parseAlpha(value) {
    if (typeof value !== 'string') return 1;
    var text = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{4}$/i.test(text)) text = text.split('').map(function (part) { return part + part; }).join('');
    return /^[0-9a-f]{8}$/i.test(text) ? parseInt(text.slice(6), 16) / 255 : 1;
  }

  function resolveTextFontFamily(props) {
    var loaded = loadFontFile(props && props.fontFile);
    if (loaded) return loaded;
    return nativeTextProfile().fontFace;
  }

  // The RPG Maker native text style is whatever the project engine itself
  // uses for window text: MZ exposes $gameSystem.mainFontFace/mainFontSize,
  // MV exposes Window_Base.standardFontFace/standardFontSize (locale-aware),
  // and the Bitmap defaults carry the native outline color and width.  A
  // fresh 1x1 engine Bitmap is a cheap synchronous probe for those defaults,
  // so designer text matches the game without hardcoding engine constants.
  var nativeTextProfileCache = null;
  function nativeTextProfile() {
    if (nativeTextProfileCache) return nativeTextProfileCache;
    var face = '';
    var size = NaN;
    var tryFace = function (value) {
      if (typeof value === 'string' && value.trim()) { face = value.trim(); return true; }
      return false;
    };
    var trySize = function (value) {
      if (typeof value === 'number' && isFinite(value) && value > 0) { size = value; return true; }
      return false;
    };
    var windowBase = global.Window_Base && global.Window_Base.prototype;
    if (global.$gameSystem) {
      try { if (typeof global.$gameSystem.mainFontFace === 'function') tryFace(global.$gameSystem.mainFontFace()); } catch (_) {}
      try { if (typeof global.$gameSystem.mainFontSize === 'function') trySize(global.$gameSystem.mainFontSize()); } catch (_) {}
    }
    if (!face && windowBase) {
      // MV standardFontFace reads $gameSystem.isChinese/isKorean through the
      // project's $dataSystem locale; call it only when that state exists.
      var mvLocaleReady = global.$gameSystem && typeof global.$gameSystem.isChinese === 'function';
      try { if (mvLocaleReady && typeof windowBase.standardFontFace === 'function') tryFace(windowBase.standardFontFace()); } catch (_) {}
      try { if (typeof windowBase.mainFontFace === 'function') tryFace(windowBase.mainFontFace()); } catch (_) {}
    }
    if (!isFinite(size) && windowBase) {
      try { if (typeof windowBase.standardFontSize === 'function') trySize(windowBase.standardFontSize()); } catch (_) {}
      try { if (typeof windowBase.mainFontSize === 'function') trySize(windowBase.mainFontSize()); } catch (_) {}
    }
    var probe = null;
    try { if (global.Bitmap) probe = new global.Bitmap(1, 1); } catch (_) {}
    var isMvEngine = Boolean(global.Utils && global.Utils.RPGMAKER_NAME === 'MV');
    var outlineColor = probe && typeof probe.outlineColor === 'string' ? probe.outlineColor : 'rgba(0, 0, 0, 0.5)';
    var outlineWidth = probe && isFinite(probe.outlineWidth) && probe.outlineWidth >= 0 ? probe.outlineWidth : (isMvEngine ? 4 : 3);
    nativeTextProfileCache = {
      fontFace: face || (probe && typeof probe.fontFace === 'string' && probe.fontFace.trim() ? probe.fontFace.trim() : 'sans-serif'),
      fontSize: isFinite(size) ? size : (probe && isFinite(probe.fontSize) && probe.fontSize > 0 ? probe.fontSize : 24),
      outlineColor: outlineColor,
      outlineWidth: outlineWidth,
    };
    return nativeTextProfileCache;
  }

  // Designer stroke wins when set; otherwise text keeps the engine's native
  // window-text outline (MV width 4, MZ width 3, both rgba(0,0,0,0.5)).
  function nativeStroke(props) {
    var strokeWidth = finite(props && props.strokeWidth, 0);
    if (strokeWidth > 0) return { color: (props && props.strokeColor) || '#000000', width: strokeWidth };
    var native = nativeTextProfile();
    return { color: native.outlineColor, width: native.outlineWidth };
  }

  function shouldRunNodeAnimation(node, visible) {
    var animation = visible === false ? node && node.exitAnim : node && node.enterAnim;
    return Boolean(animation && animation.type && animation.type !== 'none' && (node.__mzuiVisibleState !== visible || node.__mzuiAnimationActive === true));
  }

  function applyNodeAnimation(node, frame, visible) {
    var animation = visible === false ? node.exitAnim : node.enterAnim;
    if (!animation || !node.props || animation.type === 'none') {
      node.__mzuiAnimationActive = false;
      return false;
    }
    if (node.__mzuiVisibleState !== visible) {
      if (visible && node.__mzuiAnimationBase) {
        node.props.x = node.__mzuiAnimationBase.x; node.props.y = node.__mzuiAnimationBase.y;
        node.props.opacity = node.__mzuiAnimationBase.opacity; node.props.scaleX = node.__mzuiAnimationBase.scaleX; node.props.scaleY = node.__mzuiAnimationBase.scaleY;
      }
      node.__mzuiVisibleState = visible;
      node.__mzuiAnimationFrame = 0;
      node.__mzuiAnimationBase = { x: finite(node.props.x, 0), y: finite(node.props.y, 0), opacity: finite(node.props.opacity, 255), scaleX: finite(node.props.scaleX, 1), scaleY: finite(node.props.scaleY, 1) };
    } else {
      node.__mzuiAnimationFrame = (node.__mzuiAnimationFrame || 0) + 1;
    }
    var localFrame = node.__mzuiAnimationFrame || frame;
    var progress = Math.min(1, localFrame / Math.max(1, finite(animation.duration, 0) / Math.max(1, frameDeltaMs())));
    progress = applyEasing(progress, animation.easing);
    if (animation.type === 'fadeIn') node.props.opacity = 255 * progress;
    if (animation.type === 'fadeOut') node.props.opacity = 255 * (1 - progress);
    if (animation.type === 'scaleIn') { node.props.scaleX = progress; node.props.scaleY = progress; }
    if (animation.type === 'scaleOut') { node.props.scaleX = 1 - progress; node.props.scaleY = 1 - progress; }
    var distanceX = finite(node.props.width, 0);
    var distanceY = finite(node.props.height, 0);
    var baseX = finite(node.__mzuiAnimationBase && node.__mzuiAnimationBase.x, node.props.x);
    var baseY = finite(node.__mzuiAnimationBase && node.__mzuiAnimationBase.y, node.props.y);
    if (animation.type === 'slideFromLeft') node.props.x = baseX - distanceX * (1 - progress);
    if (animation.type === 'slideFromRight') node.props.x = baseX + distanceX * (1 - progress);
    if (animation.type === 'slideFromTop') node.props.y = baseY - distanceY * (1 - progress);
    if (animation.type === 'slideFromBottom') node.props.y = baseY + distanceY * (1 - progress);
    node.__mzuiAnimationActive = progress < 1;
    return node.__mzuiAnimationActive;
  }

  // Interactive containers (button windows, event containers) have no
  // containsPoint of their own, so PIXI's hit test can never reach them
  // unless an explicit hitArea covers the node rectangle. Sprites and
  // graphics hit-test through their own geometry and are left alone.
  function syncInteractiveHitArea(node, view) {
    if (!view || view.interactive !== true || typeof view.containsPoint === 'function') return;
    var PIXI = global.PIXI || {};
    if (typeof PIXI.Rectangle !== 'function') return;
    var props = node.props || {};
    var width = finite(props.width, 0);
    var height = finite(props.height, 0);
    if (width <= 0 || height <= 0) return;
    var rect = view.hitArea;
    if (!rect || typeof rect !== 'object') rect = view.hitArea = new PIXI.Rectangle(0, 0, width, height);
    rect.x = 0;
    rect.y = 0;
    rect.width = width;
    rect.height = height;
  }

  // RPG Maker's own UI consumes pointer input through TouchInput. Some MV/MZ
  // NW.js builds do not route the same DOM events through PIXI's interaction
  // emitter, so keep button activation on the engine input path as well.
  function updateTouchInputBridge(runtime) {
    var input = global.TouchInput;
    if (!runtime || !runtime.mounted || !runtime.allowsUserExecution() || !input) return;
    var triggered = typeof input.isTriggered === 'function' && input.isTriggered();
    var released = typeof input.isReleased === 'function' && input.isReleased();
    var target = runtimeButtonAtPoint(runtime, finite(input.x, 0), finite(input.y, 0));
    syncTouchInputHover(runtime, target);
    if (!triggered && !released) return;

    if (triggered) {
      runtime.touchPressedNodeId = null;
      if (!gameMessageIsBusy() && target && !target.view.__mzuiDisabled) {
        runtime.touchPressedNodeId = target.node.id;
        runtime.focusNode(target.node.id);
        target.view.__mzuiButtonState = 'pressed';
        renderButtonState(target.view, target.node.props || {});
      }
    }

    if (!released) return;
    var pressedNodeId = runtime.touchPressedNodeId;
    runtime.touchPressedNodeId = null;
    if (!pressedNodeId) return;
    var pressedNode = runtime.nodeIndex[pressedNodeId];
    var pressedView = runtime.nodeViews[pressedNodeId];
    if (pressedView) {
      pressedView.__mzuiButtonState = pressedView.__mzuiFocused || pressedView.__mzuiPointerHover ? 'hover' : 'normal';
      renderButtonState(pressedView, pressedNode && pressedNode.props || {});
    }
    if (!pressedNode || !pressedView || pressedView.__mzuiDisabled || gameMessageIsBusy()) return;
    if (!target || target.node.id !== pressedNodeId) return;
    if (Date.now() - finite(pressedView.__mzuiLastPixiPointerTapAt, 0) < 250) return;
    playButtonSe(runtime, pressedNode, pressedView.__mzuiSe && pressedView.__mzuiSe.click, 'onClick');
    runtime.dispatchActionsForNode(pressedNode, 'onClick', { type: 'pointertap', source: 'TouchInput' });
  }

  function syncTouchInputHover(runtime, target) {
    var next = target && !target.view.__mzuiDisabled ? target : null;
    var previousId = runtime.touchHoveredNodeId;
    var nextId = next && next.node.id;
    if (previousId === nextId) return;
    runtime.touchHoveredNodeId = nextId || null;
    if (previousId) {
      var previousNode = runtime.nodeIndex[previousId];
      var previousView = runtime.nodeViews[previousId];
      if (previousNode && previousView) setButtonPointerHover(runtime, previousNode, previousView, false, 'TouchInput');
    }
    if (next) setButtonPointerHover(runtime, next.node, next.view, true, 'TouchInput');
  }

  function setButtonPointerHover(runtime, node, view, hovered, source) {
    if (!node || !view || node.type !== 'button') return false;
    var nextHovered = Boolean(hovered && !view.__mzuiDisabled);
    if (Boolean(view.__mzuiPointerHover) === nextHovered) return false;
    view.__mzuiPointerHover = nextHovered;
    if (view.__mzuiButtonState !== 'pressed') view.__mzuiButtonState = nextHovered || view.__mzuiFocused ? 'hover' : 'normal';
    renderButtonState(view, node.props || {});
    if (nextHovered) {
      playButtonSe(runtime, node, view.__mzuiSe && view.__mzuiSe.hover, 'onHoverEnter');
      runtime.dispatchActionsForNode(node, 'onHoverEnter', { type: 'pointerover', source: source });
    } else {
      runtime.dispatchActionsForNode(node, 'onHoverLeave', { type: 'pointerout', source: source });
    }
    return true;
  }

  function runtimeButtonAtPoint(runtime, x, y) {
    var interaction = global.Graphics && global.Graphics.app && global.Graphics.app.renderer && global.Graphics.app.renderer.plugins && global.Graphics.app.renderer.plugins.interaction;
    var PIXI = global.PIXI || {};
    var hitRoot = runtime.hostRoot || runtime.displayRoot;
    if (!interaction || typeof interaction.hitTest !== 'function' || typeof PIXI.Point !== 'function' || !hitRoot) return null;
    var view = interaction.hitTest(new PIXI.Point(x, y), hitRoot);
    while (view && !view.__mzuiNode) view = view.parent;
    var node = view && view.__mzuiNode;
    if (!node || node.type !== 'button' || !runtime.nodeViews[node.id] || effectiveViewVisibility(view) === false) return null;
    return { node: node, view: view };
  }

  function gameMessageIsBusy() {
    return Boolean(global.$gameMessage && typeof global.$gameMessage.isBusy === 'function' && global.$gameMessage.isBusy());
  }

  function bindNodeEvents(runtime, node, view) {
    if (!view || typeof view.on !== 'function') return;
    if (node.type === 'button') {
      var visualEvents = {
        pointerover: function () { setButtonPointerHover(runtime, node, view, true, 'PIXI'); },
        pointerout: function () { setButtonPointerHover(runtime, node, view, false, 'PIXI'); },
        pointerdown: function () { if (!view.__mzuiDisabled) { runtime.focusNode(node.id); view.__mzuiButtonState = 'pressed'; renderButtonState(view, node.props || {}); } },
        pointerup: function () { view.__mzuiButtonState = view.__mzuiFocused || view.__mzuiPointerHover ? 'hover' : 'normal'; renderButtonState(view, node.props || {}); },
        pointerupoutside: function () { view.__mzuiButtonState = view.__mzuiFocused ? 'hover' : 'normal'; renderButtonState(view, node.props || {}); },
        pointertap: function () { if (!view.__mzuiDisabled) { view.__mzuiLastPixiPointerTapAt = Date.now(); playButtonSe(runtime, node, view.__mzuiSe && view.__mzuiSe.click, 'onClick'); view.__mzuiButtonState = view.__mzuiFocused || view.__mzuiPointerHover ? 'hover' : 'normal'; renderButtonState(view, node.props || {}); } },
      };
      Object.keys(visualEvents).forEach(function (eventName) {
        view.interactive = true;
        view.on(eventName, visualEvents[eventName]);
        runtime.listeners.push(function () { if (typeof view.off === 'function') view.off(eventName, visualEvents[eventName]); });
      });
    }
    if (!node.events) { syncInteractiveHitArea(node, view); return; }
    var eventMap = { onClick: 'pointertap', onHoverEnter: 'pointerover', onHoverLeave: 'pointerout', onFocus: 'focus', onBlur: 'blur' };
    Object.keys(eventMap).forEach(function (name) {
      if (node.type === 'button' && (name === 'onHoverEnter' || name === 'onHoverLeave')) return;
      var handler = node.events[name];
      if (!handler || !Array.isArray(handler.actions)) return;
      var listener = function listener(event) {
        if (node.type === 'button' && view.__mzuiDisabled) return;
        if (node.type === 'button') {
          if (name === 'onFocus') view.__mzuiFocused = true;
          if (name === 'onBlur') view.__mzuiFocused = false;
          if (name === 'onFocus' || name === 'onBlur') renderButtonState(view, node.props || {});
        }
        runtime.dispatchActionsForNode(node, name, event);
      };
      view.interactive = true;
      view.on(eventMap[name], listener);
      runtime.listeners.push(function () { if (typeof view.off === 'function') view.off(eventMap[name], listener); });
    });
    syncInteractiveHitArea(node, view);
  }

  function installKeyboardFocusManager(runtime) {
    if (typeof document === 'undefined' || !document || typeof document.addEventListener !== 'function') return;
    var pressedNodeId = null;
    var focusableButtons = function focusableButtons() {
      return (runtime.scene && Array.isArray(runtime.scene.nodes) ? runtime.scene.nodes : []).filter(function (node) {
        var view = node && runtime.nodeViews[node.id];
        return node && node.type === 'button' && view && !view.__mzuiDisabled && effectiveViewVisibility(view);
      }).map(function (node, index) {
        var view = runtime.nodeViews[node.id];
        var bounds = worldAabbForView(view, node);
        return { node: node, index: index, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }).sort(function (left, right) {
        return left.y - right.y || left.x - right.x || left.index - right.index;
      }).map(function (entry) { return entry.node; });
    };
    var keydown = function keydown(event) {
      if (!runtime.mounted || !event) return;
      var buttons = focusableButtons();
      if (!buttons.length) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        var index = buttons.findIndex(function (node) { return node.id === runtime.focusedNodeId; });
        var step = event.key === 'ArrowUp' ? -1 : 1;
        var next = buttons[index < 0 ? (step < 0 ? buttons.length - 1 : 0) : (index + step + buttons.length) % buttons.length];
        runtime.focusNode(next.id);
      } else if ((event.key === 'Enter' || event.key === ' ') && runtime.focusedNodeId) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (event.repeat || pressedNodeId) return;
        var focused = findNode(runtime.scene, runtime.focusedNodeId);
        var view = focused && runtime.nodeViews[focused.id];
        if (focused && view && !view.__mzuiDisabled && effectiveViewVisibility(view)) {
          pressedNodeId = focused.id;
          view.__mzuiButtonState = 'pressed';
          renderButtonState(view, focused.props || {});
          playButtonSe(runtime, focused, view.__mzuiSe && view.__mzuiSe.click, 'onClick');
          runtime.dispatchActionsForNode(focused, 'onClick', { type: 'click', keyboard: true });
        }
      }
    };
    var keyup = function keyup(event) {
      if (!event || (event.key !== 'Enter' && event.key !== ' ') || !pressedNodeId) return;
      var node = findNode(runtime.scene, pressedNodeId);
      var view = node && runtime.nodeViews[pressedNodeId];
      pressedNodeId = null;
      if (!node || !view) return;
      view.__mzuiButtonState = view.__mzuiFocused || view.__mzuiPointerHover ? 'hover' : 'normal';
      renderButtonState(view, node.props || {});
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    runtime.listeners.push(function () {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
    });
  }

  function playButtonSe(runtime, node, value, eventName) {
    if (!value || !global.AudioManager || typeof global.AudioManager.playSe !== 'function') return;
    try {
      var name = buttonSeName(value);
      global.AudioManager.playSe({ name: name, volume: 90, pitch: 100, pan: 0 });
    } catch (error) {
      runtime.reportError(error, 'button-se', { node: node && node.id, type: 'button', phase: 'interaction', event: eventName });
    }
  }

  function buttonSeName(value) {
    var normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized) throw new Error('Button sound resource is empty.');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\.\.\/)/i.test(normalized) || normalized.indexOf('/../') >= 0) {
      throw new Error('Button sound resource must remain project-relative.');
    }
    normalized = normalized.replace(/^www\//i, '');
    if (/^audio\//i.test(normalized)) {
      if (!/^audio\/se\//i.test(normalized) || !/\.(?:ogg|m4a)$/i.test(normalized)) {
        throw new Error('Button sound resource must be an OGG or M4A file below audio/se/.');
      }
      normalized = normalized.slice('audio/se/'.length).replace(/\.(?:ogg|m4a)$/i, '');
    } else if (/\.[a-z0-9]+$/i.test(normalized)) {
      throw new Error('Button sound resource path is not an RPG Maker SE resource.');
    }
    if (!normalized) throw new Error('Button sound resource must include an SE name.');
    return normalized;
  }

  function findNode(scene, id) {
    return scene && Array.isArray(scene.nodes) ? scene.nodes.find(function (node) { return node && node.id === id; }) : null;
  }

  function orderedNodes(scene) {
    var list = scene && Array.isArray(scene.nodes) ? scene.nodes : [];
    var byId = {};
    list.forEach(function (node) { if (node && node.id) byId[node.id] = node; });
    var result = [];
    var visited = {};
    function visit(node) {
      if (!node || visited[node.id]) return;
      visited[node.id] = true;
      result.push(node);
      (Array.isArray(node.children) ? node.children : []).forEach(function (childId) { visit(byId[childId]); });
    }
    (Array.isArray(scene && scene.zOrder) ? scene.zOrder : []).forEach(function (id) { visit(byId[id]); });
    list.filter(function (node) { return node && node.parentId === null; }).forEach(visit);
    list.forEach(visit);
    return result;
  }

  function affectedBoundsNodeIds(runtime, changedNodeIds) {
    var affected = [];
    var seen = {};
    var pending = Array.isArray(changedNodeIds) ? changedNodeIds.slice() : [];
    while (pending.length) {
      var nodeId = pending.shift();
      if (typeof nodeId !== 'string' || seen[nodeId]) continue;
      seen[nodeId] = true;
      var node = runtime && runtime.nodeIndex ? runtime.nodeIndex[nodeId] : null;
      if (!node) continue;
      affected.push(nodeId);
      if (Array.isArray(node.children)) node.children.forEach(function (childId) { pending.push(childId); });
    }
    return affected;
  }

  function effectiveViewVisibility(view) {
    var current = view;
    var guard = 0;
    while (current && guard++ < 256) {
      if (current.visible === false || current.renderable === false) return false;
      current = current.parent;
    }
    return true;
  }

  function finiteBoundsRectangle(value) {
    if (!value) return null;
    var x = Number(value.x);
    var y = Number(value.y);
    var width = Number(value.width);
    var height = Number(value.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width < 0) { x += width; width = Math.abs(width); }
    if (height < 0) { y += height; height = Math.abs(height); }
    return { x: x, y: y, width: width, height: height };
  }

  function transformLogicalNodeAabb(view, node) {
    var transform = view && view.worldTransform;
    if (!transform) return null;
    var matrix = {
      a: Number(transform.a), b: Number(transform.b), c: Number(transform.c),
      d: Number(transform.d), tx: Number(transform.tx), ty: Number(transform.ty),
    };
    if (!Number.isFinite(matrix.a) || !Number.isFinite(matrix.b) || !Number.isFinite(matrix.c) || !Number.isFinite(matrix.d) || !Number.isFinite(matrix.tx) || !Number.isFinite(matrix.ty)) return null;
    var dimensions = view.__mzuiDimensions || {};
    var props = node && node.props ? node.props : {};
    var width = Math.max(0, finite(dimensions.width, finite(props.width, 0)));
    var height = Math.max(0, finite(dimensions.height, finite(props.height, 0)));
    var viewScaleX = Math.abs(finite(view.__mzuiWorldScaleX, finite(view.scale && view.scale.x, 1)));
    var viewScaleY = Math.abs(finite(view.__mzuiWorldScaleY, finite(view.scale && view.scale.y, 1)));
    var requestedScaleX = Math.abs(finite(dimensions.scaleX, finite(props.scaleX, 1)));
    var requestedScaleY = Math.abs(finite(dimensions.scaleY, finite(props.scaleY, 1)));
    var localWidth = viewScaleX > 0 && requestedScaleX > 0 ? width * requestedScaleX / viewScaleX : width;
    var localHeight = viewScaleY > 0 && requestedScaleY > 0 ? height * requestedScaleY / viewScaleY : height;
    var anchorX = view.anchor && Number.isFinite(Number(view.anchor.x)) ? Number(view.anchor.x) : 0;
    var anchorY = view.anchor && Number.isFinite(Number(view.anchor.y)) ? Number(view.anchor.y) : 0;
    var left = -localWidth * anchorX;
    var top = -localHeight * anchorY;
    var right = left + localWidth;
    var bottom = top + localHeight;
    var points = [
      [left, top], [right, top], [right, bottom], [left, bottom],
    ].map(function (point) {
      return {
        x: matrix.a * point[0] + matrix.c * point[1] + matrix.tx,
        y: matrix.b * point[0] + matrix.d * point[1] + matrix.ty,
      };
    });
    var xs = points.map(function (point) { return point.x; });
    var ys = points.map(function (point) { return point.y; });
    var minX = Math.min.apply(Math, xs);
    var maxX = Math.max.apply(Math, xs);
    var minY = Math.min.apply(Math, ys);
    var maxY = Math.max.apply(Math, ys);
    return finiteBoundsRectangle({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }

  function worldAabbForView(view, node) {
    var pixiBounds = null;
    if (view && typeof view.getBounds === 'function') {
      try { pixiBounds = finiteBoundsRectangle(view.getBounds(false)); } catch (_) { pixiBounds = null; }
    }
    var transformed = transformLogicalNodeAabb(view, node);
    if (node && node.type === 'container' && transformed) return transformed;
    if (transformed) {
      var expectedWidth = Math.abs(finite(node && node.props && node.props.width, 0) * finite(node && node.props && node.props.scaleX, 1));
      var expectedHeight = Math.abs(finite(node && node.props && node.props.height, 0) * finite(node && node.props && node.props.scaleY, 1));
      // Empty PIXI containers have an empty getBounds() even when the UI
      // contract gives them a logical editing rectangle. Their worldTransform
      // is still the canonical source for that rectangle.
      if (!pixiBounds || (pixiBounds.width === 0 && expectedWidth > 0) || (pixiBounds.height === 0 && expectedHeight > 0)) return transformed;
    }
    if (pixiBounds) return pixiBounds;
    if (transformed) return transformed;
    throw new Error('The MV/MZ PIXI view does not expose usable world-space bounds for node: ' + String(node && node.id || '<unknown>'));
  }

  function readFile(relativePath) {
    try {
      if (typeof require !== 'function') return null;
      var fs = require('fs');
      var path = require('path');
      return fs.readFileSync(path.join(resolveEngineRoot(), relativePath), 'utf8');
    } catch (error) {
      reportApiError({ label: 'scene-directory', message: 'Node fs is unavailable; UI scene directory cannot be scanned: ' + errorText(error) });
      return null;
    }
  }

  function listSceneFiles(relativeDirectory) {
    try {
      if (typeof require !== 'function') throw new Error('Node fs is unavailable; UI scene directory cannot be scanned.');
      var fs = require('fs');
      var path = require('path');
      if (typeof process === 'undefined' || typeof process.cwd !== 'function') throw new Error('Node process is unavailable; UI scene directory cannot be scanned.');
      var directory = path.join(resolveEngineRoot(), relativeDirectory || SCENE_DIRECTORY_DEFAULT);
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
      return fs.readdirSync(directory).filter(function (name) {
        var lower = String(name).toLowerCase();
        return lower.endsWith('.json') && lower !== 'manifest.json' && lower !== '.ui-designer-preview.json';
      }).sort();
    } catch (error) {
      reportApiError({ label: 'scene-directory', message: errorText(error) });
      return [];
    }
  }

  function resolveEngineRoot() {
    if (typeof process === 'undefined' || typeof process.cwd !== 'function' || typeof require !== 'function') throw new Error('Node process/fs is unavailable; RPG Maker runtime integration is unsupported.');
    var fs = require('fs');
    var path = require('path');
    var documentRoot = resolveDocumentEngineRoot(fs, path);
    if (documentRoot) return documentRoot;
    var cwd = process.cwd();
    var cwdRoot = validatedEngineRoot(fs, path, cwd);
    if (cwdRoot) return cwdRoot;
    throw new Error('RPG Maker engine root is not configured: expected js/plugins or www/js/plugins under the game directory.');
  }

  function resolveDocumentEngineRoot(fs, path) {
    var location = global.document && global.document.location ? global.document.location : global.location;
    if (!location) return null;
    try {
      if (location.protocol && location.protocol !== 'file:') throw new Error('RPG Maker app document must use the file protocol.');
      var pathname = String(location.pathname || '');
      if (!pathname) throw new Error('RPG Maker app document path is unavailable.');
      var decoded = decodeURIComponent(pathname);
      if (/^\/[A-Za-z]:\//.test(decoded)) decoded = decoded.slice(1);
      decoded = decoded.replace(/\//g, path.sep);
      var candidate = path.dirname(path.resolve(decoded));
      var documentRoot = validatedEngineRoot(fs, path, candidate);
      if (!documentRoot) throw new Error('RPG Maker app document root is invalid.');
      return documentRoot;
    } catch (error) {
      throw new Error('RPG Maker app document root is invalid: ' + errorText(error));
    }
  }

  function validatedEngineRoot(fs, path, candidate) {
    try {
      var resolved = fs.realpathSync(path.resolve(candidate));
      if (fs.existsSync(path.join(resolved, 'js', 'plugins')) && fs.existsSync(path.join(resolved, 'data'))) return resolved;
      var deployed = fs.realpathSync(path.join(resolved, 'www'));
      if (fs.existsSync(path.join(deployed, 'js', 'plugins')) && fs.existsSync(path.join(deployed, 'data'))) return deployed;
    } catch (_) {}
    return null;
  }

  function registerScene(sceneName, sceneBase, scene) {
    if (registeredScenes[sceneName]) throw new Error('UI scene is already registered: ' + sceneName);
    var existingScene = global[sceneName];
    var replacesBuiltinScene = Boolean(BUILTIN_SCENE_NAMES[sceneName] && typeof existingScene === 'function');
    if (typeof existingScene === 'function' && !replacesBuiltinScene) throw new Error('UI scene name is already owned by another runtime: ' + sceneName);
    var baseName = sceneBase || 'Scene_Base';
    var Base = replacesBuiltinScene && baseName === sceneName ? existingScene : global[baseName];
    if (typeof Base !== 'function') throw new Error('UI scene base is unavailable: ' + String(sceneBase));
    var UiDesignerScene = class extends Base {
      constructor() { super(...arguments); this._mzuiRuntime = null; this._mzuiRuntimeRoot = null; }
      create() {
        if (Base.prototype.create) Base.prototype.create.call(this);
        this._mzuiRuntime = api.create();
        this._mzuiRuntime.mount(scene, { root: this, context: { sceneApi: this }, sceneApi: this });
        this._mzuiRuntimeRoot = this._mzuiRuntime.displayRoot;
      }
      update() { if (Base.prototype.update) Base.prototype.update.call(this); if (this._mzuiRuntime) this._mzuiRuntime.update(); }
      stop() {
        if (Base.prototype.stop) Base.prototype.stop.call(this);
        if (this._mzuiRuntime) this._mzuiRuntime.startExit();
      }
      isBusy() {
        var baseBusy = Base.prototype.isBusy ? Base.prototype.isBusy.call(this) : false;
        return Boolean(baseBusy || this._mzuiRuntime && this._mzuiRuntime.sceneTransition);
      }
      terminate() {
        if (this._mzuiRuntime) this._mzuiRuntime.cleanup();
        this._mzuiRuntime = null;
        this._mzuiRuntimeRoot = null;
        if (Base.prototype.terminate) Base.prototype.terminate.call(this);
      }
    };
    global[sceneName] = UiDesignerScene;
    registeredScenes[sceneName] = UiDesignerScene;
    return UiDesignerScene;
  }

  var registeredScenes = {};
  var api = {
    VERSION: VERSION,
    version: VERSION,
    create: makeRuntime,
    registerScene: registerScene,
    isRegistered: function isRegistered(sceneName) { return Boolean(registeredScenes[sceneName]); },
    resolveEngineRoot: resolveEngineRoot,
    errors: [],
    onError: null,
    contextProvider: null,
    parseTextRuns: function parseTextRunsApi(value, context) { return parseTextRuns(value, context || {}); },
    sceneDirectory: SCENE_DIRECTORY_DEFAULT,
    scanScenes: function scanScenes(relativeDirectory) {
      var directory = relativeDirectory || this.sceneDirectory;
      var files = listSceneFiles(directory);
      files.forEach(function (fileName) {
        if (!/^Scene_[A-Za-z0-9_$]+\.json$/.test(fileName)) {
          reportApiError({ file: fileName, label: 'scene-directory', message: 'UI scene directory contains a non-scene JSON file; expected a Scene_*.json filename.' });
          return;
        }
        var sceneName = fileName.slice(0, -'.json'.length);
        var raw = readFile(directory.replace(/\\/g, '/') + '/' + fileName);
        if (!raw) return;
        try {
          var scene = canonicalizeRuntimeScene(JSON.parse(raw));
          if (!scene || scene.version !== VERSION || scene.runtimeVersion !== '>=1.1.0' || !scene.meta || scene.meta.sceneName !== sceneName) throw new Error('UI scene file metadata does not match its stable filename.');
          if (!scene.sceneScript || scene.sceneScript.version !== '1.1.0' || typeof scene.sceneScript.source !== 'string') throw new Error('UI scene file requires a supported one-file sceneScript.');
          registerScene(sceneName, scene.meta.sceneBase, scene);
        } catch (error) { reportApiError({ scene: sceneName, file: fileName, label: 'scene', message: errorText(error) }); }
      });
      return this;
    },
    configure: function configure(options) {
      if (options && options.sceneDirectory) this.sceneDirectory = String(options.sceneDirectory);
      if (options && Object.prototype.hasOwnProperty.call(options, 'onError')) {
        if (options.onError !== null && typeof options.onError !== 'function') throw new TypeError('UI Runtime onError must be a function or null.');
        this.onError = options.onError;
      }
      if (options && Object.prototype.hasOwnProperty.call(options, 'contextProvider')) {
        if (options.contextProvider !== null && typeof options.contextProvider !== 'function') throw new TypeError('UI Runtime contextProvider must be a function or null.');
        this.contextProvider = options.contextProvider;
      }
      return this;
    },
  };

  var apiErrorKeys = {};
  function reportApiError(entry) {
    var normalized = {
      scene: entry && entry.scene ? entry.scene : null,
      file: entry && entry.file ? entry.file : null,
      node: entry && entry.node ? entry.node : null,
      type: entry && entry.type ? entry.type : null,
      phase: entry && entry.phase ? entry.phase : null,
      event: entry && entry.event ? entry.event : null,
      code: entry && entry.code ? entry.code : 'UI_RUNTIME_HANDLER_ERROR',
      severity: entry && entry.severity === 'warning' ? 'warning' : 'error',
      label: entry && entry.label ? entry.label : 'runtime',
      message: entry && entry.message ? entry.message : 'Unknown runtime error',
      count: entry && Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1,
    };
    var key = [normalized.scene, normalized.file, normalized.node, normalized.type, normalized.phase, normalized.event, normalized.code, normalized.severity, normalized.label, normalized.message].join('|');
    if (apiErrorKeys[key]) return;
    apiErrorKeys[key] = true;
    api.errors.push(normalized);
    if (typeof console !== 'undefined' && console && typeof console.error === 'function') console.error('[MZUIRuntime]', normalized.message);
    if (typeof api.onError === 'function') api.onError(normalized);
  }

  global.MZUIRuntime = api;
  var pluginParameters = global.PluginManager && typeof global.PluginManager.parameters === 'function' ? global.PluginManager.parameters('MZUIRuntime') || {} : {};
  api.configure({ sceneDirectory: pluginParameters.SceneDirectory || SCENE_DIRECTORY_DEFAULT });
  if (String(pluginParameters.AutoRegister || 'true').toLowerCase() !== 'false') {
    api.scanScenes();
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
