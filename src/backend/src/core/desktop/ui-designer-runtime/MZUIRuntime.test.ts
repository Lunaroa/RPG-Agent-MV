import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
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

  test('binds SceneManager push and refuses native scene replacement', () => {
    const context = makeContext();
    vm.runInNewContext(RUNTIME_SOURCE, context, { filename: 'MZUIRuntime.js' });
    const runtime = context.MZUIRuntime.create();
    runtime.mount(sceneDocument(), { root: new context.PIXI.Container() });
    runtime.runAction({ type: 'gotoScene', sceneName: 'Scene_Custom' }, sceneDocument().nodes[0], { type: 'pointertap' });
    assert.equal(context.SceneManager.pushed, context.Scene_Custom);
    assert.throws(() => context.MZUIRuntime.registerScene('Scene_Title', 'Scene_Base', sceneDocument()), /already owned/);
  });

  test('scans deterministic scene files from MV www and MZ roots', () => {
    for (const layout of ['mv-www', 'mz-root']) {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-scan-'));
      try {
        const engineRoot = layout === 'mv-www' ? path.join(project, 'www') : project;
        fs.mkdirSync(path.join(engineRoot, 'js', 'plugins', 'mzui-data'), { recursive: true });
        if (layout === 'mv-www') fs.mkdirSync(path.join(engineRoot, 'data'), { recursive: true });
        for (const sceneName of ['Scene_Beta', 'Scene_Alpha']) {
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
        context.PluginManager.parameters = () => ({ AutoRegister: 'true' });
        context.process = { cwd: () => project };
        context.require = nodeRequire;
        vm.runInNewContext(RUNTIME_SOURCE, context, { filename: `MZUIRuntime-${layout}.js` });
        assert.equal(typeof context.Scene_Alpha, 'function');
        assert.equal(typeof context.Scene_Beta, 'function');
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
    assert.equal(runtime.nodeViews.text.style.fontSize, 24);
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
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => name === 'a.png' ? { throwNode: true } : {} };
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
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => ({ baseTexture: { id: name } }) };
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
    context.ImageManager = { loadBitmap: (_folder: string, name: string) => name === 'panel.png'
      ? { baseTexture: null, addLoadListener(callback: () => void) { finishLoad = () => { this.baseTexture = { id: name }; callback(); }; } }
      : { baseTexture: { id: name } } };
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
            const callbacks = pending.get(name) || [];
            callbacks.push({ bitmap, callback });
            pending.set(name, callbacks);
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
    assert.equal((runtime.nodeViews.sprite.texture as any).id, 'a.png');
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
        'onReady(function () { sharedCount += 1; lateRegister = onUpdate; this.__lateRegister = lateRegister; this.__readyScene = this; this.__readyNode = this.nodes.Child; });',
        'onUpdate(function () { sharedCount += 1; this.__updateScene = this; this.__sharedCount = sharedCount; });',
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
    instance.terminate();
    assert.throws(() => instance.__lateRegister(function () {}), /only be called synchronously/);
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
      'this.__abiUpdate = [self === scene, $sw(2), $var(3)];',
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
    assert.equal(instance._mzuiRuntime.scene.nodes[1].props.x, 9);
    assert.equal(instance.__abiAction[0], true);
    assert.equal(instance.__abiAction[1], 8);
    assert.equal(instance.__abiAction[2], true);
    assert.equal(context.$gameSwitches._data[2], true);
    assert.equal(context.$gameVariables._data[3], 8);
    instance.terminate();
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
});

function makeContext(): Record<string, any> {
  class Container {
    children: any[] = [];
    parent: any = null;
    x = 0;
    y = 0;
    visible = true;
    alpha = 1;
    scale = { x: 1, y: 1 };
    rotation = 0;
    addChild(child: any) { this.children.push(child); child.parent = this; return child; }
    addChildAt(child: any, index: number) { this.children.splice(index, 0, child); child.parent = this; return child; }
    removeChild(child: any) { this.children = this.children.filter((entry) => entry !== child); child.parent = null; }
    on() {}
    off() {}
    destroy() { this.children = []; }
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
  class ParticleContainer extends Container {}
  class PixiSprite extends Container { constructor(public texture?: unknown) { super(); } }
  class TilingSprite extends PixiSprite { tileScale = { x: 1, y: 1 }; tilePosition = { x: 0, y: 0 }; }
  class WindowBase extends Container {
    contents = { clear() {} };
    drawText() {}
  }
  class Text extends Container { text: string; constructor(text: string) { super(); this.text = text; } }
  class Sprite extends Container { constructor(public bitmap?: unknown) { super(); } }
  function SceneBase(this: any) { this.children = []; this.parent = null; this.addChild = Container.prototype.addChild; this.removeChild = Container.prototype.removeChild; }
  SceneBase.prototype = Object.create(Container.prototype);
  SceneBase.prototype.constructor = SceneBase;

  const context: Record<string, any> = {
    console,
    URL,
    PIXI: { Container, Graphics, Text, NineSlicePlane, ParticleContainer, Sprite: PixiSprite, TilingSprite, Texture: { from: (value: string) => ({ source: value, baseTexture: { resource: { source: {} } } }) }, filters: { BlurFilter: class { blur = 0 }, GlowFilter: class { distance = 0 } } },
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
    }, propModes: {}, propCodes: {}, condition: { type: 'none' }, conditionFrequency: 'per-frame', enterAnim: { type: 'none', duration: 0 }, exitAnim: { type: 'none', duration: 0 }, events: {},
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

function sceneScript(ready = '', update = ''): { version: '1.0.0'; source: string } {
  return { version: '1.0.0', source: migrateLegacyUiSourceCode({ ready, update }) };
}
