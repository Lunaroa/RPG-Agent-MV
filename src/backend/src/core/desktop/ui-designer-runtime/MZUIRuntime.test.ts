import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { migrateLegacyUiSourceCode } from '../../../../../contract/ui-designer-script.ts';

const RUNTIME_SOURCE = fs.readFileSync(new URL('./MZUIRuntime.js', import.meta.url), 'utf8');
const nodeRequire = createRequire(import.meta.url);

describe('MZUIRuntime MV/MZ bridge', () => {
  test('evaluates against PIXI/Scene stubs, preserves nested world coordinates, and cleans up', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const root = new context.PIXI.Container();
    const scene = sceneDocument();
    runtime.mount(scene, { root });

    assert.equal(runtime.compiled.actions['root:onClick:0'] !== undefined, true);
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].children[0].x, 100);
    assert.equal(root.children[0].children[0].children[0].x, 50);
    assert.equal(scene.nodes[1].props.opacity, 128);

    runtime.update();
    assert.equal(root.children[0].children[0].children[0].visible, true);
    for (let frame = 0; frame < 8; frame += 1) runtime.update();
    assert.equal(root.children[0].children[0].children[0].visible, false);
    runtime.cleanup();
    assert.equal(root.children.length, 0);
    assert.equal(runtime.mounted, false);
  });

  test('paints the last tree sibling on top by attaching views in tree order', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-order.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    const second = JSON.parse(JSON.stringify(scene.nodes[0]));
    second.id = 'second';
    second.name = 'Second';
    second.children = [];
    second.events = {};
    scene.nodes.push(second);
    scene.zOrder = ['root', 'second'];
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const displayRoot = runtime.nodeViews.root.parent;
    assert.equal(displayRoot.children[0], runtime.nodeViews.root);
    assert.equal(displayRoot.children[1], runtime.nodeViews.second);
    runtime.cleanup();
  });

  test('binds SceneManager push, replaces built-in scenes, and protects plugin-owned scene names', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    runtime.mount(sceneDocument(), { root: new context.PIXI.Container() });
    runtime.runAction({ type: 'gotoScene', sceneName: 'Scene_Custom' }, sceneDocument().nodes[0], { type: 'pointertap' });
    assert.equal(context.SceneManager.pushed, context.Scene_Custom);
    const originalTitle = context.Scene_Title;
    const titleScene = sceneDocument();
    titleScene.meta.sceneName = 'Scene_Title';
    const replacementTitle = context.MZUIRuntime.registerScene('Scene_Title', 'Scene_Base', titleScene);
    assert.equal(context.Scene_Title, replacementTitle);
    assert.notEqual(context.Scene_Title, originalTitle);
    assert.throws(() => context.MZUIRuntime.registerScene('Scene_Custom', 'Scene_Base', sceneDocument()), /already owned/);
  });

  test('scans deterministic scene files from MV www and MZ roots', () => {
    for (const layout of ['mv-www', 'mz-root']) {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-scan-'));
      try {
        const engineRoot = layout === 'mv-www' ? path.join(project, 'www') : project;
        fs.mkdirSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data'), { recursive: true });
        fs.mkdirSync(path.join(engineRoot, 'data'), { recursive: true });
        for (const sceneName of ['Scene_Beta', 'Scene_Alpha', 'Scene_Title']) {
          fs.writeFileSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data', `${sceneName}.json`), JSON.stringify({
            version: '1.1.0', runtimeVersion: '>=1.1.0',
            meta: { sceneName, sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 },
            transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
            globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: sceneScript(),
          }), 'utf8');
        }
        fs.writeFileSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data', 'Scene_Bad.json'), '{', 'utf8');
        fs.writeFileSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data', 'Scene_InvalidScript.json'), JSON.stringify({
          version: '1.1.0', runtimeVersion: '>=1.1.0',
          meta: { sceneName: 'Scene_InvalidScript', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 },
          transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
          globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '2.0.0', source: '' },
        }), 'utf8');
        fs.writeFileSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data', 'notes.json'), '{}', 'utf8');
        const context = makeContext();
        const originalTitle = context.Scene_Title;
        context.PluginManager.parameters = () => ({ AutoRegister: 'true' });
        context.process = { cwd: () => project };
        context.require = nodeRequire;
        vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-${layout}.js` });
        assert.equal(typeof context.Scene_Alpha, 'function');
        assert.equal(typeof context.Scene_Beta, 'function');
        assert.equal(context.MZUIRuntime.isRegistered('Scene_Title'), true);
        assert.notEqual(context.Scene_Title, originalTitle);
        assert.equal(context.MZUIRuntime.errors.some((entry: { scene?: string }) => entry.scene === 'Scene_Bad'), true);
        assert.equal(context.MZUIRuntime.errors.some((entry: { scene?: string }) => entry.scene === 'Scene_InvalidScript'), true);
        assert.equal(context.MZUIRuntime.errors.some((entry: { file?: string }) => entry.file === 'notes.json'), true);
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
      }
    }
  });

  test('creates all ten contract node types with isolated node diagnostics', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const root = new context.PIXI.Container();
    const scene = allNodeScene();
    runtime.mount(scene, { root });
    for (const node of scene.nodes) assert.ok(runtime.nodeViews[node.id], `missing ${node.type}`);
    assert.equal(runtime.errors.length, 0);
    assert.ok(runtime.nodeViews.container.__mzuiBackground);
    assert.equal(runtime.nodeViews.button.__mzuiButtonStates.normal, '');
    assert.equal(runtime.nodeViews.button.__mzuiButtonChrome.visible, true);
    assert.equal(runtime.nodeViews.button.opacity, 255);
    assert.equal(runtime.nodeViews.text.style.fontSize, 24);
    assert.equal(runtime.nodeViews.text.style.fontFamily, 'sans-serif');
    assert.equal(runtime.nodeViews.text.style.stroke, 'rgba(0, 0, 0, 0.5)');
    assert.equal(runtime.nodeViews.text.style.strokeThickness, 3);
    assert.equal(runtime.nodeViews.nineSlice.zIndex, 3);
    runtime.update();
    assert.equal(runtime.nodeViews.progressBar.__mzuiAnimatedRatio, 0.5);
    assert.ok(runtime.nodeViews.video.__mzuiVideo);
    runtime.cleanup();
    assert.equal(root.children.length, 0);
  });

  test('applies visual props for fills, masks, button states, text chrome, progress images, and particle shapes', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const sprite = scene.nodes.find((node: any) => node.type === 'sprite');
    const container = scene.nodes.find((node: any) => node.type === 'container');
    const button = scene.nodes.find((node: any) => node.type === 'button');
    const text = scene.nodes.find((node: any) => node.type === 'text');
    const progress = scene.nodes.find((node: any) => node.type === 'progressBar');
    const particle = scene.nodes.find((node: any) => node.type === 'particle');
    sprite.props.fillMode = 'contain';
    container.props.clip = true;
    button.props.imageStates = { normal: 'img/normal.png', hover: 'img/hover.png', pressed: 'img/pressed.png', disabled: 'img/disabled.png' };
    button.props.backgroundColor = '#102030';
    button.props.borderColor = '#ffffff';
    button.props.borderWidth = 2;
    text.props.backgroundColor = '#00000080';
    text.props.fontFile = 'GameFont';
    progress.props.trackImage = 'img/track.png';
    progress.props.fillImage = 'img/fill.png';
    particle.props.imagePath = '';
    particle.props.shape = 'circle';
    particle.props.emissionInterval = 1;
    const root = new context.PIXI.Container();
    runtime.mount(scene, { root });
    runtime.update();
    assert.equal(runtime.nodeViews.container.mask.renderable, false);
    assert.equal(runtime.nodeViews.sprite.__mzuiFillMode, 'contain');
    assert.ok(runtime.nodeViews.button.__mzuiButtonImage);
    assert.ok(runtime.nodeViews.button.__mzuiButtonChrome);
    assert.equal(runtime.nodeViews.button.__mzuiButtonChrome.visible, false);
    assert.equal(runtime.nodeViews.button.opacity, 0);
    assert.ok(runtime.nodeViews.text.__mzuiTextBackground);
    assert.ok(runtime.nodeViews.progressBar.__mzuiTrackImage);
    assert.ok(runtime.nodeViews.progressBar.__mzuiFillImage);
    assert.ok(runtime.nodeViews.particle.children.length > 0);
    runtime.cleanup();
  });

  test('evaluates button disabledCondition once per update and exposes keyboard-focus ABI', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.type === 'button');
    button.props.disabledCondition = 'context.variables.disabled === true';
    button.events = { onFocus: { actions: [] }, onBlur: { actions: [] } };
    const variables = { disabled: false };
    runtime.mount(scene, { root: new context.PIXI.Container(), context: { variables } });
    assert.equal(runtime.focusNode(button.id), true);
    assert.equal(runtime.focusedNodeId, button.id);
    variables.disabled = true;
    runtime.update();
    assert.equal(runtime.nodeViews.button.__mzuiDisabled, true);
    assert.equal(runtime.focusedNodeId, null);
    assert.equal(runtime.focusNode(button.id), false);
    runtime.cleanup();
  });

  test('materializes list templates from array data with item and index code values', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-list.js' });
    const runtime = context.MZUIRuntime.create();
    const source = allNodeScene();
    const list = JSON.parse(JSON.stringify(source.nodes.find((node: any) => node.type === 'container')));
    list.id = 'inventory';
    list.name = 'Inventory';
    list.type = 'list';
    list.children = ['inventory_label'];
    list.props = {
      x: 100, y: 80, width: 100, height: 60, scaleX: 1, scaleY: 1, rotate: 0,
      opacity: 255, visible: true, anchorX: 0, anchorY: 0, zIndex: 0,
      dataSource: '[]', columns: 2, rows: 1, autoFlow: 'row', columnGap: 20, rowGap: 0,
      justifyItems: 'start', alignItems: 'start', maxItems: 10,
    };
    list.propModes = { dataSource: 'code' };
    list.propCodes = { dataSource: '[{ text: "Potion" }, { text: "Ether" }]' };
    const label = JSON.parse(JSON.stringify(source.nodes.find((node: any) => node.type === 'text')));
    label.id = 'inventory_label';
    label.name = 'InventoryLabel';
    label.parentId = list.id;
    label.props.x = 20;
    label.props.y = 30;
    label.props.width = 100;
    label.props.height = 30;
    label.propModes = { content: 'code' };
    label.propCodes = { content: '$item.text + ":" + $index' };
    source.nodes = [list, label];
    source.zOrder = [list.id];

    runtime.mount(source, { root: new context.PIXI.Container(), executionMode: 'editor-preview' });
    runtime.update();

    assert.equal(source.nodes.length, 2, 'materialization must not mutate the editor document');
    assert.equal(runtime.scene.nodes.length, 3);
    assert.equal(runtime.nodeViews.inventory.children.length, 2);
    const first = runtime.scene.nodes.find((node: any) => node.id === 'inventory__item_0__inventory_label');
    const second = runtime.scene.nodes.find((node: any) => node.id === 'inventory__item_1__inventory_label');
    assert.equal(first.props.content, 'Potion:0');
    assert.equal(second.props.content, 'Ether:1');
    assert.deepEqual([first.props.x, first.props.y], [100, 80]);
    assert.deepEqual([second.props.x, second.props.y], [220, 80]);
    assert.equal(runtime.scene.nodes.find((node: any) => node.id === 'inventory').props.width, 220, 'list adopts the derived grid extent');
    assert.equal(runtime.nodeViews[first.id].parent, runtime.nodeViews.inventory);
    assert.equal(runtime.errors.length, 0);
    runtime.cleanup();
  });

  test('truncates list items past maxWidth instead of squeezing cells', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-list-truncate.js' });
    const runtime = context.MZUIRuntime.create();
    const source = allNodeScene();
    const list = JSON.parse(JSON.stringify(source.nodes.find((node: any) => node.type === 'container')));
    list.id = 'inventory';
    list.name = 'Inventory';
    list.type = 'list';
    list.children = ['inventory_label'];
    list.props = {
      x: 0, y: 0, width: 100, height: 40, scaleX: 1, scaleY: 1, rotate: 0,
      opacity: 255, visible: true, anchorX: 0, anchorY: 0, zIndex: 0,
      dataSource: '[]', columns: 3, rows: 0, autoFlow: 'row', columnGap: 10, rowGap: 0,
      justifyItems: 'start', alignItems: 'start', maxItems: 10,
      columnWidths: [120], maxWidth: 250, maxHeight: 0,
    };
    list.propModes = { dataSource: 'code' };
    list.propCodes = { dataSource: '[{ text: "A" }, { text: "B" }, { text: "C" }]' };
    const label = JSON.parse(JSON.stringify(source.nodes.find((node: any) => node.type === 'text')));
    label.id = 'inventory_label';
    label.name = 'InventoryLabel';
    label.parentId = list.id;
    label.propModes = { content: 'code' };
    label.propCodes = { content: '$item.text' };
    source.nodes = [list, label];
    source.zOrder = [list.id];

    runtime.mount(source, { root: new context.PIXI.Container(), executionMode: 'editor-preview' });
    runtime.update();

    const clones = runtime.scene.nodes.filter((node: any) => node.id.startsWith('inventory__item_'));
    assert.equal(clones.length, 2, 'third cell (x=240 + width 100 > maxWidth 250) is truncated');
    assert.equal(clones[0].props.x, 0);
    assert.equal(clones[1].props.x, 130, 'second column starts after the 120-wide override plus gap');
    assert.equal(runtime.scene.nodes.find((node: any) => node.id === 'inventory').props.width, 250, 'derived extent is capped by maxWidth');
    assert.equal(runtime.errors.length, 0);
    runtime.cleanup();
  });

  test('holds a button focus animation at its final state and restores its baseline on blur', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-focus-animation.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.type === 'button');
    button.focusAnim = { type: 'scaleOut', duration: 32, easing: 'Linear' };
    scene.nodes = [button];
    scene.zOrder = [button.id];
    runtime.mount(scene, { root: new context.PIXI.Container(), executionMode: 'editor-preview', deltaMs: 16 });

    assert.equal(runtime.focusNode(button.id), true);
    runtime.update();
    assert.equal(runtime.nodeViews.button.scale.x, 0.5);
    runtime.update();
    runtime.update();
    assert.equal(runtime.nodeViews.button.scale.x, 0);
    assert.equal(runtime.blurNode(button.id), true);
    assert.equal(runtime.nodeViews.button.scale.x, 1);
    assert.equal(runtime.nodeViews.button.scale.y, 1);
    runtime.cleanup();
  });

  test('navigates visible enabled buttons vertically in previews and keeps focus/press visuals unscaled', () => {
    const context = makeContext();
    const listeners = new Map<string, (event: any) => void>();
    context.document = {
      fonts: {},
      addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
      removeEventListener(name: string, listener: (event: any) => void) { if (listeners.get(name) === listener) listeners.delete(name); },
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-keyboard-preview.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const source = scene.nodes.find((node: any) => node.type === 'button');
    const makeButton = (id: string, y: number, props: Record<string, unknown> = {}) => {
      const button = JSON.parse(JSON.stringify(source));
      button.id = id;
      button.name = id;
      button.props.y = y;
      Object.assign(button.props, props);
      button.events = { onClick: { actions: [{ type: 'setSwitch', switchId: 1, switchVal: 'toggle' }] } };
      return button;
    };
    scene.nodes = [
      makeButton('bottom', 180),
      makeButton('disabled', 80, { disabled: true }),
      makeButton('top', 20),
      makeButton('hidden', 120, { visible: false }),
    ];
    scene.zOrder = scene.nodes.map((node: any) => node.id);
    runtime.mount(scene, { root: new context.PIXI.Container(), executionMode: 'editor-preview' });

    let prevented = 0;
    const key = (name: 'keydown' | 'keyup', value: string, repeat = false) => listeners.get(name)?.({ key: value, repeat, preventDefault() { prevented += 1; } });
    key('keydown', 'ArrowDown');
    assert.equal(runtime.focusedNodeId, 'top');
    assert.equal(runtime.nodeViews.top.__mzuiButtonState, 'hover');
    key('keydown', 'ArrowDown');
    assert.equal(runtime.focusedNodeId, 'bottom');
    key('keydown', 'ArrowDown');
    assert.equal(runtime.focusedNodeId, 'top');
    key('keydown', 'ArrowUp');
    assert.equal(runtime.focusedNodeId, 'bottom');

    const scaleBefore = { ...runtime.nodeViews.bottom.scale };
    key('keydown', 'Enter');
    assert.equal(runtime.nodeViews.bottom.__mzuiButtonState, 'pressed');
    assert.deepEqual(runtime.nodeViews.bottom.scale, scaleBefore);
    assert.equal(context.$gameSwitches._data[1], true);
    key('keydown', 'Enter', true);
    assert.equal(context.$gameSwitches._data[1], true);
    key('keyup', 'Enter');
    assert.equal(runtime.nodeViews.bottom.__mzuiButtonState, 'hover');
    assert.ok(prevented >= 5);

    runtime.cleanup();
    assert.equal(listeners.has('keydown'), false);
    assert.equal(listeners.has('keyup'), false);
  });

  test('bridges video nodes through an HTML video element and releases it on cleanup', () => {
    const context = makeContext();
    let paused = 0;
    let loaded = 0;
    const video = {
      src: '', autoplay: false, loop: false, muted: false, controls: false, playbackRate: 1,
      preload: '', playsInline: false, poster: '', play() { return Promise.resolve(); },
      pause() { paused += 1; }, load() { loaded += 1; },
    };
    context.document = {
      createElement: (tag: string) => tag === 'video' ? video : {},
      addEventListener() {}, removeEventListener() {}, fonts: {},
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    runtime.mount(allNodeScene(), { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.video.__mzuiVideo, video);
    assert.equal(video.autoplay, false);
    assert.equal(video.loop, true);
    runtime.cleanup();
    assert.equal(paused, 1);
    assert.equal(loaded, 1);
  });

  test('parses the safe control/rich-text subset into PIXI runs without HTML evaluation', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runs = context.MZUIRuntime.parseTextRuns('Value \\v[1]\\n<b>Bold</b> <color=#ff0000>Red</color> \\i[2]', { variables: { 1: 7 } });
    assert.equal(runs[0].text, 'Value ');
    assert.equal(runs[1].text, '7');
    assert.equal(runs.some((run: any) => run.kind === 'newline'), true);
    assert.equal(runs.some((run: any) => run.bold === true), true);
    assert.equal(runs.some((run: any) => run.color === '#ff0000'), true);
    assert.equal(runs.some((run: any) => run.kind === 'icon' && run.iconId === 2), true);
    const scene = allNodeScene();
    const text = scene.nodes.find((node: any) => node.type === 'text');
    text.props.richText = true;
    text.props.content = '<b>Safe</b> <script>ignored-as-text</script>';
    const runtime = context.MZUIRuntime.create();
    runtime.mount(scene, { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.text.__mzuiRichText, 'safe-runs');
    assert.ok(runtime.nodeViews.text.children.length > 0);
    runtime.cleanup();
  });

  test('isolates a node constructor failure and continues mounting sibling nodes', () => {
    const context = makeContext();
    class ThrowingSprite extends context.Sprite {
      constructor(bitmap?: unknown) {
        if (bitmap && (bitmap as any).throwNode) throw new Error('bitmap constructor failed');
        super(bitmap);
      }
    }
    context.Sprite = ThrowingSprite;
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => name === 'a' ? { throwNode: true } : {} };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    runtime.mount(scene, { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.sprite, undefined);
    assert.ok(runtime.nodeViews.text);
    assert.equal(runtime.errors.some((entry: any) => entry.node === 'sprite' && entry.type === 'sprite'), true);
    runtime.cleanup();
  });

  test('selects the engine-specific Window_Base constructor signature', () => {
    for (const engine of ['MV', 'MZ']) {
      const context = makeContext();
      const calls: unknown[] = [];
      class EngineWindow extends context.PIXI.Container {
        contents = { clear() {} };
        constructor(...args: unknown[]) { super(); calls.push(args); }
        drawText() {}
      }
      context.Window_Base = EngineWindow;
      context.Utils = { RPGMAKER_NAME: engine };
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-${engine}.js` });
      const runtime = context.MZUIRuntime.create();
      runtime.mount(allNodeScene(), { root: new context.PIXI.Container() });
      const args = calls[0] as unknown[];
      assert.equal(args.length, engine === 'MV' ? 4 : 1);
      assert.equal(engine === 'MV' ? args[0] : (args[0] as any).width, engine === 'MV' ? 0 : 100);
      runtime.cleanup();
    }
  });

  test('passes persisted PNG paths to the official MV and MZ ImageManager without duplicating extensions', () => {
    for (const engine of ['MV', 'MZ']) {
      const context = makeContext();
      const calls: Array<{ folder: string; name: string }> = [];
      context.Utils = { RPGMAKER_NAME: engine };
      context.ImageManager = {
        loadBitmap(folder: string, name: string) {
          calls.push({ folder, name });
          return { width: 32, height: 32, resolvedPath: `${folder}${encodeURIComponent(name)}.png` };
        },
      };
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-${engine}.js` });
      const runtime = context.MZUIRuntime.create();
      const scene = allNodeScene();
      scene.nodes.find((node: { type: string }) => node.type === 'sprite').props.path = 'img/parallaxes/BlueSky.png';
      runtime.mount(scene, { root: new context.PIXI.Container() });
      assert.equal(calls.some((call) => call.folder === 'img/parallaxes/' && call.name === 'BlueSky'), true);
      assert.equal(calls.some((call) => call.folder === 'img/' && call.name === 'panel'), true);
      assert.equal(calls.some((call) => /\.png$/i.test(call.name)), false);
      assert.equal(calls.some((call) => `${call.folder}${encodeURIComponent(call.name)}.png`.endsWith('.png.png')), false);
      runtime.cleanup();
    }
  });

  test('keeps a loaded MV parallax texture at the designer size after the bitmap becomes ready', () => {
    const context = makeContext();
    const listeners: Array<() => void> = [];
    const bitmap = {
      width: 0,
      height: 0,
      _baseTexture: { width: 0, height: 0, realWidth: 0, realHeight: 0 },
      addLoadListener(listener: () => void) { listeners.push(listener); },
    };
    context.Utils = { RPGMAKER_NAME: 'MV' };
    context.ImageManager = { loadBitmap: () => bitmap };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-MV-parallax.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'sprite');
    scene.zOrder = ['sprite'];
    const spriteNode = scene.nodes[0];
    spriteNode.props.path = 'img/parallaxes/sample.png';
    spriteNode.props.width = 816;
    spriteNode.props.height = 816;
    spriteNode.props.scaleX = 0.7647;
    spriteNode.props.scaleY = 0.7647;
    spriteNode.props.x = 480;
    spriteNode.props.y = 80;
    spriteNode.props.anchorX = 0.5;
    spriteNode.props.anchorY = 0.5;
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const view = runtime.nodeViews.sprite;
    bitmap.width = 816;
    bitmap.height = 816;
    bitmap._baseTexture.width = 816;
    bitmap._baseTexture.height = 816;
    bitmap._baseTexture.realWidth = 816;
    bitmap._baseTexture.realHeight = 816;
    listeners.forEach((listener) => listener());
    assert.equal(view.scale.x, 0.7647);
    assert.equal(view.scale.y, 0.7647);
    assert.equal(view.x, 480);
    assert.equal(view.y, 80);
    assert.equal(view.anchor.x, 0.5);
    assert.equal(view.anchor.y, 0.5);
    assert.equal(view.__mzuiDimensions.width, 816);
    assert.equal(view.__mzuiDimensions.height, 816);
    assert.equal(view.__mzuiDimensions.scaleX, 0.7647);
    assert.equal(view.__mzuiDimensions.scaleY, 0.7647);
    runtime.cleanup();
  });

  test('preserves the official Bitmap image listener until sprite texture geometry is ready', () => {
    const context = makeContext();
    const listeners: Array<() => void> = [];
    const engineImageLoad = () => {};
    const image = { width: 0, height: 0, onload: engineImageLoad };
    const bitmap: any = {
      _image: image,
      _baseTexture: null,
      get width() { return image.width; },
      get height() { return image.height; },
      addLoadListener(listener: () => void) { listeners.push(listener); },
    };
    let textureFromCalls = 0;
    class Texture {
      static EMPTY = { empty: true };
      baseTexture: unknown;
      constructor(baseTexture: unknown) { this.baseTexture = baseTexture; }
      static from(value: any) {
        textureFromCalls += 1;
        value.onload = () => {};
        return new Texture({ source: value });
      }
    }
    context.PIXI.Texture = Texture;
    context.Sprite = class extends context.PIXI.Container {
      bitmap: any;
      texture: unknown;
      anchor = { x: 0, y: 0 };
      constructor(sourceBitmap: any) {
        super();
        this.bitmap = sourceBitmap;
        this.texture = Texture.EMPTY;
        sourceBitmap.addLoadListener(() => {
          this.texture = new Texture(sourceBitmap._baseTexture);
          this.width = sourceBitmap.width;
          this.height = sourceBitmap.height;
        });
      }
    };
    context.ImageManager = { loadBitmap: () => bitmap };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-bitmap-listener.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'sprite');
    scene.zOrder = ['sprite'];
    const spriteNode = scene.nodes[0];
    spriteNode.props.width = 408;
    spriteNode.props.height = 312;
    runtime.mount(scene, { root: new context.PIXI.Container() });

    assert.equal(textureFromCalls, 0);
    assert.equal(image.onload, engineImageLoad);
    image.width = 816;
    image.height = 624;
    bitmap._baseTexture = { width: 816, height: 624, realWidth: 816, realHeight: 624 };
    listeners.forEach((listener) => listener());
    assert.equal(runtime.nodeViews.sprite.scale.x, 0.5);
    assert.equal(runtime.nodeViews.sprite.scale.y, 0.5);
    assert.equal((runtime.nodeViews.sprite.__mzuiSourceTexture as Texture).baseTexture, bitmap._baseTexture);
    runtime.cleanup();
  });

  test('interactive button and container views receive a rectangle hit area that tracks prop updates', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    runtime.mount(scene, { root: new context.PIXI.Container() });

    const buttonView = runtime.nodeViews.button;
    assert.equal(buttonView.interactive, true);
    assert.equal(typeof buttonView.containsPoint, 'undefined');
    assert.ok(buttonView.hitArea);
    assert.equal(buttonView.hitArea.x, 0);
    assert.equal(buttonView.hitArea.y, 0);
    assert.equal(buttonView.hitArea.width, 100);
    assert.equal(buttonView.hitArea.height, 80);

    runtime.patchNodes([{ nodeId: 'button', props: { width: 240, height: 60 } }]);
    assert.equal(buttonView.hitArea.width, 240);
    assert.equal(buttonView.hitArea.height, 60);

    const spriteView = runtime.nodeViews.sprite;
    assert.equal(spriteView.interactive === true, false);
    runtime.cleanup();
  });

  test('normalizes button SE resource paths while preserving legacy names and rejecting non-SE assets', () => {
    const context = makeContext();
    const played: string[] = [];
    context.AudioManager = { playSe(audio: { name: string }) { played.push(audio.name); } };
    context.PIXI.Container.prototype.on = function (eventName: string, listener: () => void) {
      this.__listeners = this.__listeners || {};
      this.__listeners[eventName] = listener;
      return this;
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.type === 'button');
    button.props.hoverSe = 'audio/se/ui/Hover.ogg';
    button.props.clickSe = 'www/audio/se/Confirm.m4a';
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const view = runtime.nodeViews.button;

    view.__listeners.pointerover();
    view.__listeners.pointertap();
    assert.deepEqual(played, ['ui/Hover', 'Confirm']);

    view.__mzuiSe.click = 'legacy/Confirm';
    view.__listeners.pointertap();
    assert.equal(played.at(-1), 'legacy/Confirm');

    view.__mzuiSe.hover = 'audio/bgm/Theme.ogg';
    view.__listeners.pointerout();
    view.__listeners.pointerover();
    assert.equal(played.includes('audio/bgm/Theme.ogg'), false);
    assert.equal(runtime.errors.some((entry: { label?: string; node?: string; event?: string }) => entry.label === 'button-se' && entry.node === 'button' && entry.event === 'onHoverEnter'), true);

    runtime.runAction({ type: 'playSe', seName: 'EventConfirm' }, button, { type: 'pointertap' });
    assert.equal(played.at(-1), 'EventConfirm');
  });

  test('bridges RPG Maker TouchInput releases to buttons when PIXI pointer events are unavailable', () => {
    const context = makeContext();
    const input = { triggered: false, released: false, x: 50, y: 40 };
    context.TouchInput = {
      get x() { return input.x; },
      get y() { return input.y; },
      isTriggered: () => input.triggered,
      isReleased: () => input.released,
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-touch-input.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.id === 'button');
    button.events = { onClick: { actions: [{ type: 'setSwitch', switchId: 1, switchVal: 'toggle' }] } };
    const switches: Record<number, boolean> = { 1: false };
    const hostRoot = new context.PIXI.Container();
    runtime.mount(scene, { root: hostRoot, context: { switches } });
    context.Graphics = { app: { renderer: { plugins: { interaction: { hitTest: (_point: unknown, root: unknown) => {
      assert.equal(root, hostRoot);
      return runtime.nodeViews.button;
    } } } } } };

    input.triggered = true;
    runtime.update();
    assert.equal(runtime.touchPressedNodeId, 'button');
    assert.equal(runtime.nodeViews.button.__mzuiButtonState, 'pressed');
    assert.equal(switches[1], false);

    input.triggered = false;
    input.released = true;
    runtime.update();
    assert.equal(runtime.touchPressedNodeId, null);
    assert.equal(runtime.nodeViews.button.__mzuiButtonState, 'hover');
    assert.equal(switches[1], true);
    runtime.cleanup();
  });

  test('pressed button scales around its center and restores on release', () => {
    const context = makeContext();
    const input = { x: 50, y: 40, triggered: false, released: false };
    context.TouchInput = {
      get x() { return input.x; },
      get y() { return input.y; },
      isTriggered: () => input.triggered,
      isReleased: () => input.released,
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-pressed-scale.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.id === 'button');
    button.props.pressedScale = 0.5;
    const hostRoot = new context.PIXI.Container();
    runtime.mount(scene, { root: hostRoot });
    context.Graphics = { app: { renderer: { plugins: { interaction: { hitTest: () => runtime.nodeViews.button } } } } };
    const view = runtime.nodeViews.button;
    assert.equal(view.scale.x, 1);
    assert.equal(view.x, 0);

    input.triggered = true;
    runtime.update();
    assert.equal(view.__mzuiButtonState, 'pressed');
    assert.equal(view.scale.x, 0.5);
    assert.equal(view.scale.y, 0.5);
    assert.equal(view.x, 25);
    assert.equal(view.y, 20);

    input.triggered = false;
    input.released = true;
    runtime.update();
    assert.equal(view.scale.x, 1);
    assert.equal(view.scale.y, 1);
    assert.equal(view.x, 0);
    assert.equal(view.y, 0);
    runtime.cleanup();
  });

  test('tracks game hover through TouchInput when PIXI pointerover is unavailable', () => {
    const context = makeContext();
    const input = { x: 50, y: 40 };
    context.TouchInput = {
      get x() { return input.x; },
      get y() { return input.y; },
      isTriggered: () => false,
      isReleased: () => false,
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-touch-hover.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.id === 'button');
    button.props.imageStates = { normal: '', hover: 'img/hover.png', pressed: '', disabled: '' };
    button.events = {
      onHoverEnter: { actions: [{ type: 'setSwitch', switchId: 1, switchVal: 'on' }] },
      onHoverLeave: { actions: [{ type: 'setSwitch', switchId: 1, switchVal: 'off' }] },
    };
    const switches: Record<number, boolean> = { 1: false };
    runtime.mount(scene, { root: new context.PIXI.Container(), context: { switches } });
    let hit: any = runtime.nodeViews.button;
    context.Graphics = { app: { renderer: { plugins: { interaction: { hitTest: () => hit } } } } };

    runtime.update();
    assert.equal(runtime.touchHoveredNodeId, 'button');
    assert.equal(runtime.nodeViews.button.__mzuiPointerHover, true);
    assert.equal(runtime.nodeViews.button.__mzuiButtonState, 'hover');
    assert.equal(runtime.nodeViews.button.__mzuiButtonImage.visible, true);
    assert.equal(switches[1], true);

    runtime.update();
    assert.equal(switches[1], true);

    hit = null;
    runtime.update();
    assert.equal(runtime.touchHoveredNodeId, null);
    assert.equal(runtime.nodeViews.button.__mzuiPointerHover, false);
    assert.equal(runtime.nodeViews.button.__mzuiButtonState, 'normal');
    assert.equal(runtime.nodeViews.button.__mzuiButtonImage.visible, false);
    assert.equal(switches[1], false);
    runtime.cleanup();
  });

  test('deduplicates TouchInput release after PIXI already dispatched the same button tap', () => {
    const context = makeContext();
    const input = { triggered: false, released: false };
    context.TouchInput = {
      x: 50,
      y: 40,
      isTriggered: () => input.triggered,
      isReleased: () => input.released,
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-touch-input-dedupe.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.id === 'button');
    button.events = { onClick: { actions: [{ type: 'setSwitch', switchId: 1, switchVal: 'toggle' }] } };
    const switches: Record<number, boolean> = { 1: false };
    runtime.mount(scene, { root: new context.PIXI.Container(), context: { switches } });
    context.Graphics = { app: { renderer: { plugins: { interaction: { hitTest: () => runtime.nodeViews.button } } } } };

    input.triggered = true;
    runtime.update();
    runtime.dispatchActionsForNode(button, 'onClick', { type: 'pointertap' });
    runtime.nodeViews.button.__mzuiLastPixiPointerTapAt = Date.now();
    assert.equal(switches[1], true);

    input.triggered = false;
    input.released = true;
    runtime.update();
    assert.equal(switches[1], true);
    runtime.cleanup();
  });

  test('renders MV button text through the engine Bitmap with native font settings', () => {
    assertEngineWindowTextSignature('MV');
  });

  test('renders MZ button text through the engine Bitmap with native font settings', () => {
    assertEngineWindowTextSignature('MZ');
  });

  test('converts MV Bitmap base textures before creating NineSlice and frame sprites', () => {
    const context = makeContext();
    class Texture {
      baseTexture: unknown;
      constructor(baseTexture: unknown) { this.baseTexture = baseTexture; }
      static from(value: unknown) { return { source: value, baseTexture: { resource: { source: value } } }; }
    }
    context.PIXI.Texture = Texture;
    context.PIXI.NineSlicePlane = class extends context.PIXI.NineSlicePlane {
      texture: unknown;
      constructor(texture: unknown, ...args: unknown[]) { super(...args); this.texture = texture; }
    };
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => ({ baseTexture: { id: `${name}.png` } }) };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    runtime.mount(scene, { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.nineSlice.texture instanceof Texture, true);
    assert.equal((runtime.nodeViews.nineSlice.texture as any).baseTexture.id, 'panel.png');
    assert.equal(runtime.nodeViews.frameAnimation.bitmap.baseTexture.id, 'f0.png');
    runtime.cleanup();
  });

  test('refreshes NineSlice textures when an MV Bitmap finishes loading', () => {
    const context = makeContext();
    class Texture {
      baseTexture: unknown;
      constructor(baseTexture: unknown) { this.baseTexture = baseTexture; }
      static from(value: unknown) { return { source: value }; }
    }
    context.PIXI.Texture = Texture;
    context.PIXI.NineSlicePlane = class extends context.PIXI.NineSlicePlane {
      texture: unknown;
      setTexture(texture: unknown) { this.texture = texture; }
      constructor(texture: unknown, ...args: unknown[]) { super(...args); this.texture = texture; }
    };
    let finishLoad!: () => void;
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => name === 'panel'
      ? { baseTexture: null, addLoadListener(callback: () => void) { finishLoad = () => { this.baseTexture = { id: `${name}.png` }; callback(); }; } }
      : { baseTexture: { id: `${name}.png` } } };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    runtime.mount(allNodeScene(), { root: new context.PIXI.Container() });
    finishLoad();
    assert.equal((runtime.nodeViews.nineSlice.texture as any).baseTexture.id, 'panel.png');
    runtime.cleanup();
  });

  test('reapplies late Bitmap textures and geometry for sprite/frame/button/progress, then ignores destroyed callbacks', () => {
    const context = makeContext();
    const pending = new Map<string, Array<{ bitmap: any; callback: () => void }>>();
    context.ImageManager = {
      loadBitmap: (_folder: string, name: string) => {
        const bitmap: any = {
          baseTexture: null,
          addLoadListener(callback: () => void) {
            const key = `${name}.png`;
            const callbacks = pending.get(key) || [];
            callbacks.push({ bitmap, callback });
            pending.set(key, callbacks);
          },
        };
        return bitmap;
      },
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => ['sprite', 'frameAnimation', 'button', 'progressBar'].includes(node.type));
    scene.zOrder = scene.nodes.map((node: any) => node.id);
    const sprite = scene.nodes.find((node: any) => node.type === 'sprite');
    sprite.props.width = 200;
    sprite.props.height = 100;
    sprite.props.scaleX = 1.5;
    const frame = scene.nodes.find((node: any) => node.type === 'frameAnimation');
    frame.props.frames = [{ id: 'f0', path: 'img/frame.png', duration: 100 }];
    const button = scene.nodes.find((node: any) => node.type === 'button');
    button.props.imageStates = { normal: 'img/button.png', hover: '', pressed: '', disabled: '' };
    const progress = scene.nodes.find((node: any) => node.type === 'progressBar');
    progress.props.trackImage = 'img/track.png';
    progress.props.fillImage = 'img/fill.png';
    runtime.mount(scene, { root: new context.PIXI.Container() });

    const finish = (name: string) => {
      const callbacks = pending.get(name) || [];
      pending.delete(name);
      for (const entry of callbacks) {
        entry.bitmap.baseTexture = { id: name, width: 100, height: 50 };
        entry.callback();
      }
    };
    finish('a.png');
    finish('frame.png');
    finish('button.png');
    finish('track.png');
    finish('fill.png');
    assert.equal((runtime.nodeViews.sprite.__mzuiSourceTexture as any).id, 'a.png');
    assert.equal(runtime.nodeViews.sprite.scale.x, 3);
    assert.equal((runtime.nodeViews.frameAnimation.texture as any).id, 'frame.png');
    assert.equal((runtime.nodeViews.button.__mzuiButtonImage.texture as any).id, 'button.png');
    assert.equal((runtime.nodeViews.progressBar.__mzuiTrackImage.texture as any).id, 'track.png');
    assert.equal((runtime.nodeViews.progressBar.__mzuiFillImage.texture as any).id, 'fill.png');
    runtime.cleanup();
    for (const callbacks of pending.values()) for (const entry of callbacks) entry.callback();
    assert.equal(runtime.mounted, false);
  });

  test('honors frame duration/loop, progress image direction masks, and particle limits/effects', () => {
    const context = makeContext();
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => ({ id: name, width: 32, height: 32 }) };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const frame = scene.nodes.find((node: any) => node.type === 'frameAnimation');
    frame.props.frames = [
      { id: 'f0', path: 'img/f0.png', duration: 16 },
      { id: 'f1', path: 'img/f1.png', duration: 16 },
    ];
    frame.props.loop = false;
    const progress = scene.nodes.find((node: any) => node.type === 'progressBar');
    progress.props.fillDirection = 'rightToLeft';
    progress.props.trackImage = 'img/track.png';
    progress.props.fillImage = 'img/fill.png';
    progress.props.currentValue = 1;
    progress.props.maxValue = 2;
    const particle = scene.nodes.find((node: any) => node.type === 'particle');
    particle.props.maxParticles = 2;
    particle.props.emissionInterval = 1;
    particle.props.lifetime = 3;
    particle.props.lifetimeRandom = 0;
    particle.props.blendMode = 'add';
    particle.props.glow = 3;
    runtime.mount(scene, { root: new context.PIXI.Container(), deltaMs: 16 });
    for (let index = 0; index < 5; index += 1) runtime.update();
    assert.equal(runtime.frameAnimationState.frameAnimation.index, 1);
    assert.equal(runtime.nodeViews.progressBar.__mzuiFillImage.x, 50);
    assert.equal(runtime.nodeViews.progressBar.__mzuiFillMask.renderable, false);
    assert.equal(runtime.nodeViews.particle.blendMode, 'add');
    assert.equal(runtime.nodeViews.particle.filters.length, 1);
    assert.ok(runtime.frameAnimationState.particle.particles.length <= 2);
    particle.props.maxParticles = 0;
    for (let index = 0; index < 5; index += 1) runtime.update();
    assert.equal(runtime.frameAnimationState.particle.particles.length, 0);
    runtime.cleanup();
  });

  test('combines source dimensions with designer scale exactly once for sprite fills', () => {
    const context = makeContext();
    context.ImageManager = { loadBitmap: () => ({ width: 100, height: 50 }) };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const sprite = scene.nodes.find((node: any) => node.type === 'sprite');
    sprite.props.width = 200;
    sprite.props.height = 100;
    sprite.props.scaleX = 1.5;
    sprite.props.fillMode = 'stretch';
    runtime.mount(scene, { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.sprite.scale.x, 3);
    assert.equal(runtime.nodeViews.sprite.scale.y, 2);
    runtime.cleanup();

    const contain = allNodeScene();
    const containSprite = contain.nodes.find((node: any) => node.type === 'sprite');
    containSprite.props.width = 300;
    containSprite.props.height = 100;
    containSprite.props.fillMode = 'contain';
    runtime.mount(contain, { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.sprite.scale.x, 2);
    runtime.cleanup();

    const tiled = allNodeScene();
    const tiledSprite = tiled.nodes.find((node: any) => node.type === 'sprite');
    tiledSprite.props.fillMode = 'tile';
    runtime.mount(tiled, { root: new context.PIXI.Container() });
    assert.equal(runtime.nodeViews.sprite.__mzuiFillMode, 'tile');
    assert.equal(runtime.nodeViews.sprite.tileScale.x, 1);
    runtime.cleanup();
  });

  test('keeps sprite and container repeat modes directional', () => {
    const context = makeContext();
    context.PIXI.Texture.from = (bitmap: any) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      orig: { width: bitmap.width, height: bitmap.height },
    });
    context.ImageManager = { loadBitmap: () => ({ width: 10, height: 5 }) };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const container = scene.nodes.find((node: any) => node.type === 'container');
    const sprite = scene.nodes.find((node: any) => node.type === 'sprite');
    container.props.backgroundPath = 'img/background.png';
    container.props.backgroundRepeatMode = 'vertical';
    container.props.backgroundFillMode = 'stretch';
    sprite.props.repeatMode = 'horizontal';
    sprite.props.fillMode = 'stretch';
    runtime.mount(scene, { root: new context.PIXI.Container() });

    assert.equal(runtime.nodeViews.sprite.__mzuiRepeatAxes.x, true);
    assert.equal(runtime.nodeViews.sprite.__mzuiRepeatAxes.y, false);
    assert.equal(runtime.nodeViews.sprite.__mzuiRepeatMode, 'horizontal');
    assert.equal(runtime.nodeViews.sprite.tileScale.y, 16);
    const background = runtime.nodeViews.container.__mzuiBackground;
    assert.equal(background.__mzuiRepeatAxes.x, false);
    assert.equal(background.__mzuiRepeatAxes.y, true);
    assert.equal(background.__mzuiRepeatMode, 'vertical');
    assert.equal(background.tileScale.x, 10);
    runtime.cleanup();
  });

  test('accumulates tile scroll per frame and diagnoses unavailable blend modes', () => {
    const context = makeContext();
    context.PIXI.BLEND_MODES = { NORMAL: 0, ADD: 1, SCREEN: 2 };
    context.ImageManager = { loadBitmap: () => ({ width: 10, height: 5 }) };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const sprite = scene.nodes.find((node: any) => node.type === 'sprite');
    sprite.props.repeatMode = 'both';
    sprite.props.fillMode = 'tile';
    sprite.props.scrollX = 2;
    sprite.props.scrollY = -1;
    sprite.props.blendMode = 'multiply';
    runtime.mount(scene, { root: new context.PIXI.Container() });
    runtime.update();
    runtime.update();
    assert.equal(runtime.nodeViews.sprite.tilePosition.x, 4);
    assert.equal(runtime.nodeViews.sprite.tilePosition.y, -2);
    assert.equal(runtime.errors.some((entry: any) => entry.node === 'sprite' && entry.label === 'blend-mode'), true);
    runtime.cleanup();
  });

  test('treats particle emission interval and lifetime as update frames at any host refresh rate', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'particle');
    scene.zOrder = ['particle'];
    const particle = scene.nodes[0];
    particle.props.maxParticles = 1;
    particle.props.emissionInterval = 2;
    particle.props.lifetime = 3;
    particle.props.lifetimeRandom = 0;
    particle.props.imagePath = '';
    runtime.mount(scene, { root: new context.PIXI.Container(), deltaMs: 1000 / 60 });
    runtime.update();
    assert.equal(runtime.frameAnimationState.particle.particles.length, 0);
    runtime.update();
    assert.equal(runtime.frameAnimationState.particle.particles.length, 1);
    runtime.update();
    runtime.update();
    assert.equal(runtime.frameAnimationState.particle.particles.length, 1);
    runtime.update();
    assert.equal(runtime.frameAnimationState.particle.particles.length, 0);
    runtime.cleanup();

    const secondRuntime = context.MZUIRuntime.create();
    secondRuntime.mount(scene, { root: new context.PIXI.Container(), deltaMs: 1000 / 30 });
    secondRuntime.update();
    secondRuntime.update();
    assert.equal(secondRuntime.frameAnimationState.particle.particles.length, 1);
    secondRuntime.update();
    secondRuntime.update();
    secondRuntime.update();
    assert.equal(secondRuntime.frameAnimationState.particle.particles.length, 0);
    secondRuntime.cleanup();
  });

  test('resolves MV and MZ scene roots from the app document when cwd is the external runtime', () => {
    for (const engine of ['MV', 'MZ']) {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), `ui-runtime-external-${engine.toLowerCase()}-`));
      const externalRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-host-'));
      try {
        const engineRoot = engine === 'MV' ? path.join(project, 'www') : project;
        fs.mkdirSync(path.join(engineRoot, 'data'), { recursive: true });
        fs.mkdirSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data'), { recursive: true });
        const sceneName = `Scene_External${engine}`;
        fs.writeFileSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data', `${sceneName}.json`), JSON.stringify({
          version: '1.1.0', runtimeVersion: '>=1.1.0',
          meta: { sceneName, sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 },
          transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
          globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: sceneScript(),
        }), 'utf8');
        const context = makeContext();
        const documentUrl = pathToFileURL(path.join(engineRoot, 'index.html'));
        context.location = { protocol: documentUrl.protocol, pathname: documentUrl.pathname, href: documentUrl.href };
        context.document = { location: context.location };
        context.PluginManager.parameters = () => ({ AutoRegister: 'true' });
        context.process = { cwd: () => externalRuntime };
        context.require = nodeRequire;
        vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-external-${engine}.js` });
        assert.equal(context.MZUIRuntime.resolveEngineRoot(), fs.realpathSync(engineRoot));
        assert.equal(typeof context[sceneName], 'function');
      } finally {
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(externalRuntime, { recursive: true, force: true });
      }
    }
  });

  test('rejects an invalid app document root instead of falling back to cwd', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-valid-cwd-'));
    const invalidDocumentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-invalid-document-'));
    try {
      fs.mkdirSync(path.join(project, 'data'), { recursive: true });
      fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
      const context = makeContext();
      const documentUrl = pathToFileURL(path.join(invalidDocumentRoot, 'index.html'));
      context.location = { protocol: documentUrl.protocol, pathname: documentUrl.pathname, href: documentUrl.href };
      context.document = { location: context.location };
      context.PluginManager.parameters = () => ({ AutoRegister: 'false' });
      context.process = { cwd: () => project };
      context.require = nodeRequire;
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-invalid-document.js' });
      assert.throws(
        () => context.MZUIRuntime.resolveEngineRoot(),
        /RPG Maker app document root is invalid/,
      );
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(invalidDocumentRoot, { recursive: true, force: true });
    }
  });

  test('renders the complete shape-particle property matrix in a real PIXI Container layer', () => {
    const context = makeContext();
    context.console = { ...console, error() {} };
    const randomValues: number[] = [0.75, 0.25, 0.75, 0.25, 0.75];
    context.Math = Object.create(Math);
    context.Math.random = () => randomValues.shift() ?? 0.5;
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'particle');
    scene.zOrder = ['particle'];
    const props = scene.nodes[0].props;
    Object.assign(props, {
      maxParticles: 1,
      emissionInterval: 1,
      emissionArea: 'rectangle',
      imagePath: '',
      shape: 'star',
      velocityX: 2,
      velocityY: -1,
      velocityRandomX: 4,
      velocityRandomY: 6,
      gravityX: 60,
      gravityY: 120,
      rotationSpeed: 60,
      lifetime: 4,
      lifetimeRandom: 4,
      startScale: 2,
      endScale: 4,
      startOpacity: 200,
      endOpacity: 100,
      startColor: '#ff0000',
      endColor: '#0000ff',
      blendMode: 'screen',
      glow: 2,
    });
    runtime.mount(scene, { root: new context.PIXI.Container() });
    runtime.update();

    const state = runtime.frameAnimationState.particle;
    const layer = runtime.nodeViews.particle.__mzuiParticleLayer;
    const particle = state.particles[0];
    assert.ok(layer instanceof context.PIXI.Container);
    assert.equal(layer instanceof context.PIXI.ParticleContainer, false);
    assert.equal(layer.__mzuiParticleChildType, 'graphics');
    assert.ok(particle instanceof context.PIXI.Graphics);
    assert.deepEqual({ x: particle.x, y: particle.y }, { x: 78, y: 17.5 });
    assert.deepEqual({ x: particle.__mzuiVelocityX, y: particle.__mzuiVelocityY }, { x: 3, y: -2.5 });
    assert.equal(particle.__mzuiLife, 5);
    assert.equal(particle.scale.x, 2);
    assert.equal(particle.alpha, 200 / 255);
    assert.equal(particle.tint, 0xff0000);
    assert.equal(particle.rotation, 1);
    assert.equal(particle.blendMode, 'screen');
    assert.equal(runtime.nodeViews.particle.filters.length, 1);
    assert.ok(runtime.nodeViews.particle.__mzuiGlowFilter instanceof context.PIXI.Filter);
    assert.deepEqual(Array.from(runtime.nodeViews.particle.__mzuiGlowFilter.uniforms.mzuiGlowOffset), [2 / 816, 2 / 624]);
    assert.equal(runtime.nodeViews.particle.__mzuiGlowFilter.uniforms.mzuiGlowStrength, 0.25);
    const glowFragment = runtime.nodeViews.particle.__mzuiGlowFilter.fragment;
    assert.match(glowFragment, /float mzuiSampleAlpha\(vec2 uv\)/);
    assert.match(glowFragment, /step\(vec2\(0\.0\), uv\) \* step\(uv, vec2\(1\.0\)\)/);
    assert.match(glowFragment, /vec2 diagonal = d \* 0\.70710678/);
    assert.match(glowFragment, /base\.rgb \+ premultipliedGlow/);

    runtime.update();
    assert.deepEqual({ x: particle.x, y: particle.y }, { x: 82, y: 17 });
    assert.equal(particle.scale.x, 2.4);
    assert.equal(particle.alpha, 180 / 255);
    assert.equal(particle.tint, 0xcc0033);
    assert.equal(particle.rotation, 2);

    props.maxParticles = 10001;
    runtime.update();
    assert.equal(runtime.errors.some((entry: any) => entry.label === 'particle-limit'), true);
    props.maxParticles = 0;
    runtime.update();
    assert.equal(state.particles.length, 0);
    assert.equal(state.pool.length, 0);
    assert.equal(particle.destroyed, true);

    props.maxParticles = 1;
    props.emissionArea = 'circle';
    randomValues.push(0, 1, 0.5, 0.5, 0.5);
    runtime.update();
    assert.deepEqual({ x: state.particles[0].x, y: state.particles[0].y }, { x: 92, y: 39 });
    props.maxParticles = 0;
    runtime.update();
    Object.assign(props, { maxParticles: 1, emissionArea: 'point', velocityX: 0, velocityY: 0, velocityRandomX: 0, velocityRandomY: 0, gravityX: 0, gravityY: 0 });
    randomValues.push(0.5, 0.5, 0.5);
    runtime.update();
    assert.deepEqual({ x: state.particles[0].x, y: state.particles[0].y }, { x: 50, y: 40 });
    runtime.cleanup();
  });

  test('uses the MV PixiJS 4 mesh namespace for NineSlice and keeps logical dimensions', () => {
    const context = makeContext();
    const NineSlicePlane = context.PIXI.NineSlicePlane;
    delete context.PIXI.NineSlicePlane;
    context.PIXI.mesh = { NineSlicePlane };
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => ({ baseTexture: { id: `${name}.png` } }) };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const nineSlice = scene.nodes.find((node: any) => node.type === 'nineSlice');
    nineSlice.props.width = 240;
    nineSlice.props.height = 100;
    nineSlice.props.scaleX = 1.25;
    nineSlice.props.scaleY = 0.75;
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const view = runtime.nodeViews.nineSlice;
    assert.equal(view instanceof NineSlicePlane, true);
    assert.equal(view.width, 240);
    assert.equal(view.height, 100);
    assert.equal(view.scale.x, 1.25);
    assert.equal(view.scale.y, 0.75);
    runtime.cleanup();
  });

  test('normalizes four-edge editor padding while keeping Pixi text on one compressed line', () => {
    const context = makeContext();
    class TextStyleProbe extends context.PIXI.Text {
      style: Record<string, unknown> = {};
    }
    context.PIXI.Text = TextStyleProbe;
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'text');
    scene.zOrder = ['text'];
    scene.nodes[0].props.content = 'Line one\nLine two';
    scene.nodes[0].props.padding = { top: 2, right: 8, bottom: 4, left: 6 };
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const view = runtime.nodeViews.text;
    assert.equal(view.text, 'Line one Line two');
    assert.equal(view.style.padding, 8);
    assert.equal(view.style.wordWrap, false);
    assert.equal(view.scale.x < 1, true);
    assert.equal(view.scale.y, 1);
    runtime.cleanup();
  });

  test('plain text keeps the engine alphabetic baseline and vertical-aligns by offset', () => {
    const context = makeContext();
    class TextStyleProbe extends context.PIXI.Text {
      style: Record<string, unknown> = {};
    }
    context.PIXI.Text = TextStyleProbe;
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'text');
    scene.zOrder = ['text'];
    const textNode = scene.nodes[0];
    textNode.props.y = 100;
    textNode.props.height = 80;
    textNode.props.scaleY = 1;
    textNode.props.verticalAlign = 'middle';
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const view = runtime.nodeViews.text;
    assert.equal(view.style.textBaseline, 'alphabetic');
    assert.equal(view.y, 140);
    runtime.patchNodes([{ nodeId: 'text', props: { verticalAlign: 'top' } }]);
    assert.equal(view.y, 100);
    runtime.cleanup();
  });

  test('authoring stays inert while editor and full preview execute the action surface', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const scene = allNodeScene();
    const button = scene.nodes.find((node: any) => node.type === 'button');
    const variables = { setup: 0, ready: 0, update: 0, property: 0, condition: 0, disabled: 0, actionCondition: 0, action: 0 };
    scene.sceneScript = {
      version: '1.0.0',
      source: 'context.variables.setup += 1; onReady(function () { context.variables.ready += 1; }); onUpdate(function () { context.variables.update += 1; });',
    };
    button.propModes = { x: 'code' };
    button.propCodes = { x: '(context.variables.property += 1, 42)' };
    button.condition = { type: 'code', code: '(context.variables.condition += 1, true)' };
    button.props.disabledCondition = '(context.variables.disabled += 1, false)';
    button.events = { onClick: { actions: [{
      type: 'script',
      condition: { type: 'code', code: '(context.variables.actionCondition += 1, true)' },
      code: 'context.variables.action += 1;',
    }] } };

    const authoring = context.MZUIRuntime.create();
    authoring.mount(scene, { root: new context.PIXI.Container(), context: { variables }, executionMode: 'authoring' });
    authoring.update();
    assert.equal(authoring.handleRendererInput({ type: 'pointerup', nodeId: button.id, x: 1, y: 1, button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }), false);
    assert.deepEqual({ ...variables }, { setup: 0, ready: 0, update: 0, property: 0, condition: 0, disabled: 0, actionCondition: 0, action: 0 });
    authoring.cleanup();

    const editorPreview = context.MZUIRuntime.create();
    editorPreview.mount(scene, { root: new context.PIXI.Container(), context: { variables }, executionMode: 'editor-preview' });
    editorPreview.update();
    assert.equal(editorPreview.handleRendererInput({ type: 'pointerup', nodeId: button.id, x: 1, y: 1, button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }), true);
    assert.deepEqual({ ...variables }, { setup: 1, ready: 1, update: 1, property: 1, condition: 2, disabled: 2, actionCondition: 1, action: 1 });
    editorPreview.cleanup();

    Object.assign(variables, { setup: 0, ready: 0, update: 0, property: 0, condition: 0, disabled: 0, actionCondition: 0, action: 0 });
    const fullPreview = context.MZUIRuntime.create();
    fullPreview.mount(scene, { root: new context.PIXI.Container(), context: { variables }, executionMode: 'full-preview' });
    fullPreview.update();
    assert.equal(fullPreview.handleRendererInput({ type: 'pointerup', nodeId: button.id, x: 1, y: 1, button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }), true);
    assert.deepEqual({ ...variables }, { setup: 1, ready: 1, update: 1, property: 1, condition: 2, disabled: 2, actionCondition: 1, action: 1 });
    fullPreview.cleanup();
  });

  test('reuses textured particle objects, switches image/shape layers, and releases pooled PIXI resources', () => {
    const context = makeContext();
    context.console = { ...console, error() {} };
    let bitmapLoads = 0;
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => { bitmapLoads += 1; return { id: name, width: 8, height: 8 }; } };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    scene.nodes = scene.nodes.filter((node: any) => node.type === 'particle');
    scene.zOrder = ['particle'];
    const props = scene.nodes[0].props;
    Object.assign(props, {
      maxParticles: 1,
      emissionInterval: 1,
      imagePath: 'img/particle.png',
      lifetime: 1,
      lifetimeRandom: 0,
      startColor: '#336699',
      endColor: '#336699',
      glow: 3,
    });
    runtime.mount(scene, { root: new context.PIXI.Container() });
    runtime.update();
    const state = runtime.frameAnimationState.particle;
    const imageLayer = runtime.nodeViews.particle.__mzuiParticleLayer;
    const firstParticle = state.particles[0];
    assert.equal(imageLayer instanceof context.PIXI.ParticleContainer, false);
    assert.equal(imageLayer.__mzuiParticleChildType, 'sprite');
    runtime.update();
    assert.equal(state.pool[0], firstParticle);
    runtime.update();
    assert.equal(state.particles[0], firstParticle);
    assert.equal(bitmapLoads, 1);

    props.imagePath = '';
    props.shape = 'square';
    runtime.update();
    const shapeLayer = runtime.nodeViews.particle.__mzuiParticleLayer;
    assert.notEqual(shapeLayer, imageLayer);
    assert.equal(imageLayer.destroyed, true);
    assert.equal(firstParticle.destroyed, true);
    assert.equal(shapeLayer.__mzuiParticleChildType, 'graphics');
    assert.ok(state.particles[0] instanceof context.PIXI.Graphics);

    const shapeParticle = state.particles[0];
    const glowFilter = runtime.nodeViews.particle.__mzuiGlowFilter;
    runtime.cleanup();
    assert.equal(shapeParticle.destroyed, true);
    assert.equal(shapeLayer.destroyed, true);
    assert.equal(glowFilter.destroyed, true);

    delete context.PIXI.Filter;
    const unsupportedRuntime = context.MZUIRuntime.create();
    const unsupportedScene = allNodeScene();
    unsupportedScene.nodes = unsupportedScene.nodes.filter((node: any) => node.type === 'particle');
    unsupportedScene.zOrder = ['particle'];
    Object.assign(unsupportedScene.nodes[0].props, { imagePath: '', emissionInterval: 1, glow: 1 });
    unsupportedRuntime.mount(unsupportedScene, { root: new context.PIXI.Container() });
    assert.equal(unsupportedRuntime.errors.some((entry: any) => entry.label === 'particle-capability' && entry.node === 'particle'), true);
    unsupportedRuntime.cleanup();
  });

  test('registers an engine Scene subclass with a private runtime container', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    context.MZUIRuntime.registerScene('Scene_Registered', 'Scene_Base', sceneDocument());
    const instance = new context.Scene_Registered();
    const unrelated = new context.PIXI.Container();
    instance.addChild(unrelated);
    instance.create();
    assert.equal(instance.children.includes(unrelated), true);
    assert.equal(instance.children.length, 2);
    instance.terminate();
    assert.equal(instance.children.includes(unrelated), true);
    assert.equal(instance.children.length, 1);
  });

  test('keeps exit transition busy until SceneManager asks for termination', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const scene = sceneDocument();
    context.MZUIRuntime.registerScene('Scene_ExitLifecycle', 'Scene_Base', scene);
    const instance = new context.Scene_ExitLifecycle();
    const unrelated = new context.PIXI.Container();
    instance.addChild(unrelated);
    instance.create();
    instance.stop();
    assert.equal(instance.isBusy(), true);
    for (let index = 0; index < 24; index += 1) instance.update();
    assert.equal(instance.isBusy(), false);
    assert.equal(instance.children.length, 2);
    instance.terminate();
    assert.equal(instance.children.includes(unrelated), true);
  });

  test('registers one-file scene lifecycle callbacks on the engine Scene and exposes nodes by name', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const scene = sceneDocument();
    scene.sceneScript = {
      version: '1.0.0',
      source: [
        'let sharedCount = 0;',
        'let lateRegister;',
        'onReady(function (runtime, context) { sharedCount += 1; lateRegister = onUpdate; this.__lateRegister = lateRegister; this.__readyScene = this; this.__readyNode = this.nodes.Child; this.__legacyReadyArgs = [runtime === this._mzuiRuntime, context.sceneApi === this]; });',
        'onUpdate(function (runtime, context) { sharedCount += 1; this.__updateScene = this; this.__sharedCount = sharedCount; this.__legacyUpdateArgs = [runtime === this._mzuiRuntime, context.sceneApi === this, runtime.frame, runtime.deltaMs]; });',
      ].join('\n'),
    };
    context.MZUIRuntime.registerScene('Scene_Abi', 'Scene_Base', { ...scene, meta: { ...scene.meta, sceneName: 'Scene_Abi' } });
    const instance = new context.Scene_Abi();
    instance.create();
    instance.update();
    assert.equal(instance.__readyScene, instance);
    assert.equal(instance.__updateScene, instance);
    assert.equal(instance.__sharedCount, 2);
    assert.ok(instance.__readyNode);
    assert.deepEqual(Array.from(instance.__legacyReadyArgs), [true, true]);
    assert.deepEqual(Array.from(instance.__legacyUpdateArgs), [true, true, 1, 1000 / 60]);
    instance.terminate();
    assert.throws(() => instance.__lateRegister(function () {}), /only be called synchronously/);
  });

  test('isolates one-file setup ready and update failures across MV and MZ scene hosts', () => {
    for (const engine of ['MV', 'MZ']) {
      const context = makeContext();
      context.Utils = { RPGMAKER_NAME: engine };
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-lifecycle-${engine}.js` });
      const scene = sceneDocument();
      scene.sceneScript = {
        version: '1.0.0',
        source: [
          'this.__lateRegister = onUpdate;',
          'onReady(function () { this.__failedReadyCalls = (this.__failedReadyCalls || 0) + 1; throw new Error("ready failure"); });',
          'onReady(function () { this.__healthyReadyCalls = (this.__healthyReadyCalls || 0) + 1; });',
          'onUpdate(function () { this.__failedUpdateCalls = (this.__failedUpdateCalls || 0) + 1; throw new Error("update failure"); });',
          'onUpdate(function () { this.__healthyUpdateCalls = (this.__healthyUpdateCalls || 0) + 1; });',
          'throw new Error("setup failure");',
        ].join('\n'),
      };
      const sceneName = `Scene_Lifecycle_${engine}`;
      context.MZUIRuntime.registerScene(sceneName, 'Scene_Base', { ...scene, meta: { ...scene.meta, sceneName } });
      const instance = new context[sceneName]();
      const unrelated = new context.PIXI.Container();
      instance.addChild(unrelated);
      instance.create();
      const runtime = instance._mzuiRuntime;
      assert.equal(instance.__failedReadyCalls, 1);
      assert.equal(instance.__healthyReadyCalls, 1);
      assert.throws(() => instance.__lateRegister(function () {}), /only be called synchronously/);
      instance.update();
      instance.update();
      assert.equal(instance.__failedUpdateCalls, 1);
      assert.equal(instance.__healthyUpdateCalls, 2);
      assert.equal(runtime.errors.filter((entry: { phase?: string }) => entry.phase === 'setup').length, 1);
      assert.equal(runtime.errors.filter((entry: { phase?: string }) => entry.phase === 'ready').length, 1);
      assert.equal(runtime.errors.filter((entry: { phase?: string }) => entry.phase === 'update').length, 1);
      instance.terminate();
      assert.equal(instance.children.includes(unrelated), true);
      assert.equal(instance.children.length, 1);
      assert.throws(() => instance.__lateRegister(function () {}), /only be called synchronously/);
    }
  });

  test('injects the documented self/scene and game state helper ABI once per callback', () => {
    const context = makeContext();
    context.$gameSwitches.value = (id: number) => Boolean(context.$gameSwitches._data[id]);
    context.$gameVariables.value = (id: number) => context.$gameVariables._data[id];
    context.$gameSwitches._data[1] = true;
    context.$gameVariables._data[1] = 4;
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const scene = sceneDocument();
    scene.sceneScript = sceneScript(
      'this.__abiReady = [self === scene, $sw(1), $var(1)]; $setSw(2, true); $setVar(3, 8);',
      'this.__abiUpdate = [self === scene, $sw(2), $var(3), frame, deltaMs];',
    );
    scene.nodes[1].propModes = { x: 'code' };
    scene.nodes[1].propCodes = { x: '$var(3) + 1' };
    scene.nodes[1].condition = { type: 'code', code: '$sw(2)' };
    scene.nodes[0].events = { onClick: { actions: [{ type: 'script', code: 'this.__abiAction = [$sw(2), $var(3), self === this.nodes["Root"]];' }] } };
    context.MZUIRuntime.registerScene('Scene_AbiHelpers', 'Scene_Base', { ...scene, meta: { ...scene.meta, sceneName: 'Scene_AbiHelpers' } });
    const instance = new context.Scene_AbiHelpers();
    instance.create();
    instance.update();
    instance._mzuiRuntime.dispatchActionsForNode(scene.nodes[0], 'onClick', { type: 'pointertap' });
    assert.equal(instance.__abiReady[0], true);
    assert.equal(instance.__abiReady[1], true);
    assert.equal(instance.__abiReady[2], 4);
    assert.equal(instance.__abiUpdate[0], true);
    assert.equal(instance.__abiUpdate[1], true);
    assert.equal(instance.__abiUpdate[2], 8);
    assert.equal(instance.__abiUpdate[3], 1);
    assert.equal(instance.__abiUpdate[4], 1000 / 60);
    assert.equal(instance._mzuiRuntime.scene.nodes[1].props.x, 9);
    assert.equal(instance.__abiAction[0], true);
    assert.equal(instance.__abiAction[1], 8);
    assert.equal(instance.__abiAction[2], true);
    assert.equal(context.$gameSwitches._data[2], true);
    assert.equal(context.$gameVariables._data[3], 8);
    instance.terminate();
  });

  test('loads data/GlobalUI.json as $dataGlobalUI and exposes it to scripts as $global', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-global-data-'));
    try {
      fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(project, 'data'), { recursive: true });
      fs.writeFileSync(path.join(project, 'data', 'GlobalUI.json'), JSON.stringify({ menuList: [{ text: 'Start' }] }), 'utf8');
      const context = makeContext();
      context.process = { cwd: () => project };
      context.require = nodeRequire;
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-global.js' });
      assert.deepEqual(jsonValue(context.$dataGlobalUI), { menuList: [{ text: 'Start' }] });

      const runtime = context.MZUIRuntime.create();
      const scene = sceneDocument();
      scene.sceneScript = sceneScript('this.__globalText = $global.menuList[0].text;', '');
      runtime.mount(scene, { root: new context.PIXI.Container() });
      assert.equal(runtime.__globalText, 'Start');
      runtime.cleanup();
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('treats a missing GlobalUI.json as empty data and rejects a non-container root', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-global-data-missing-'));
    try {
      fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(project, 'data'), { recursive: true });
      const missing = makeContext();
      missing.process = { cwd: () => project };
      missing.require = nodeRequire;
      vm.runInNewContext(RUNTIME_SOURCE, missing, { filename: 'MZUIRuntime-global-missing.js' });
      assert.deepEqual(jsonValue(missing.$dataGlobalUI), {});
      assert.equal(missing.MZUIRuntime.errors.some((entry: { label?: string }) => entry.label === 'global-data'), false);

      fs.writeFileSync(path.join(project, 'data', 'GlobalUI.json'), '"text"', 'utf8');
      const invalid = makeContext();
      invalid.process = { cwd: () => project };
      invalid.require = nodeRequire;
      vm.runInNewContext(RUNTIME_SOURCE, invalid, { filename: 'MZUIRuntime-global-invalid.js' });
      assert.deepEqual(jsonValue(invalid.$dataGlobalUI), {});
      assert.equal(invalid.MZUIRuntime.errors.some((entry: { label?: string }) => entry.label === 'global-data'), true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('persists $dataGlobalUI mutations as a save diff layered over the shipped file', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-global-data-save-'));
    try {
      fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(project, 'data'), { recursive: true });
      const shipped = { keep: 1, nested: { a: 1, b: 2 }, list: [1, 2] };
      fs.writeFileSync(path.join(project, 'data', 'GlobalUI.json'), JSON.stringify(shipped), 'utf8');
      const context = makeContext();
      context.process = { cwd: () => project };
      context.require = nodeRequire;
      context.DataManager = {
        createGameObjects() {},
        makeSaveContents() { return { system: 'base' }; },
        extractSaveContents() {},
      };
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-global-save.js' });

      context.$dataGlobalUI.nested.b = 3;
      context.$dataGlobalUI.added = 'new';
      delete context.$dataGlobalUI.keep;
      const contents = context.DataManager.makeSaveContents();
      assert.equal(contents.system, 'base');
      assert.deepEqual(jsonValue(contents.mzuiGlobalUI), { o: { keep: { d: 1 }, nested: { o: { b: { v: 3 } } }, added: { v: 'new' } } });

      context.DataManager.extractSaveContents(contents);
      assert.deepEqual(jsonValue(context.$dataGlobalUI), { nested: { a: 1, b: 3 }, list: [1, 2], added: 'new' });

      context.$dataGlobalUI.nested.b = 99;
      context.DataManager.createGameObjects();
      assert.deepEqual(jsonValue(context.$dataGlobalUI), shipped);
      assert.equal(context.DataManager.makeSaveContents().mzuiGlobalUI, null);

      context.$dataGlobalUI.keep = 5;
      context.DataManager.extractSaveContents({ system: 'legacy' });
      assert.deepEqual(jsonValue(context.$dataGlobalUI), shipped);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('installs embedded global data without fs and uses it as the save baseline', () => {
    const context = makeContext();
    context.DataManager = {
      createGameObjects() {},
      makeSaveContents() { return {}; },
      extractSaveContents() {},
    };
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-global-install.js' });
    assert.deepEqual(jsonValue(context.$dataGlobalUI), {});

    context.MZUIRuntime.installGlobalData({ menuList: [{ text: 'Start' }] });
    assert.deepEqual(jsonValue(context.$dataGlobalUI), { menuList: [{ text: 'Start' }] });

    context.$dataGlobalUI.menuList[0].text = 'Mutated';
    context.DataManager.createGameObjects();
    assert.deepEqual(jsonValue(context.$dataGlobalUI), { menuList: [{ text: 'Start' }] });
    assert.equal(context.DataManager.makeSaveContents().mzuiGlobalUI, null);

    assert.throws(() => context.MZUIRuntime.installGlobalData('text'), /Global UI data root/);
  });

  test('loads a BOM-prefixed GlobalUI.json', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-global-data-bom-'));
    try {
      fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(project, 'data'), { recursive: true });
      fs.writeFileSync(path.join(project, 'data', 'GlobalUI.json'), '\uFEFF' + JSON.stringify({ menuList: [] }), 'utf8');
      const context = makeContext();
      context.process = { cwd: () => project };
      context.require = nodeRequire;
      vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime-global-bom.js' });
      assert.deepEqual(jsonValue(context.$dataGlobalUI), { menuList: [] });
      assert.equal(context.MZUIRuntime.errors.some((entry: { label?: string }) => entry.label === 'global-data'), false);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test('dispatches visibility events only on effective visibility edges per node', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    const events: string[] = [];
    scene.nodes[0].propModes = { visible: 'code' };
    scene.nodes[0].propCodes = { visible: '$var(1) === 0' };
    scene.nodes[0].events = {
      onShow: { actions: [{ type: 'trackVisibility', label: 'show' }] },
      onHide: { actions: [{ type: 'trackVisibility', label: 'hide' }] },
      onClick: { actions: [{ type: 'toggleNode', targetNodeId: 'child' }] },
    };
    scene.nodes[1].events = {
      onShow: { actions: [{ type: 'trackVisibility', label: 'show' }] },
      onHide: { actions: [{ type: 'trackVisibility', label: 'hide' }] },
    };
    const switches = { 1: false };
    const variables = { 1: 0 };
    runtime.mount(scene, {
      root: new context.PIXI.Container(),
      context: {
        switches,
        variables,
        actions: {
          trackVisibility: (action: { label: string }, node: { id: string }) => events.push(`${node.id}:${action.label}`),
        },
      },
    });
    assert.deepEqual(events, ['root:show']);

    runtime.update();
    assert.deepEqual(events, ['root:show']);
    switches[1] = true;
    runtime.update();
    assert.deepEqual(events, ['root:show', 'child:show']);
    runtime.update();
    assert.deepEqual(events, ['root:show', 'child:show']);

    runtime.dispatchActionsForNode(scene.nodes[0], 'onClick', { type: 'pointertap' });
    assert.deepEqual(events, ['root:show', 'child:show', 'child:hide']);
    runtime.dispatchActionsForNode(scene.nodes[0], 'onClick', { type: 'pointertap' });
    assert.deepEqual(events, ['root:show', 'child:show', 'child:hide', 'child:show']);

    variables[1] = 1;
    runtime.update();
    assert.deepEqual(events, ['root:show', 'child:show', 'child:hide', 'child:show', 'root:hide']);
    variables[1] = 0;
    runtime.update();
    assert.deepEqual(events, ['root:show', 'child:show', 'child:hide', 'child:show', 'root:hide', 'root:show']);

    runtime.cleanup();
    assert.deepEqual(events, ['root:show', 'child:show', 'child:hide', 'child:show', 'root:hide', 'root:show', 'root:hide', 'child:hide']);
    runtime.cleanup();
    assert.deepEqual(events, ['root:show', 'child:show', 'child:hide', 'child:show', 'root:hide', 'root:show', 'root:hide', 'child:hide']);
  });

  test('compiles code once, disables only the failing node handler, and exposes scene helpers through this', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    scene.nodes[0].propModes = { x: 'code' };
    scene.nodes[0].propCodes = { x: 'throw new Error("bad property");' };
    scene.nodes[1].propModes = { x: 'code' };
    scene.nodes[1].propCodes = { x: 'this.nodes["Child"] ? 222 : 111' };
    scene.nodes[1].condition = { type: 'none' };
    runtime.mount(scene, { root: new context.PIXI.Container() });
    runtime.update();
    runtime.update();
    assert.equal(scene.nodes[1].props.x, 222);
    assert.equal(runtime.errors.filter((entry: { node?: string }) => entry.node === 'root').length, 1);
    assert.equal(runtime.errors.filter((entry: { node?: string }) => entry.node === 'child').length, 0);
    assert.equal(runtime.disabledHandlers['property:root:x'], true);
  });

  test('isolates update failures per node and records phase diagnostics once', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    scene.nodes[1].propModes = { x: 'code' };
    scene.nodes[1].propCodes = { x: '(++context.variables.count)' };
    scene.nodes[1].condition = { type: 'none' };
    const variables = { count: 0 };
    runtime.mount(scene, { root: new context.PIXI.Container(), context: { variables } });
    const rootView = runtime.nodeViews.root;
    Object.defineProperty(rootView, 'x', { configurable: true, get: () => 0, set: () => { throw new Error('root update failure'); } });
    runtime.update();
    runtime.update();
    assert.equal(variables.count, 2);
    assert.equal(runtime.disabledHandlers['node:root:update'], true);
    assert.equal(runtime.errors.filter((entry: any) => entry.node === 'root' && entry.phase === 'update').length, 1);
    runtime.cleanup();
  });

  test('wait pauses only its event chain and resumes following actions in order', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    const messages: string[] = [];
    scene.nodes[0].events = {
      onClick: { actions: [
        { type: 'showMessage', message: 'first' },
        { type: 'wait', waitFrames: 2 },
        { type: 'showMessage', message: 'after-wait' },
      ] },
    };
    scene.nodes[1].events = { onClick: { actions: [{ type: 'showMessage', message: 'other-chain' }] } };
    runtime.mount(scene, { root: new context.PIXI.Container(), context: { actions: { showMessage: (action: any) => messages.push(action.message) } } });
    runtime.dispatchActionsForNode(scene.nodes[0], 'onClick', { type: 'pointertap' });
    runtime.dispatchActionsForNode(scene.nodes[1], 'onClick', { type: 'pointertap' });
    assert.deepEqual(messages, ['first', 'other-chain']);
    runtime.update();
    assert.deepEqual(messages, ['first', 'other-chain']);
    runtime.update();
    assert.deepEqual(messages, ['first', 'other-chain', 'after-wait']);
    runtime.cleanup();
  });

  test('creates the official MV message window before a show-message action runs', () => {
    const context = makeContext();
    const messages: string[] = [];
    let windowLayerCreations = 0;
    let messageWindowCreations = 0;
    context.Utils = { RPGMAKER_NAME: 'MV' };
    context.$gameMessage = { add(message: string) { messages.push(message); } };
    context.Scene_Base.prototype.createWindowLayer = function createWindowLayer(this: any) {
      windowLayerCreations += 1;
      this._windowLayer = {};
    };
    context.Scene_Map = function SceneMap() {};
    context.Scene_Map.prototype.createMessageWindow = function createMessageWindow(this: any) {
      messageWindowCreations += 1;
      this._messageWindow = { engine: 'MV' };
    };
    const activeScene = new context.Scene_Base();
    context.SceneManager._scene = activeScene;
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    scene.nodes[0].events = { onClick: { actions: [{ type: 'showMessage', message: 'first' }, { type: 'showMessage', message: 'second' }] } };
    runtime.mount(scene, { root: activeScene });

    runtime.dispatchActionsForNode(scene.nodes[0], 'onClick', { type: 'pointertap' });

    assert.deepEqual(messages, ['first', 'second']);
    assert.equal(windowLayerCreations, 1);
    assert.equal(messageWindowCreations, 1);
    assert.deepEqual(activeScene._messageWindow, { engine: 'MV' });
    runtime.cleanup();
  });

  test('grafts the official MZ message-scene contract before a show-message action runs', () => {
    const context = makeContext();
    const messages: string[] = [];
    let windowLayerCreations = 0;
    let allWindowCreations = 0;
    context.Utils = { RPGMAKER_NAME: 'MZ' };
    context.$gameMessage = { add(message: string) { messages.push(message); } };
    context.Scene_Base.prototype.createWindowLayer = function createWindowLayer(this: any) {
      windowLayerCreations += 1;
      this._windowLayer = {};
    };
    context.Scene_Message = function SceneMessage() {};
    const messagePrototype = context.Scene_Message.prototype;
    messagePrototype.createAllWindows = function createAllWindows(this: any) {
      allWindowCreations += 1;
      this.createMessageWindow();
      this.createScrollTextWindow();
      this.createGoldWindow();
      this.createNameBoxWindow();
      this.createChoiceListWindow();
      this.createNumberInputWindow();
      this.createEventItemWindow();
      this.associateWindows();
    };
    messagePrototype.createMessageWindow = function createMessageWindow(this: any) { this._messageWindow = { engine: 'MZ' }; };
    messagePrototype.createGoldWindow = function createGoldWindow(this: any) { this._goldWindow = { engine: 'MZ' }; };
    for (const name of ['messageWindowRect', 'createScrollTextWindow', 'scrollTextWindowRect', 'goldWindowRect', 'createNameBoxWindow', 'createChoiceListWindow', 'createNumberInputWindow', 'createEventItemWindow', 'eventItemWindowRect', 'associateWindows']) {
      messagePrototype[name] = function messageSceneContract() {};
    }
    const activeScene = new context.Scene_Base();
    context.SceneManager._scene = activeScene;
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    scene.nodes[0].events = { onClick: { actions: [{ type: 'showMessage', message: 'visible' }] } };
    runtime.mount(scene, { root: activeScene });

    runtime.dispatchActionsForNode(scene.nodes[0], 'onClick', { type: 'pointertap' });

    assert.deepEqual(messages, ['visible']);
    assert.equal(windowLayerCreations, 1);
    assert.equal(allWindowCreations, 1);
    assert.deepEqual(activeScene._messageWindow, { engine: 'MZ' });
    assert.deepEqual(activeScene._goldWindow, { engine: 'MZ' });
    runtime.cleanup();
  });

  test('precompiles nested condition expressions and isolates one bad branch', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    scene.nodes[0].condition = { type: 'and', children: [
      { type: 'switch_on', switchId: 1 },
      { type: 'code', code: 'true' },
    ] };
    scene.nodes[1].condition = { type: 'or', children: [
      { type: 'code', code: '(() => { throw new Error("bad nested condition"); })()' },
      { type: 'code', code: 'true' },
    ] };
    runtime.mount(scene, { root: new context.PIXI.Container(), context: { switches: { 1: true } } });
    assert.equal(runtime.conditionVisibility.root, true);
    runtime.update();
    const errorsAfterFirstUpdate = runtime.errors.length;
    runtime.update();
    assert.equal(runtime.errors.length, errorsAfterFirstUpdate);
    assert.equal(runtime.conditionVisibility.root, true);
    runtime.cleanup();
  });

  test('applies scene filters and enter/exit transitions on the runtime-owned root', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = sceneDocument();
    scene.globalFilter = { blur: 4, glow: 2, preset: '' };
    scene.transitions = { enter: { type: 'fade', duration: 32, easing: 'Linear' }, exit: { type: 'fade', duration: 32, easing: 'Linear' } };
    const root = new context.PIXI.Container();
    runtime.mount(scene, { root, deltaMs: 16 });
    const owned = root.children[0];
    assert.equal(owned.filters.length, 2);
    assert.equal(owned.alpha, 0);
    runtime.update();
    assert.equal(owned.alpha, 0.5);
    runtime.update();
    assert.equal(owned.alpha, 1);
    runtime.startExit();
    runtime.update();
    assert.equal(owned.alpha, 0.5);
    runtime.update();
    assert.equal(owned.alpha, 0);
    runtime.cleanup();
    assert.equal(root.children.length, 0);
  });

  test('renderer host patch returns a canonical world AABB and input uses the mounted ten-node runtime', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    runtime.mount(scene, { root: new context.PIXI.Container() });
    const bounds = runtime.patchNodes([{ nodeId: 'button', props: { x: 48, y: 64, width: 180, rotate: 15 } }]);
    assert.equal(bounds.length, 1);
    assert.deepEqual(
      { x: bounds[0].x, y: bounds[0].y, width: bounds[0].width, rotation: bounds[0].rotation },
      {
        x: 48 - 80 * Math.sin(Math.PI / 12),
        y: 64,
        width: 180 * Math.cos(Math.PI / 12) + 80 * Math.sin(Math.PI / 12),
        rotation: 0,
      },
    );
    assert.equal(runtime.getNodeBounds().length, 10);
    assert.equal(runtime.handleRendererInput({ type: 'pointerdown', nodeId: 'button' }), true);
    assert.equal(runtime.focusedNodeId, 'button');
    assert.equal(runtime.handleRendererInput({ type: 'pointercancel', nodeId: 'button' }), true);
    assert.equal(runtime.focusedNodeId, null);
    runtime.cleanup();
  });

  test('authoring update skips static node props while keeping animated nodes live', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    const progress = scene.nodes.find((node: any) => node.id === 'progressBar');
    progress.props.animateValue = true;
    const root = new context.PIXI.Container();
    runtime.mount(scene, { root, executionMode: 'authoring' });
    let staticXWrites = 0;
    const containerView = runtime.nodeViews.container;
    let containerX = containerView.x;
    Object.defineProperty(containerView, 'x', {
      configurable: true,
      get: () => containerX,
      set: (value) => { staticXWrites += 1; containerX = value; },
    });
    const progressView = runtime.nodeViews.progressBar;
    let progressClears = 0;
    const originalClear = progressView.clear;
    progressView.clear = function (...args: unknown[]) {
      progressClears += 1;
      return originalClear.apply(this, args);
    };
    runtime.update();
    runtime.update();
    assert.equal(staticXWrites, 0);
    assert.ok(progressClears > 0);
    runtime.cleanup();
  });

  test('patch merges local props through the node index and returns only changed bounds', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = allNodeScene();
    runtime.mount(scene, { root: new context.PIXI.Container(), executionMode: 'authoring' });
    scene.nodes.find = () => { throw new Error('patch lookup must use the runtime node index'); };
    const bounds = runtime.patchNodes([
      { nodeId: 'button', props: { x: 48 } },
      { nodeId: 'button', props: { y: 64 } },
    ]);
    assert.equal(bounds.length, 1);
    assert.equal(bounds[0].nodeId, 'button');
    assert.equal(runtime.getNode('button').props.x, 48);
    assert.equal(runtime.getNode('button').props.y, 64);
    runtime.cleanup();
  });

  test('nested nodes keep their canonical scene bounds inside transformed parents', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = nestedBoundsScene();
    runtime.mount(scene, { root: new context.PIXI.Container(), executionMode: 'authoring' });

    const [parent, child] = runtime.getNodeBounds(['parent', 'child']);
    assertWorldBounds(parent, { x: -140, y: 50, width: 240, height: 200 });
    assertWorldBounds(child, { x: 120, y: 70, width: 40, height: 20 });
    assert.equal(child.rotation, 0);
    runtime.cleanup();
  });

  test('world bounds normalize negative scale and preserve anchor in parent space', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = nestedBoundsScene();
    const parent = scene.nodes.find((node: any) => node.id === 'parent');
    const child = scene.nodes.find((node: any) => node.id === 'child');
    parent.props.rotate = 0;
    parent.props.scaleX = -2;
    parent.props.scaleY = 3;
    child.props.x = 130;
    child.props.y = 70;
    child.props.anchorX = 0.5;
    child.props.anchorY = 0.5;
    child.type = 'sprite';
    child.children = [];
    Object.assign(child.props, { path: '', fillMode: 'stretch', repeatMode: 'none', tint: '#ffffff', blendMode: 'normal', scrollX: 0, scrollY: 0 });
    runtime.mount(scene, { root: new context.PIXI.Container(), executionMode: 'authoring' });

    const [bounds] = runtime.getNodeBounds(['child']);
    assertWorldBounds(bounds, { x: 110, y: 60, width: 40, height: 20 });
    assert.ok(bounds.width >= 0);
    assert.ok(bounds.height >= 0);
    runtime.cleanup();
  });

  test('patching a transformed parent returns bounds for every affected descendant', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    const scene = nestedBoundsScene();
    runtime.mount(scene, { root: new context.PIXI.Container(), executionMode: 'authoring' });

    const bounds = runtime.patchNodes([{ nodeId: 'parent', props: { x: 200, scaleX: -1, scaleY: 2, rotate: 0 } }]);
    assert.deepEqual(Array.from(bounds, (entry: any) => entry.nodeId), ['parent', 'child', 'grandchild']);
    assertWorldBounds(bounds.find((entry: any) => entry.nodeId === 'child'), { x: 120, y: 70, width: 40, height: 20 });
    assertWorldBounds(bounds.find((entry: any) => entry.nodeId === 'grandchild'), { x: 130, y: 75, width: 10, height: 5 });
    runtime.cleanup();
  });
});

function makeContext(): Record<string, any> {
  class Container {
    children: any[] = [];
    parent: any = null;
    destroyed = false;
    x = 0;
    y = 0;
    visible = true;
    alpha = 1;
    scale = { x: 1, y: 1 };
    skew = { x: 0, y: 0 };
    rotation = 0;
    width = 0;
    height = 0;
    anchor: { x: number; y: number } | undefined;
    pivot = { x: 0, y: 0 };
    worldTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    addChild(child: any) { this.children.push(child); child.parent = this; return child; }
    addChildAt(child: any, index: number) { this.children.splice(index, 0, child); child.parent = this; return child; }
    removeChild(child: any) { this.children = this.children.filter((entry) => entry !== child); child.parent = null; }
    on() {}
    off() {}
    updateTransform() {
      const cosineX = Math.cos(this.rotation + this.skew.y);
      const sineX = Math.sin(this.rotation + this.skew.y);
      const cosineY = Math.cos(this.rotation - this.skew.x);
      const sineY = Math.sin(this.rotation - this.skew.x);
      const local = {
        a: cosineX * this.scale.x,
        b: sineX * this.scale.x,
        c: -sineY * this.scale.y,
        d: cosineY * this.scale.y,
        tx: this.x - (this.pivot.x * cosineX * this.scale.x - this.pivot.y * sineY * this.scale.y),
        ty: this.y - (this.pivot.x * sineX * this.scale.x + this.pivot.y * cosineY * this.scale.y),
      };
      const parent = this.parent;
      if (parent && typeof parent.updateTransform === 'function') parent.updateTransform();
      const parentWorld = parent && parent.worldTransform;
      this.worldTransform = parentWorld ? {
        a: parentWorld.a * local.a + parentWorld.c * local.b,
        b: parentWorld.b * local.a + parentWorld.d * local.b,
        c: parentWorld.a * local.c + parentWorld.c * local.d,
        d: parentWorld.b * local.c + parentWorld.d * local.d,
        tx: parentWorld.a * local.tx + parentWorld.c * local.ty + parentWorld.tx,
        ty: parentWorld.b * local.tx + parentWorld.d * local.ty + parentWorld.ty,
      } : local;
    }
    getBounds() {
      this.updateTransform();
      const left = -this.width * (this.anchor?.x ?? 0);
      const top = -this.height * (this.anchor?.y ?? 0);
      const points = [[left, top], [left + this.width, top], [left + this.width, top + this.height], [left, top + this.height]].map(([x, y]) => ({
        x: this.worldTransform.a * x + this.worldTransform.c * y + this.worldTransform.tx,
        y: this.worldTransform.b * x + this.worldTransform.d * y + this.worldTransform.ty,
      }));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    destroy() { this.destroyed = true; this.children = []; }
  }
  class Graphics extends Container {
    clear() { return this; }
    beginFill() { return this; }
    drawRect() { return this; }
    drawRoundedRect() { return this; }
    drawCircle() { return this; }
    drawStar() { return this; }
    lineStyle() { return this; }
    endFill() { return this; }
  }
  class NineSlicePlane extends Container {}
  class ParticleContainer extends Container {
    addChild(child: any) {
      if (!(child instanceof Sprite) && !(child instanceof PixiSprite)) throw new TypeError('ParticleContainer only accepts textured Sprite children.');
      return super.addChild(child);
    }
  }
  class PixiSprite extends Container { constructor(public texture?: unknown) { super(); this.anchor = { x: 0, y: 0 }; } }
  class TilingSprite extends PixiSprite { tileScale = { x: 1, y: 1 }; tilePosition = { x: 0, y: 0 }; }
  class WindowBase extends Container {
    contents = { clear() {} };
    drawText() {}
  }
  class Text extends Container { text: string; constructor(text: string) { super(); this.text = text; } }
  class Sprite extends Container { constructor(public bitmap?: unknown) { super(); this.anchor = { x: 0, y: 0 }; } }
  class Filter {
    destroyed = false;
    padding = 0;
    uniforms: Record<string, unknown> = {};
    constructor(public vertex: unknown, public fragment: string) {}
    destroy() { this.destroyed = true; }
  }
  function SceneBase(this: any) { this.children = []; this.parent = null; this.addChild = Container.prototype.addChild; this.removeChild = Container.prototype.removeChild; }
  SceneBase.prototype = Object.create(Container.prototype);
  SceneBase.prototype.constructor = SceneBase;

  const context: Record<string, any> = {
    console,
    URL,
    PIXI: { Container, Graphics, Text, NineSlicePlane, ParticleContainer, Sprite: PixiSprite, TilingSprite, Filter, Point: class { constructor(public x = 0, public y = 0) {} }, Rectangle: class { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {} }, Texture: { from: (value: string) => ({ source: value, baseTexture: { resource: { source: {} } } }) }, filters: { BlurFilter: class { blur = 0 }, GlowFilter: class { distance = 0; destroyed = false; destroy() { this.destroyed = true; } } } },
    Sprite,
    Window_Base: WindowBase,
    Scene_Base: SceneBase,
    Scene_Custom: function SceneCustom() {},
    Scene_Title: function SceneTitle() {},
    PluginManager: { parameters: () => ({ AutoRegister: 'false' }) },
    SceneManager: { pushed: null, push(scene: unknown) { this.pushed = scene; }, goto() {}, exit() {} },
    $gameVariables: { _data: [], setValue(id: number, value: number) { this._data[id] = value; } },
    $gameSwitches: { _data: [], setValue(id: number, value: boolean) { this._data[id] = value; } },
  };
  context.window = context;
  return context;
}

function allNodeScene(): any {
  const base = (id: string, type: string, props: Record<string, unknown> = {}) => ({
    id, type, name: id, parentId: null, children: [], props: {
      x: 0, y: 0, width: 100, height: 80, scaleX: 1, scaleY: 1, rotate: 0, opacity: 255, visible: true, anchorX: 0, anchorY: 0, zIndex: 0, ...props,
    }, propModes: {}, propCodes: {}, condition: { type: 'none' }, conditionFrequency: 'per-frame', enterAnim: { type: 'none', duration: 0 }, exitAnim: { type: 'none', duration: 0 }, focusAnim: { type: 'none', duration: 0 }, events: {},
  });
  return {
    version: '1.1.0', runtimeVersion: '>=1.1.0', meta: { sceneName: 'Scene_AllNodes', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } }, globalFilter: { blur: 0, glow: 0, preset: '' },
    nodes: [
      base('container', 'container', { backgroundPath: 'img/bg.png', backgroundFillMode: 'stretch', backgroundRepeatMode: 'none', clip: false }),
      base('sprite', 'sprite', { path: 'img/a.png', fillMode: 'stretch', repeatMode: 'none', tint: '#ffffff', blendMode: 'normal', scrollX: 0, scrollY: 0 }),
      base('nineSlice', 'nineSlice', { path: 'img/panel.png', borderTop: 4, borderRight: 4, borderBottom: 4, borderLeft: 4, showGuides: false, zIndex: 3 }),
      base('frameAnimation', 'frameAnimation', { defaultFrameDuration: 100, loop: true, speed: 1, initialFrame: 0, frames: [{ id: 'f0', path: 'img/f0.png', duration: 100 }], fillMode: 'contain' }),
      base('button', 'button', { content: 'OK', imageStates: { normal: '', hover: '', pressed: '', disabled: '' }, padding: { top: 0, right: 0, bottom: 0, left: 0 }, align: 'center' }),
      base('text', 'text', { content: 'Hello', fontSize: 24, fontWeight: 'normal', italic: false, textColor: '#fff', strokeColor: '#000', strokeWidth: 0, wrapWidth: 0, letterSpacing: 0, align: 'left', verticalAlign: 'top', padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
      base('progressBar', 'progressBar', { trackColor: '#444444', fillColor: '#66ccaa', fillDirection: 'leftToRight', currentValue: 1, maxValue: 2, trackRadius: 0, fillRadius: 0, animateValue: false }),
      base('overlay', 'overlay', { fillColor: '#000000', clickThrough: true }),
      base('video', 'video', { path: 'movies/a.webm', autoplay: false, loop: true, muted: true, playbackRate: 1, posterPath: '' }),
      base('particle', 'particle', { maxParticles: 1, emissionInterval: 100, emissionArea: 'point', imagePath: 'img/p.png', shape: 'circle', velocityX: 0, velocityY: 1, gravityX: 0, gravityY: 0, lifetime: 100, lifetimeRandom: 0, startScale: 1, endScale: 1, startOpacity: 255, endOpacity: 0, startColor: '#fff', endColor: '#000', blendMode: 'normal', glow: 0 }),
    ],
    zOrder: ['container', 'sprite', 'nineSlice', 'frameAnimation', 'button', 'text', 'progressBar', 'overlay', 'video', 'particle'],
    sceneScript: sceneScript(),
  };
}

function nestedBoundsScene(): any {
  const base = (id: string, type: string, parentId: string | null, children: string[], props: Record<string, unknown>) => ({
    id,
    type,
    name: id,
    parentId,
    children,
    props: {
      x: 0, y: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, rotate: 0,
      opacity: 255, visible: true, anchorX: 0, anchorY: 0, zIndex: 0,
      ...(type === 'container' ? { backgroundPath: '', backgroundFillMode: 'stretch', backgroundRepeatMode: 'none', clip: false } : {}),
      ...(type === 'overlay' ? { fillColor: '#ffffff', clickThrough: false } : {}),
      ...props,
    },
    propModes: {},
    propCodes: {},
    condition: { type: 'none' },
    conditionFrequency: 'per-frame',
    enterAnim: { type: 'none', duration: 0 },
    exitAnim: { type: 'none', duration: 0 },
    events: {},
  });
  return {
    version: '1.1.0',
    runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_NestedBounds', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' },
    nodes: [
      base('parent', 'container', null, ['child'], { x: 100, y: 50, width: 100, height: 80, scaleX: 2, scaleY: 3, rotate: 90 }),
      base('child', 'container', 'parent', ['grandchild'], { x: 120, y: 70, width: 40, height: 20 }),
      base('grandchild', 'overlay', 'child', [], { x: 130, y: 75, width: 10, height: 5 }),
    ],
    zOrder: ['parent'],
    sceneScript: sceneScript(),
  };
}

function assertWorldBounds(actual: any, expected: { x: number; y: number; width: number; height: number }): void {
  assert.ok(actual);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-7, `${key}: expected ${expected[key]}, received ${actual[key]}`);
  }
}

function sceneDocument(): any {
  return {
    version: '1.1.0',
    runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Custom', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 },
    nodes: [
      {
        id: 'root', type: 'container', name: 'Root', parentId: null, children: ['child'],
        props: { x: 100, y: 40, width: 300, height: 200, scaleX: 1, scaleY: 1, rotate: 0, opacity: 255, visible: true, anchorX: 0, anchorY: 0, zIndex: 0, backgroundPath: '', backgroundFillMode: 'stretch', backgroundRepeatMode: 'none', clip: false },
        propModes: {}, propCodes: {}, condition: { type: 'none' }, enterAnim: { type: 'none', duration: 0 }, exitAnim: { type: 'none', duration: 0 },
        events: { onClick: { actions: [{ type: 'script', code: 'this.setNodeProp("child", "opacity", 200);' }, { type: 'showMessage', message: 'clicked' }] } },
      },
      {
        id: 'child', type: 'text', name: 'Child', parentId: 'root', children: [],
        props: { x: 150, y: 70, width: 100, height: 20, scaleX: 1, scaleY: 1, rotate: 0, opacity: 255, visible: true, anchorX: 0, anchorY: 0, zIndex: 0, content: 'Child', wrapWidth: 0, richText: false, fontFile: '', fontSize: 24, fontWeight: 'normal', italic: false, letterSpacing: 0, textColor: '#fff', strokeColor: '#000', strokeWidth: 0, shadowColor: '#0000', shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, align: 'left', verticalAlign: 'top', backgroundColor: '#0000', padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        propModes: {}, propCodes: {}, condition: { type: 'switch_on', switchId: 1 }, enterAnim: { type: 'none', duration: 0 }, exitAnim: { type: 'fadeOut', duration: 100 }, events: {},
      },
    ],
    zOrder: ['root'],
    transitions: { enter: { type: 'fade', duration: 300 }, exit: { type: 'fade', duration: 300 } },
    globalFilter: { blur: 0, glow: 0, preset: '' },
    sceneScript: sceneScript('this.setNodeProp("child", "opacity", 128);'),
  };
}

function sceneScript(ready = '', update = ''): { version: '1.1.0'; source: string } {
  return { version: '1.1.0', source: migrateLegacyUiSourceCode({ ready, update }) };
}

/** vm-context objects carry a foreign Object prototype; normalize before deepEqual. */
function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function assertEngineWindowTextSignature(engine: 'MV' | 'MZ'): void {
  const context = makeContext();
  const bitmapCalls: unknown[][] = [];
  const bitmapFont: Record<string, unknown> = {};
  class EngineBitmap {
    clear() {}
    measureTextWidth(text: string) { return String(text).length * 10; }
    drawText(...args: unknown[]) { bitmapCalls.push(args); }
  }
  for (const key of ['fontFace', 'fontSize', 'fontBold', 'fontItalic', 'textColor', 'outlineColor', 'outlineWidth']) {
    Object.defineProperty(EngineBitmap.prototype, key, {
      get() { return bitmapFont[key]; },
      set(value: unknown) { bitmapFont[key] = value; },
      configurable: true,
    });
  }
  class EngineWindow extends context.PIXI.Container {
    contents = new EngineBitmap();
    constructor(..._args: unknown[]) { super(); }
    standardPadding() { return 18; }
  }
  context.Window_Base = EngineWindow;
  context.Utils = { RPGMAKER_NAME: engine };
  // MZ exposes the main font through $gameSystem; MV falls through to the
  // engine Bitmap defaults probe, exactly like the real engines.
  if (engine === 'MZ') {
    context.$gameSystem = { mainFontFace: () => 'rmmz-mainfont, sans-serif', mainFontSize: () => 26 };
  }
  context.Bitmap = class {
    fontFace = 'GameFont';
    fontSize = 28;
    textColor = '#ffffff';
    outlineColor = 'rgba(0, 0, 0, 0.5)';
    outlineWidth = engine === 'MZ' ? 3 : 4;
  };
  vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-${engine}-drawText.js` });
  const runtime = context.MZUIRuntime.create();
  const scene = allNodeScene();
  const button = scene.nodes.find((node: any) => node.type === 'button');
  const text = scene.nodes.find((node: any) => node.type === 'text');
  button.props.content = 'OK\nGO';
  button.props.textColor = '#fff';
  text.props.content = 'line one\nline two';
  text.props.wrapWidth = 40;
  text.props.align = 'right';
  runtime.mount(scene, { root: new context.PIXI.Container() });
  runtime.update();

  const expectedFace = engine === 'MZ' ? 'rmmz-mainfont, sans-serif' : 'GameFont';
  const expectedSize = engine === 'MZ' ? 26 : 28;
  const expectedOutlineWidth = engine === 'MZ' ? 3 : 4;
  // Button label: designer props applied onto the native window profile and
  // drawn once inside the 100x80 window's 18px-padded content area.
  assert.equal(bitmapFont.fontFace, expectedFace);
  assert.equal(bitmapFont.fontSize, expectedSize);
  assert.equal(bitmapFont.textColor, '#fff');
  assert.equal(bitmapFont.outlineColor, 'rgba(0, 0, 0, 0.5)');
  assert.equal(bitmapFont.outlineWidth, expectedOutlineWidth);
  assert.equal(bitmapFont.fontBold, false);
  const lineHeight = Math.ceil(expectedSize * 1.3);
  const contentHeight = 80 - 18 * 2;
  const centeredTop = Math.round(Math.max(0, (contentHeight - lineHeight) / 2));
  assert.deepEqual(bitmapCalls[0], ['OK GO', 0, centeredTop, 100 - 18 * 2, lineHeight, 'center']);
  assert.equal(bitmapCalls.every((args) => args.length === 6 && typeof args[5] === 'string'), true);
  // Plain text node: same native family, size and outline defaults.
  assert.equal(runtime.nodeViews.text.style.fontFamily, expectedFace);
  assert.equal(runtime.nodeViews.text.style.stroke, 'rgba(0, 0, 0, 0.5)');
  assert.equal(runtime.nodeViews.text.style.strokeThickness, expectedOutlineWidth);
  assert.equal(runtime.nodeViews.text.text, 'line one line two');
  // wrapWidth enables PIXI word wrap at that width (with mid-word breaks for CJK).
  assert.equal(runtime.nodeViews.text.style.wordWrap, true);
  assert.equal(runtime.nodeViews.text.style.wordWrapWidth, 40);
  assert.equal(runtime.nodeViews.text.style.breakWords, true);
  assert.equal(runtime.nodeViews.text.scale.x < 1, true);
  assert.equal(runtime.nodeViews.text.style.align, 'right');
  assert.equal(runtime.nodeViews.progressBar.__mzuiAnimatedRatio, 0.5);
  runtime.cleanup();
}
