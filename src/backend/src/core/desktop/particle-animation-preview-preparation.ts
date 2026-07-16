import fs from 'node:fs';
import path from 'node:path';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import {
  type IsolatedProjectPreparation,
  prepareIsolatedStagedProject,
} from './isolated-project-preparation.ts';
import { RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS } from './rpg-maker-mz-runtime.ts';
import { getProjectFileForRead } from './staging-service.ts';

export interface ParticleAnimationPreviewPreparation extends IsolatedProjectPreparation {
  engine: Extract<RpgMakerEngine, 'rpg-maker-mz'>;
  appDirectory: string;
  effectName: string;
}

export interface ParticleAnimationPreviewPreparationDependencies {
  prepareIsolated: typeof prepareIsolatedStagedProject;
  getEffectiveFile: typeof getProjectFileForRead;
}

export class ParticleAnimationPreviewPreparationError extends Error {}

const REQUIRED_PREVIEW_FILES = [
  'js/libs/pixi.js',
  'js/libs/pako.min.js',
  'js/libs/localforage.min.js',
  'js/libs/effekseer.min.js',
  'js/libs/effekseer.wasm',
  'js/rmmz_core.js',
  'js/rmmz_managers.js',
  'js/rmmz_objects.js',
  'js/rmmz_scenes.js',
  'js/rmmz_sprites.js',
  'js/rmmz_windows.js',
] as const;

const PREVIEW_AUDIO_DECODER = 'js/libs/vorbisdecoder.js';

const COPY_EXCLUSIONS = [
  ...RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS,
  'audio',
  'css',
  'data',
  'effects',
  'fonts',
  'icon',
  'img',
  'js/plugins',
  'movies',
] as const;

export function prepareParticleAnimationPreview(
  workflowRoot: string,
  project: string,
  animationInput: InteractiveParticleAnimationPreview,
  dependencies: Partial<ParticleAnimationPreviewPreparationDependencies> = {},
): ParticleAnimationPreviewPreparation {
  const manifest = inspectRmmvProject(project);
  if (!manifest.editable || manifest.engine !== 'rpg-maker-mz') {
    throw new ParticleAnimationPreviewPreparationError('Particle animation preview requires an editable RPG Maker MZ project.');
  }

  const animation = validatePreviewAnimation(animationInput, manifest.screenWidth, manifest.screenHeight);
  const prepareIsolated = dependencies.prepareIsolated || prepareIsolatedStagedProject;
  const getEffectiveFile = dependencies.getEffectiveFile || getProjectFileForRead;
  const isolated = prepareIsolated(workflowRoot, project, {
    temporaryPrefix: 'rpg-agent-mz-particle-preview-',
    excludeRelativePaths: COPY_EXCLUSIONS,
  });
  const appDirectory = path.join(isolated.temporaryProject, 'particle-preview');

  try {
    fs.rmSync(appDirectory, { recursive: true, force: true });
    fs.mkdirSync(appDirectory, { recursive: true });
    const usesAudio = animation.soundTimings.some((timing) => Boolean(timing.se.name));
    const requiredFiles = usesAudio
      ? [...REQUIRED_PREVIEW_FILES, PREVIEW_AUDIO_DECODER]
      : REQUIRED_PREVIEW_FILES;
    for (const relative of requiredFiles) {
      copyRequiredFile(path.join(manifest.resourceRoot, ...relative.split('/')), confinedPath(appDirectory, relative), relative);
    }

    copyEffectiveAsset(
      workflowRoot,
      project,
      getEffectiveFile,
      `effects/${animation.effectName}`,
      ['.efkefc'],
      appDirectory,
    );
    for (const timing of animation.soundTimings) {
      if (!timing.se.name) continue;
      copyEffectiveAsset(
        workflowRoot,
        project,
        getEffectiveFile,
        `audio/se/${timing.se.name}`,
        ['.ogg', '.m4a'],
        appDirectory,
      );
    }

    const config = {
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      animation,
    };
    fs.writeFileSync(path.join(appDirectory, 'index.html'), previewHtml(config), 'utf8');
    fs.writeFileSync(path.join(appDirectory, 'package.json'), `${JSON.stringify(previewPackage(manifest.screenWidth, manifest.screenHeight), null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(appDirectory, 'js', 'main.js'), previewMainSource(usesAudio), 'utf8');
    fs.writeFileSync(path.join(appDirectory, 'js', 'particle-preview.js'), PREVIEW_RUNTIME_SOURCE, 'utf8');

    return {
      ...isolated,
      engine: 'rpg-maker-mz',
      appDirectory,
      effectName: animation.effectName,
    };
  } catch (error) {
    try { fs.rmSync(isolated.temporaryProject, { recursive: true, force: true }); } catch { /* Report the preparation error first. */ }
    throw error;
  }
}

export function validatePreviewAnimation(
  input: InteractiveParticleAnimationPreview,
  screenWidth: number,
  screenHeight: number,
): InteractiveParticleAnimationPreview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ParticleAnimationPreviewPreparationError('Particle animation preview data must be an object.');
  }
  const effectName = normalizeResourceName(input.effectName, 'particle effect');
  const rotation = requireRecord(input.rotation, 'rotation');
  const flashTimings = requireArray(input.flashTimings, 'flashTimings').map((entry, index) => {
    const timing = requireRecord(entry, `flashTimings[${index}]`);
    const color = requireArray(timing.color, `flashTimings[${index}].color`);
    if (color.length !== 4) {
      throw new ParticleAnimationPreviewPreparationError(`flashTimings[${index}].color must contain exactly four channels.`);
    }
    return {
      frame: requireInteger(timing.frame, 0, 99999, `flashTimings[${index}].frame`),
      duration: requireInteger(timing.duration, 1, 99999, `flashTimings[${index}].duration`),
      color: color.map((channel, channelIndex) => requireInteger(
        channel,
        0,
        255,
        `flashTimings[${index}].color[${channelIndex}]`,
      )),
    };
  });
  const soundTimings = requireArray(input.soundTimings, 'soundTimings').map((entry, index) => {
    const timing = requireRecord(entry, `soundTimings[${index}]`);
    const se = requireRecord(timing.se, `soundTimings[${index}].se`);
    return {
      frame: requireInteger(timing.frame, 0, 99999, `soundTimings[${index}].frame`),
      se: {
        name: normalizeResourceName(se.name, `soundTimings[${index}].se.name`, true),
        volume: requireInteger(se.volume, 0, 100, `soundTimings[${index}].se.volume`),
        pitch: requireInteger(se.pitch, 50, 150, `soundTimings[${index}].se.pitch`),
        pan: requireInteger(se.pan, -100, 100, `soundTimings[${index}].se.pan`),
      },
    };
  });
  return {
    displayType: requireInteger(input.displayType, 0, 2, 'displayType'),
    effectName,
    scale: requireInteger(input.scale, 1, 1000, 'scale'),
    speed: requireInteger(input.speed, 1, 1000, 'speed'),
    offsetX: requireInteger(input.offsetX, -screenWidth, screenWidth, 'offsetX'),
    offsetY: requireInteger(input.offsetY, -screenHeight, screenHeight, 'offsetY'),
    rotation: {
      x: requireInteger(rotation.x, -360, 360, 'rotation.x'),
      y: requireInteger(rotation.y, -360, 360, 'rotation.y'),
      z: requireInteger(rotation.z, -360, 360, 'rotation.z'),
    },
    alignBottom: requireBoolean(input.alignBottom, 'alignBottom'),
    flashTimings,
    soundTimings,
  };
}

function copyEffectiveAsset(
  workflowRoot: string,
  project: string,
  getEffectiveFile: typeof getProjectFileForRead,
  relativeWithoutExtension: string,
  extensions: readonly string[],
  appDirectory: string,
): void {
  const normalized = normalizeRelative(relativeWithoutExtension);
  for (const extension of extensions) {
    const relative = `${normalized}${extension}`;
    const source = getEffectiveFile(workflowRoot, project, relative);
    if (!source || !isFile(source)) continue;
    copyRequiredFile(source, confinedPath(appDirectory, relative), relative);
    return;
  }
  throw new ParticleAnimationPreviewPreparationError(`Required preview resource was not found: ${normalized}`);
}

function copyRequiredFile(source: string, target: string, label: string): void {
  if (!isFile(source)) throw new ParticleAnimationPreviewPreparationError(`Required MZ preview runtime file is missing: ${label}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function confinedPath(root: string, relative: string): string {
  const normalized = normalizeRelative(relative);
  if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new ParticleAnimationPreviewPreparationError(`Unsafe preview path: ${relative}`);
  }
  const base = path.resolve(root);
  const target = path.resolve(base, ...normalized.split('/'));
  const relation = path.relative(base, target);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new ParticleAnimationPreviewPreparationError(`Unsafe preview path: ${relative}`);
  }
  return target;
}

function normalizeResourceName(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new ParticleAnimationPreviewPreparationError(`${label} must be a string.`);
  const normalized = normalizeRelative(value.trim());
  if (!normalized && allowEmpty) return '';
  if (!normalized || normalized.startsWith('../') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ParticleAnimationPreviewPreparationError(`${label} must be a safe project-relative resource name.`);
  }
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) {
    throw new ParticleAnimationPreviewPreparationError(`${label} must be a safe project-relative resource name.`);
  }
  if (/\.(?:efkefc|ogg|m4a)$/i.test(normalized)) {
    throw new ParticleAnimationPreviewPreparationError(`${label} must not include a file extension.`);
  }
  return normalized;
}

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ParticleAnimationPreviewPreparationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ParticleAnimationPreviewPreparationError(`${label} must be an array.`);
  return value;
}

function requireInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ParticleAnimationPreviewPreparationError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return number;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ParticleAnimationPreviewPreparationError(`${label} must be boolean.`);
  return value;
}

function previewPackage(screenWidth: number, screenHeight: number): Record<string, unknown> {
  return {
    name: 'rpg-agent-mz-particle-preview',
    main: 'index.html',
    window: {
      title: 'RPG Maker MZ Particle Preview',
      width: screenWidth,
      height: screenHeight,
      position: 'center',
      resizable: true,
    },
  };
}

function previewHtml(config: Record<string, unknown>): string {
  const serialized = JSON.stringify(config).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="user-scalable=no">
  <title>RPG Maker MZ Particle Preview</title>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171411}canvas{image-rendering:pixelated}</style>
</head>
<body>
  <script>window.__RPG_AGENT_PARTICLE_PREVIEW__=${serialized};</script>
  <script src="js/main.js"></script>
</body>
</html>
`;
}

function previewMainSource(usesAudio: boolean): string {
  const scripts = [
    'js/libs/pixi.js',
    'js/libs/pako.min.js',
    'js/libs/localforage.min.js',
    'js/libs/effekseer.min.js',
    ...(usesAudio ? [PREVIEW_AUDIO_DECODER] : []),
    'js/rmmz_core.js',
    'js/rmmz_managers.js',
    'js/rmmz_objects.js',
    'js/rmmz_scenes.js',
    'js/rmmz_sprites.js',
    'js/rmmz_windows.js',
    'js/particle-preview.js',
  ];
  return PREVIEW_MAIN_SOURCE.replace('__RPG_AGENT_PREVIEW_SCRIPTS__', JSON.stringify(scripts));
}

const PREVIEW_MAIN_SOURCE = `"use strict";
(() => {
  const scripts = __RPG_AGENT_PREVIEW_SCRIPTS__;

  function showError(error) {
    const message = error && error.message ? error.message : String(error);
    document.body.innerHTML = "";
    const panel = document.createElement("pre");
    panel.style.cssText = "box-sizing:border-box;margin:24px;padding:18px;color:#f5d7cf;background:#341f1b;border:1px solid #9c4d3c;white-space:pre-wrap;font:14px/1.5 sans-serif";
    panel.textContent = "Particle preview failed: " + message;
    document.body.appendChild(panel);
    console.error(error);
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load " + url));
      document.body.appendChild(script);
    });
  }

  async function start() {
    try {
      if (typeof nw === "object") nw.Window.get().on("close", () => nw.App.quit());
      for (const url of scripts) await loadScript(url);
      await new Promise((resolve, reject) => {
        effekseer.initRuntime("js/libs/effekseer.wasm", resolve, () => reject(new Error("Effekseer runtime initialization failed.")));
      });
      window.RpgAgentParticlePreview.run();
    } catch (error) {
      showError(error);
    }
  }

  window.addEventListener("error", event => showError(event.error || event.message));
  window.addEventListener("unhandledrejection", event => showError(event.reason));
  window.addEventListener("load", start, { once: true });
})();
`;

const PREVIEW_RUNTIME_SOURCE = `"use strict";
window.RpgAgentParticlePreview = {
  run() {
    const config = window.__RPG_AGENT_PARTICLE_PREVIEW__;
    if (!config || !config.animation) throw new Error("Preview configuration is missing.");
    if (!Graphics.initialize()) throw new Error("Failed to initialize MZ graphics.");
    Graphics.resize(config.screenWidth, config.screenHeight);
    Graphics.boxWidth = config.screenWidth;
    Graphics.boxHeight = config.screenHeight;
    WebAudio.initialize();

    const stage = new Stage();
    const backgroundBitmap = new Bitmap(config.screenWidth, config.screenHeight);
    backgroundBitmap.gradientFillRect(0, 0, config.screenWidth, config.screenHeight, "#171411", "#2c2721", true);
    const background = new Sprite(backgroundBitmap);
    stage.addChild(background);

    const targetBitmap = new Bitmap(128, 128);
    targetBitmap.drawCircle(64, 64, 42, "#d4c3a6");
    targetBitmap.drawCircle(64, 64, 34, "#5d554a");
    const target = new Sprite(targetBitmap);
    target.anchor.set(0.5, 1);
    target.x = Math.round(config.screenWidth / 2);
    target.y = Math.round(config.screenHeight * 0.68);
    stage.addChild(target);

    let animationSprite = null;
    let replayDelay = 0;
    const play = () => {
      if (animationSprite) {
        stage.removeChild(animationSprite);
        animationSprite.destroy();
      }
      target.setBlendColor([0, 0, 0, 0]);
      animationSprite = new Sprite_Animation();
      animationSprite.setup([target], config.animation, false, 0, null);
      stage.addChild(animationSprite);
    };
    play();

    Graphics.setStage(stage);
    Graphics.setTickHandler(() => {
      Graphics.frameCount++;
      if (Graphics.effekseer) Graphics.effekseer.update();
      if (animationSprite && animationSprite.isPlaying()) {
        animationSprite.update();
      } else if (++replayDelay >= 45) {
        replayDelay = 0;
        play();
      }
    });
    Graphics.startGameLoop();
  }
};
`;

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}
