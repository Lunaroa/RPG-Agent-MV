import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import {
  type IsolatedProjectPreparation,
  prepareIsolatedStagedProject,
  removeTemporaryProjectTreeSafely,
} from './isolated-project-preparation.ts';
import { RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS } from './rpg-maker-mz-runtime.ts';
import { getProjectFileForRead } from './staging-service.ts';

export interface ParticleAnimationPreviewPreparation extends IsolatedProjectPreparation {
  engine: Extract<RpgMakerEngine, 'rpg-maker-mz'>;
  appDirectory: string;
  effectName: string;
}

export interface ParticleAnimationPreviewAppPreparation {
  engine: Extract<RpgMakerEngine, 'rpg-maker-mz'>;
  appDirectory: string;
  effectName: string;
  /** Project screen resolution; offscreen capture hosts size their window to this. */
  screenWidth: number;
  screenHeight: number;
  /** Serve-direct root for everything the preview loads from the game project. */
  passthroughRoot: string;
  passthroughPrefixes: readonly string[];
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

// Everything the generated preview page loads from the game project; served
// straight from the project tree so no project copy is needed per session.
const PREVIEW_PASSTHROUGH_PREFIXES = [
  'js/libs/',
  'js/rmmz_',
  'effects/',
  'audio/se/',
  'img/battlebacks1/',
  'img/battlebacks2/',
  'img/enemies/',
  'img/sv_enemies/',
] as const;

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

/** Frames of active playback the capture runtime advances before freezing the representative frame. */
export const DEFAULT_EFFECT_CAPTURE_FRAME_COUNT = 12;

/**
 * document.title the capture runtime sets once the representative frame is frozen
 * and ready for capturePage. Must match the literal embedded in PREVIEW_RUNTIME_SOURCE.
 */
export const EFFECT_CAPTURE_READY_TITLE = '__RPG_AGENT_EFFECT_CAPTURE_READY__';

export interface ParticleAnimationPreviewOptions {
  /**
   * false prepares an idle backdrop scene (battle background, no playback) so the
   * embedding panel never shows an empty black frame; the effect and audio assets
   * are only required when the scene actually plays.
   */
  autoplay?: boolean;
  /**
   * Backdrop-with-effect: prepares the idle scene (autoplay false) but still overlays
   * the effect/audio and keeps the animation ready, so the embedding panel can start
   * playback in-place via a postMessage 'play' command without reloading the iframe.
   */
  armed?: boolean;
  /**
   * When > 0, prepares an offscreen capture session: forces autoplay, drops the
   * battle background for a clean frame, and injects the number of played frames
   * the runtime advances before freezing on a representative frame and signalling
   * readiness via document.title. Backend-internal (not part of the IPC contract).
   */
  captureFrameCount?: number;
}

export function prepareParticleAnimationPreview(
  workflowRoot: string,
  project: string,
  animationInput: InteractiveParticleAnimationPreview,
  options: ParticleAnimationPreviewOptions = {},
  dependencies: Partial<ParticleAnimationPreviewPreparationDependencies> = {},
): ParticleAnimationPreviewPreparation {
  const manifest = inspectRmmvProject(project);
  if (!manifest.editable || manifest.engine !== 'rpg-maker-mz') {
    throw new ParticleAnimationPreviewPreparationError('Particle animation preview requires an editable RPG Maker MZ project.');
  }

  const autoplay = options.autoplay !== false;
  const animation = validatePreviewAnimation(animationInput, manifest.screenWidth, manifest.screenHeight, { requireEffect: autoplay });
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

    // Backdrop sessions never play, so the effect and sound assets are not needed.
    if (autoplay) {
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
    }
    const battlebacks = copyEditorBattlebacks(workflowRoot, project, getEffectiveFile, appDirectory);

    const config = {
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      autoplay,
      battleback1: battlebacks.battleback1,
      battleback2: battlebacks.battleback2,
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
    try { removeTemporaryProjectTreeSafely(isolated.temporaryProject); } catch { /* Report the preparation error first. */ }
    throw error;
  }
}

/**
 * In-panel preview variant: builds only the tiny generated app (index.html plus two
 * scripts) and serves every game asset directly from the project through the preview
 * protocol's pass-through prefixes. No project fingerprint and no project copy, so
 * preparing stays cheap on multi-gigabyte projects; staged drafts of the referenced
 * assets are overlaid into the app directory, which wins over the pass-through root.
 */
export function prepareParticleAnimationPreviewApp(
  workflowRoot: string,
  project: string,
  animationInput: InteractiveParticleAnimationPreview,
  options: ParticleAnimationPreviewOptions = {},
  dependencies: Partial<ParticleAnimationPreviewPreparationDependencies> = {},
): ParticleAnimationPreviewAppPreparation {
  const manifest = inspectRmmvProject(project);
  if (!manifest.editable || manifest.engine !== 'rpg-maker-mz') {
    throw new ParticleAnimationPreviewPreparationError('Particle animation preview requires an editable RPG Maker MZ project.');
  }

  const capturing = typeof options.captureFrameCount === 'number' && options.captureFrameCount > 0;
  // Armed backdrops load the effect but wait for a 'play' message; used by the detail
  // dialog so playback starts in-place with no iframe reload.
  const armed = !capturing && options.armed === true;
  const autoplay = capturing ? true : options.autoplay !== false;
  const requireEffect = autoplay || armed;
  const animation = validatePreviewAnimation(animationInput, manifest.screenWidth, manifest.screenHeight, { requireEffect });
  const getEffectiveFile = dependencies.getEffectiveFile || getProjectFileForRead;
  const appDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-mz-particle-preview-'));

  try {
    const usesAudio = animation.soundTimings.some((timing) => Boolean(timing.se.name));
    const requiredFiles = usesAudio
      ? [...REQUIRED_PREVIEW_FILES, PREVIEW_AUDIO_DECODER]
      : REQUIRED_PREVIEW_FILES;
    for (const relative of requiredFiles) {
      if (!isFile(path.join(manifest.resourceRoot, ...relative.split('/')))) {
        throw new ParticleAnimationPreviewPreparationError(`Required MZ preview runtime file is missing: ${relative}`);
      }
    }

    // Plain backdrops never play, so the effect and sound assets are only overlaid
    // when the scene will play (autoplay) or is armed to play on demand.
    if (requireEffect) {
      overlayEffectiveAsset(
        workflowRoot,
        project,
        manifest.resourceRoot,
        getEffectiveFile,
        `effects/${animation.effectName}`,
        ['.efkefc'],
        appDirectory,
      );
      for (const timing of animation.soundTimings) {
        if (!timing.se.name) continue;
        overlayEffectiveAsset(
          workflowRoot,
          project,
          manifest.resourceRoot,
          getEffectiveFile,
          `audio/se/${timing.se.name}`,
          ['.ogg', '.m4a'],
          appDirectory,
        );
      }
    }
    // Capture sessions drop the battle background so the representative frame is a
    // clean effect over the runtime's neutral gradient.
    const battlebacks = capturing
      ? { battleback1: '', battleback2: '' }
      : resolveEditorBattlebacks(workflowRoot, project, manifest.resourceRoot, getEffectiveFile, appDirectory);
    // Interactive sessions target the project's first enemy battler (front/side per
    // System.json); capture keeps the target hidden so it never resolves an enemy.
    const enemyBattler = capturing
      ? ''
      : resolveDefaultEnemyBattler(workflowRoot, project, manifest.resourceRoot, getEffectiveFile, appDirectory);

    const config = {
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      autoplay,
      armed,
      battleback1: battlebacks.battleback1,
      battleback2: battlebacks.battleback2,
      animation,
      enemyBattler,
      captureFrameCount: capturing ? options.captureFrameCount : 0,
    };
    fs.writeFileSync(path.join(appDirectory, 'index.html'), previewHtml(config), 'utf8');
    fs.mkdirSync(path.join(appDirectory, 'js'), { recursive: true });
    fs.writeFileSync(path.join(appDirectory, 'js', 'main.js'), previewMainSource(usesAudio), 'utf8');
    fs.writeFileSync(path.join(appDirectory, 'js', 'particle-preview.js'), PREVIEW_RUNTIME_SOURCE, 'utf8');

    return {
      engine: 'rpg-maker-mz',
      appDirectory,
      effectName: animation.effectName,
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      passthroughRoot: manifest.resourceRoot,
      passthroughPrefixes: PREVIEW_PASSTHROUGH_PREFIXES,
    };
  } catch (error) {
    try { fs.rmSync(appDirectory, { recursive: true, force: true }); } catch { /* Report the preparation error first. */ }
    throw error;
  }
}

export function cleanupParticleAnimationPreviewApp(preparation: Pick<ParticleAnimationPreviewAppPreparation, 'appDirectory'>): void {
  fs.rmSync(preparation.appDirectory, { recursive: true, force: true });
}

// The MZ editor writes fixed defaults for these keys; Animations.json processed by
// third-party tools often omits them entirely. Missing keys fall back to the editor
// defaults before validation, while effectName stays required (nothing to preview without it).
const MZ_ANIMATION_FIELD_DEFAULTS: Record<string, unknown> = {
  displayType: 0,
  scale: 100,
  speed: 100,
  offsetX: 0,
  offsetY: 0,
  rotation: { x: 0, y: 0, z: 0 },
  alignBottom: false,
  flashTimings: [],
  soundTimings: [],
};

export function validatePreviewAnimation(
  input: InteractiveParticleAnimationPreview,
  screenWidth: number,
  screenHeight: number,
  options: { requireEffect?: boolean } = {},
): InteractiveParticleAnimationPreview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ParticleAnimationPreviewPreparationError('Particle animation preview data must be an object.');
  }
  const source = { ...input } as Record<string, unknown>;
  for (const [key, value] of Object.entries(MZ_ANIMATION_FIELD_DEFAULTS)) {
    if (source[key] === undefined) source[key] = structuredClone(value);
  }
  const effectName = normalizeResourceName(source.effectName, 'particle effect', options.requireEffect === false);
  const rotation = requireRecord(source.rotation, 'rotation');
  const flashTimings = requireArray(source.flashTimings, 'flashTimings').map((entry, index) => {
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
  const soundTimings = requireArray(source.soundTimings, 'soundTimings').map((entry, index) => {
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
    displayType: requireInteger(source.displayType, 0, 2, 'displayType'),
    effectName,
    scale: requireInteger(source.scale, 1, 1000, 'scale'),
    speed: requireInteger(source.speed, 1, 1000, 'speed'),
    offsetX: requireInteger(source.offsetX, -screenWidth, screenWidth, 'offsetX'),
    offsetY: requireInteger(source.offsetY, -screenHeight, screenHeight, 'offsetY'),
    rotation: {
      x: requireInteger(rotation.x, -360, 360, 'rotation.x'),
      y: requireInteger(rotation.y, -360, 360, 'rotation.y'),
      z: requireInteger(rotation.z, -360, 360, 'rotation.z'),
    },
    alignBottom: requireBoolean(source.alignBottom, 'alignBottom'),
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

/**
 * Serve-direct variant of copyEffectiveAsset: the asset stays in the project and is
 * read through the pass-through root; only a staged draft (whose effective path
 * differs from the project file) is copied into the app directory so it wins.
 */
function overlayEffectiveAsset(
  workflowRoot: string,
  project: string,
  resourceRoot: string,
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
    if (path.resolve(source) !== path.resolve(resourceRoot, ...relative.split('/'))) {
      copyRequiredFile(source, confinedPath(appDirectory, relative), relative);
    }
    return;
  }
  throw new ParticleAnimationPreviewPreparationError(`Required preview resource was not found: ${normalized}`);
}

/**
 * Serve-direct variant of copyEditorBattlebacks: resolves the same System.json
 * defaults (with the stock Grassland fallback) but only overlays staged drafts;
 * untouched images are read straight from the project.
 */
function resolveEditorBattlebacks(
  workflowRoot: string,
  project: string,
  resourceRoot: string,
  getEffectiveFile: typeof getProjectFileForRead,
  appDirectory: string,
): { battleback1: string; battleback2: string } {
  const result = { battleback1: '', battleback2: '' };
  const systemPath = getEffectiveFile(workflowRoot, project, 'data/System.json');
  if (!systemPath || !isFile(systemPath)) return result;
  let system: Record<string, unknown>;
  try {
    system = JSON.parse(fs.readFileSync(systemPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return result;
  }
  for (const [key, folder] of [['battleback1', 'battlebacks1'], ['battleback2', 'battlebacks2']] as const) {
    const name = system[`${key}Name`];
    const candidates = typeof name === 'string' && name.trim() ? [name, 'Grassland'] : ['Grassland'];
    for (const candidate of candidates) {
      let normalized: string;
      try {
        normalized = normalizeResourceName(candidate, `${key}Name`);
      } catch {
        continue;
      }
      const relative = `img/${folder}/${normalized}.png`;
      const source = getEffectiveFile(workflowRoot, project, relative);
      if (!source || !isFile(source)) continue;
      if (path.resolve(source) !== path.resolve(resourceRoot, ...relative.split('/'))) {
        copyRequiredFile(source, confinedPath(appDirectory, relative), relative);
      }
      result[key] = relative;
      break;
    }
  }
  return result;
}

/**
 * Resolve the project's first enemy battler image so the interactive preview shows a
 * real monster as the effect's target (matching the editor) instead of the dummy
 * circle. Follows the project's front/side view to pick img/enemies or img/sv_enemies;
 * only staged drafts are overlaid, untouched images stream from the pass-through root.
 * Returns '' when no usable enemy image exists (the runtime then draws the dummy target).
 */
function resolveDefaultEnemyBattler(
  workflowRoot: string,
  project: string,
  resourceRoot: string,
  getEffectiveFile: typeof getProjectFileForRead,
  appDirectory: string,
): string {
  const folder = readOptSideView(workflowRoot, project, getEffectiveFile) ? 'sv_enemies' : 'enemies';
  const enemiesPath = getEffectiveFile(workflowRoot, project, 'data/Enemies.json');
  if (!enemiesPath || !isFile(enemiesPath)) return '';
  let enemies: unknown;
  try {
    enemies = JSON.parse(fs.readFileSync(enemiesPath, 'utf8'));
  } catch {
    return '';
  }
  if (!Array.isArray(enemies)) return '';
  for (const entry of enemies) {
    if (!entry || typeof entry !== 'object') continue;
    const battlerName = (entry as Record<string, unknown>).battlerName;
    if (typeof battlerName !== 'string' || !battlerName.trim()) continue;
    let normalized: string;
    try {
      normalized = normalizeResourceName(battlerName, 'enemy battlerName');
    } catch {
      continue;
    }
    const relative = `img/${folder}/${normalized}.png`;
    const source = getEffectiveFile(workflowRoot, project, relative);
    if (!source || !isFile(source)) continue;
    if (path.resolve(source) !== path.resolve(resourceRoot, ...relative.split('/'))) {
      copyRequiredFile(source, confinedPath(appDirectory, relative), relative);
    }
    return relative;
  }
  return '';
}

function readOptSideView(
  workflowRoot: string,
  project: string,
  getEffectiveFile: typeof getProjectFileForRead,
): boolean {
  const systemPath = getEffectiveFile(workflowRoot, project, 'data/System.json');
  if (!systemPath || !isFile(systemPath)) return false;
  try {
    const system = JSON.parse(fs.readFileSync(systemPath, 'utf8')) as Record<string, unknown>;
    return system.optSideView === true;
  } catch {
    return false;
  }
}

// The stock MZ editor previews animations over a battle background. Use the
// project's default battlebacks from System.json, falling back to the stock
// Grassland pair the editor itself shows on fresh projects; entries without any
// usable image keep the plain scene backdrop.
function copyEditorBattlebacks(
  workflowRoot: string,
  project: string,
  getEffectiveFile: typeof getProjectFileForRead,
  appDirectory: string,
): { battleback1: string; battleback2: string } {
  const result = { battleback1: '', battleback2: '' };
  const systemPath = getEffectiveFile(workflowRoot, project, 'data/System.json');
  if (!systemPath || !isFile(systemPath)) return result;
  let system: Record<string, unknown>;
  try {
    system = JSON.parse(fs.readFileSync(systemPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return result;
  }
  for (const [key, folder] of [['battleback1', 'battlebacks1'], ['battleback2', 'battlebacks2']] as const) {
    const name = system[`${key}Name`];
    const candidates = typeof name === 'string' && name.trim() ? [name, 'Grassland'] : ['Grassland'];
    for (const candidate of candidates) {
      let normalized: string;
      try {
        normalized = normalizeResourceName(candidate, `${key}Name`);
      } catch {
        continue;
      }
      const relative = `img/${folder}/${normalized}.png`;
      const source = getEffectiveFile(workflowRoot, project, relative);
      if (!source || !isFile(source)) continue;
      copyRequiredFile(source, confinedPath(appDirectory, relative), relative);
      result[key] = relative;
      break;
    }
  }
  return result;
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
    // Outside NW.js the MZ default is a fixed-size canvas; stretch it to the embed frame.
    Graphics._stretchEnabled = true;
    Graphics.resize(config.screenWidth, config.screenHeight);
    Graphics.boxWidth = config.screenWidth;
    Graphics.boxHeight = config.screenHeight;
    WebAudio.initialize();

    const stage = new Stage();
    const backgroundBitmap = new Bitmap(config.screenWidth, config.screenHeight);
    backgroundBitmap.gradientFillRect(0, 0, config.screenWidth, config.screenHeight, "#171411", "#2c2721", true);
    const background = new Sprite(backgroundBitmap);
    stage.addChild(background);
    // Stock editor look: the scene idles on the project's default battle background.
    const addBattleback = (url) => {
      if (!url) return;
      const bitmap = Bitmap.load(url);
      const sprite = new Sprite(bitmap);
      bitmap.addLoadListener(() => {
        const scale = Math.max(config.screenWidth / bitmap.width, config.screenHeight / bitmap.height);
        sprite.scale.set(scale, scale);
        sprite.x = Math.round((config.screenWidth - bitmap.width * scale) / 2);
        sprite.y = Math.round((config.screenHeight - bitmap.height * scale) / 2);
      });
      stage.addChild(sprite);
    };
    addBattleback(config.battleback1);
    addBattleback(config.battleback2);

    // Editor look: the effect plays on a target sprite. Use the project's default
    // enemy battler when available so the target is a real monster; otherwise fall
    // back to a neutral dummy circle. Capture sessions hide the target entirely so
    // only the effect appears in the thumbnail.
    const target = new Sprite();
    let targetBitmap;
    if (config.enemyBattler) {
      targetBitmap = Bitmap.load(config.enemyBattler);
    } else {
      targetBitmap = new Bitmap(128, 128);
      targetBitmap.drawCircle(64, 64, 42, "#d4c3a6");
      targetBitmap.drawCircle(64, 64, 34, "#5d554a");
    }
    target.bitmap = targetBitmap;
    target.anchor.set(0.5, 1);
    target.x = Math.round(config.screenWidth / 2);
    target.y = Math.round(config.screenHeight * 0.68);
    target.visible = !config.captureFrameCount;
    stage.addChild(target);

    let animationSprite = null;
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
    // Armed backdrops load the scene but wait for a 'play' message so the panel can
    // start playback in-place without reloading the iframe (no black reload flash).
    window.addEventListener("message", (event) => {
      if (event && event.data && event.data.type === "play") play();
    });
    // Sprite_Animation anchors the effect on the target's current height, so neither
    // autoplay nor the embedder may start playback until the battler bitmap is loaded;
    // autoplay and the ready handshake both wait for it (a canvas-backed dummy bitmap
    // resolves immediately, so the top-level capture window is not delayed).
    targetBitmap.addLoadListener(() => {
      if (config.autoplay) play();
      try {
        if (window.parent && window.parent !== window) window.parent.postMessage({ type: "rpg-agent-preview-ready" }, "*");
      } catch (error) { /* no embedder to notify */ }
    });

    Graphics.setStage(stage);
    // Capture mode: advance a fixed number of played frames, freeze on that
    // representative frame, then signal readiness once via document.title so the
    // offscreen host can capturePage without an injected preload. A tick ceiling
    // guarantees the signal even if the effect stalls or fails to load.
    const captureTarget = config.captureFrameCount || 0;
    let capturePlayedFrames = 0;
    let captureTotalTicks = 0;
    let captureFrozen = false;
    const captureMaxTicks = captureTarget ? Math.max(180, captureTarget * 12) : 0;
    Graphics.setTickHandler(() => {
      Graphics.frameCount++;
      if (captureFrozen) return;
      if (Graphics.effekseer) Graphics.effekseer.update();
      // Stock editor behavior: the animation plays once and the scene then idles.
      if (animationSprite && animationSprite.isPlaying()) animationSprite.update();
      if (!captureTarget) return;
      captureTotalTicks++;
      const ready = animationSprite && animationSprite.isPlaying()
        && (typeof animationSprite.isReady !== "function" || animationSprite.isReady());
      if (ready) capturePlayedFrames++;
      const finished = animationSprite && !animationSprite.isPlaying() && capturePlayedFrames > 0;
      if (capturePlayedFrames >= captureTarget || finished || captureTotalTicks >= captureMaxTicks) {
        captureFrozen = true;
        document.title = "__RPG_AGENT_EFFECT_CAPTURE_READY__";
      }
    });
    // Capture windows are hidden, so the compositor never drives requestAnimationFrame
    // and startGameLoop would stall; drive ticks with a timer instead (_onTick runs the
    // tick handler and renders). backgroundThrottling:false on the host window keeps
    // the interval at full rate. Interactive embeds keep the stock rAF game loop.
    if (captureTarget) {
      setInterval(() => Graphics._onTick(1), 16);
    } else {
      Graphics.startGameLoop();
    }
  }
};
`;

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}
