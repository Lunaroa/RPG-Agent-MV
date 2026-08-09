import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_EDITOR_VERSION,
  UI_DESIGNER_NODE_TYPES,
  UI_DESIGNER_RUNTIME_VERSION,
  UI_DESIGNER_SCENE_SCRIPT_VERSION,
  type UiDesignerDocument,
  type UiDesignerNodeType,
  type UiValidationCode,
  type UiValidationIssue,
  type UiValidationReport,
} from '../../../../contract/ui-designer.ts';
import {
  migrateUiDesignerDocument,
  migrateUiRuntimeSceneExport,
  uiSceneScriptSyntaxError,
} from '../../../../contract/ui-designer-script.ts';

const NODE_TYPES = new Set<string>(UI_DESIGNER_NODE_TYPES);
const EVENT_NAMES = new Set([
  'onClick',
  'onHoverEnter',
  'onHoverLeave',
  'onShow',
  'onHide',
  'onUpdate',
  'onFocus',
  'onBlur',
]);
const ACTION_TYPES = new Set([
  'none',
  'newGame',
  'continue',
  'options',
  'exit',
  'gotoScene',
  'toggleNode',
  'playSe',
  'url',
  'script',
  'setVariable',
  'setSwitch',
  'showMessage',
  'tweenProp',
  'wait',
]);
const ANIMATION_TYPES = new Set([
  'none',
  'fadeIn',
  'fadeOut',
  'slideFromTop',
  'slideFromBottom',
  'slideFromLeft',
  'slideFromRight',
  'scaleIn',
  'scaleOut',
]);
const EASINGS = new Set(['Linear', 'EaseIn', 'EaseOut', 'EaseInOut', 'Bounce']);
const SCENE_NAME_PATTERN = /^Scene_[A-Za-z0-9_$]+$/;
const SCENE_BASE_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const BASE_PROP_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'scaleX',
  'scaleY',
  'rotate',
  'opacity',
  'visible',
  'anchorX',
  'anchorY',
  'zIndex',
] as const;
const BASE_NUMERIC_PROP_KEYS = BASE_PROP_KEYS.filter((key) => key !== 'visible');
const TYPE_PROP_KEYS: Record<string, readonly string[]> = {
  container: ['backgroundPath', 'backgroundFillMode', 'backgroundRepeatMode', 'clip'],
  sprite: ['path', 'fillMode', 'repeatMode', 'tint', 'blendMode', 'scrollX', 'scrollY'],
  nineSlice: ['path', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'showGuides'],
  frameAnimation: ['defaultFrameDuration', 'loop', 'speed', 'initialFrame', 'frames', 'fillMode'],
  button: [
    'content', 'wrapWidth', 'richText', 'fontFile', 'fontSize', 'fontWeight', 'italic', 'letterSpacing',
    'textColor', 'strokeColor', 'strokeWidth', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY',
    'shadowBlur', 'align', 'verticalAlign', 'backgroundColor', 'padding', 'imageStates', 'borderColor',
    'borderWidth', 'borderRadius', 'hoverTint', 'pressedScale', 'disabledCondition', 'focusColor',
    'focusWidth', 'hoverSe', 'clickSe',
  ],
  text: [
    'content', 'wrapWidth', 'richText', 'fontFile', 'fontSize', 'fontWeight', 'italic', 'letterSpacing',
    'textColor', 'strokeColor', 'strokeWidth', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY',
    'shadowBlur', 'align', 'verticalAlign', 'backgroundColor', 'padding',
  ],
  progressBar: [
    'trackImage', 'trackColor', 'trackRadius', 'fillImage', 'fillColor', 'fillRadius', 'fillDirection',
    'currentValue', 'maxValue', 'animateValue',
  ],
  overlay: ['fillColor', 'clickThrough'],
  video: ['path', 'autoplay', 'loop', 'muted', 'playbackRate', 'posterPath'],
  particle: [
    'maxParticles', 'emissionInterval', 'emissionArea', 'imagePath', 'shape', 'velocityX', 'velocityY',
    'velocityRandomX', 'velocityRandomY', 'gravityX', 'gravityY', 'rotationSpeed', 'lifetime',
    'lifetimeRandom', 'startScale', 'endScale', 'startOpacity', 'endOpacity', 'startColor', 'endColor',
    'blendMode', 'glow',
  ],
};

export class UiDesignerValidationError extends Error {
  readonly code = 'UI_DESIGNER_VALIDATION';
  readonly report: UiValidationReport;

  constructor(report: UiValidationReport) {
    super(report.errors.map((issue) => issue.message).join('; ') || 'UI designer document is invalid.');
    this.name = 'UiDesignerValidationError';
    this.report = report;
  }
}

export function validateUiDesignerDocument(value: unknown): UiValidationReport {
  const errors: UiValidationIssue[] = [];
  const warnings: UiValidationIssue[] = [];
  const addError = (
    code: UiValidationCode,
    message: string,
    path?: string,
    nodeId?: string,
  ): void => errors.push({ severity: 'error', code, message, path, nodeId });
  const addWarning = (
    code: UiValidationCode,
    message: string,
    path?: string,
    nodeId?: string,
  ): void => warnings.push({ severity: 'warning', code, message, path, nodeId });

  let canonical: unknown = value;
  try {
    canonical = migrateUiDesignerDocument(value);
  } catch (error) {
    addError('invalid-document-shape', error instanceof Error ? error.message : String(error), 'sceneScript');
    return { valid: false, issues: [...errors], errors, warnings };
  }

  if (!isRecord(canonical)) {
    addError('invalid-code', 'UI designer document must be an object.', '$');
    return { valid: false, issues: [...errors], errors, warnings };
  }
  value = canonical;
  if (!isRecord(value)) {
    addError('invalid-code', 'UI designer document must be an object.', '$');
    return { valid: false, issues: [...errors], errors, warnings };
  }

  if (value.version !== UI_DESIGNER_DOCUMENT_VERSION) {
    addError('unsupported-version', `Unsupported UI designer document version: ${String(value.version)}.`, 'version');
  }
  if (value.editorVersion !== UI_DESIGNER_EDITOR_VERSION) {
    addError('unsupported-version', `Unsupported UI designer editor version: ${String(value.editorVersion)}.`, 'editorVersion');
  }

  validateSceneMeta(value.meta, addError);
  validateTransitions(value.transitions, addError);
  validateGlobalFilter(value.globalFilter, addError);
  validateCanvas(value.canvas, addError);

  if (!Array.isArray(value.guides)) addError('invalid-document-shape', 'guides must be an array.', 'guides');
  else value.guides.forEach((guide, index) => {
    if (!isRecord(guide) || !isNonEmptyString(guide.id) || !['vertical', 'horizontal'].includes(String(guide.type))) {
      addError('invalid-value', 'Guide entries require id and a vertical/horizontal type.', `guides[${index}]`);
    }
  });

  const nodes = Array.isArray(value.nodes) ? value.nodes : null;
  if (!nodes) {
    addError('invalid-document-shape', 'nodes must be an array.', 'nodes');
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  const rootIds = new Set<string>();
  if (nodes) {
    nodes.forEach((node, index) => {
      const nodePath = `nodes[${index}]`;
      if (!isRecord(node)) {
        addError('invalid-document-shape', 'Node entries must be objects.', nodePath);
        return;
      }
      const id = isNonEmptyString(node.id) ? node.id : '';
      const name = isNonEmptyString(node.name) ? node.name : '';
      if (!id) addError('invalid-value', 'Node id is required.', `${nodePath}.id`);
      else if (ids.has(id)) addError('duplicate-node-id', `Duplicate node id: ${id}.`, `${nodePath}.id`, id);
      else ids.add(id);
      if (!name) addError('unnamed-node', 'Node name is required.', `${nodePath}.name`, id || undefined);
      else if (names.has(name)) addError('duplicate-node-name', `Duplicate node name: ${name}.`, `${nodePath}.name`, id || undefined);
      else names.add(name);

      if (!NODE_TYPES.has(String(node.type))) {
        addError('invalid-value', `Unknown node type: ${String(node.type)}.`, `${nodePath}.type`, id || undefined);
      }
      if (node.parentId !== null && !isNonEmptyString(node.parentId)) {
        addError('invalid-value', 'parentId must be null or a non-empty node id.', `${nodePath}.parentId`, id || undefined);
      }
      if (!Array.isArray(node.children) || node.children.some((child) => !isNonEmptyString(child))) {
        addError('invalid-document-shape', 'children must be an array of node ids.', `${nodePath}.children`, id || undefined);
      } else {
        const childIds = new Set<string>();
        for (const child of node.children) {
          if (childIds.has(child)) addError('duplicate-child-id', `Node ${id || '(unknown)'} lists child ${child} more than once.`, `${nodePath}.children`, id || undefined);
          childIds.add(child);
        }
        if (node.type !== 'container' && node.children.length > 0) {
          addError('non-container-children', `Node type ${String(node.type)} cannot contain children.`, `${nodePath}.children`, id || undefined);
        }
      }
      validateBaseProps(node.props, addError, nodePath, id || undefined);
      if (isUiDesignerNodeType(node.type)) {
        validateNodeTypeProps(node.type, node.props, addError, addWarning, nodePath, id || undefined);
      }
      validatePropertyModes(node.propModes, node.propCodes, node.type, addError, nodePath, id || undefined);
      validateCondition(node.condition, addError, `${nodePath}.condition`, id || undefined);
      validateAnimation(node.enterAnim, addError, `${nodePath}.enterAnim`, id || undefined);
      validateAnimation(node.exitAnim, addError, `${nodePath}.exitAnim`, id || undefined);
      validateEvents(node.events, addError, addWarning, `${nodePath}.events`, id || undefined);
    });

    const nodeById = new Map<string, Record<string, unknown>>();
    for (const node of nodes) {
      if (isRecord(node) && isNonEmptyString(node.id)) nodeById.set(node.id, node);
    }
    for (const node of nodes) {
      if (isRecord(node) && isNonEmptyString(node.id) && node.parentId === null) rootIds.add(node.id);
    }
    for (const node of nodes) {
      if (!isRecord(node) || !isNonEmptyString(node.id)) continue;
      const id = node.id;
      const parentId = node.parentId;
      if (parentId !== null && isNonEmptyString(parentId)) {
        const parent = nodeById.get(parentId);
        if (!parent) addError('missing-parent', `Node ${id} references missing parent ${parentId}.`, `nodes.${id}.parentId`, id);
        else if (!Array.isArray(parent.children) || !parent.children.includes(id)) {
          addError('missing-child', `Parent ${parentId} does not list child ${id}.`, `nodes.${id}.parentId`, id);
        }
      }
      if (Array.isArray(node.children)) {
        for (const childId of node.children) {
          const child = nodeById.get(String(childId));
          if (!child) addError('missing-child', `Node ${id} references missing child ${String(childId)}.`, `nodes.${id}.children`, id);
          else if (child.parentId !== id) {
            addError('missing-parent', `Child ${String(childId)} does not point back to parent ${id}.`, `nodes.${id}.children`, id);
          }
        }
      }
    }
    detectCycles(nodes, addError);
    validateNodeReferences(nodes, ids, addError);
  }

  if (!Array.isArray(value.zOrder)) {
    addError('invalid-document-shape', 'zOrder must be an array.', 'zOrder');
  } else {
    const zOrder = value.zOrder;
    const zSet = new Set<string>();
    zOrder.forEach((id, index) => {
      if (!isNonEmptyString(id)) addError('invalid-z-order', 'zOrder entries must be node ids.', `zOrder[${index}]`);
      else if (zSet.has(id)) addError('invalid-z-order', `Duplicate zOrder entry: ${id}.`, `zOrder[${index}]`);
      else zSet.add(id);
      if (isNonEmptyString(id) && !ids.has(id)) addError('orphan-node', `zOrder references missing node ${id}.`, `zOrder[${index}]`);
      else if (isNonEmptyString(id) && !rootIds.has(id)) addError('invalid-z-order', `zOrder may contain root nodes only: ${id}.`, `zOrder[${index}]`);
    });
    for (const id of rootIds) if (!zSet.has(id)) addError('invalid-z-order', `Root node ${id} is missing from zOrder.`, 'zOrder', id);
  }

  validateSceneScript(value.sceneScript, addError);
  return {
    valid: errors.length === 0,
    issues: [...errors, ...warnings],
    errors,
    warnings,
  };
}

export function assertValidUiDesignerDocument(value: unknown): UiDesignerDocument {
  let canonical: unknown = value;
  try {
    canonical = migrateUiDesignerDocument(value);
  } catch (error) {
    const issue: UiValidationIssue = { severity: 'error', code: 'invalid-document-shape', message: error instanceof Error ? error.message : String(error), path: 'sceneScript' };
    throw new UiDesignerValidationError({ valid: false, issues: [issue], errors: [issue], warnings: [] });
  }
  const report = validateUiDesignerDocument(canonical);
  if (!report.valid) throw new UiDesignerValidationError(report);
  return canonical as UiDesignerDocument;
}

/** Validate the runtime export with the same node/property/action rules as the source document. */
export function validateUiRuntimeSceneExport(value: unknown): UiValidationReport {
  let canonical: unknown = value;
  try {
    canonical = migrateUiRuntimeSceneExport(value);
  } catch (error) {
    const issue: UiValidationIssue = { severity: 'error', code: 'invalid-document-shape', message: error instanceof Error ? error.message : String(error), path: 'sceneScript' };
    return { valid: false, issues: [issue], errors: [issue], warnings: [] };
  }
  if (!isRecord(canonical)) {
    const issue: UiValidationIssue = { severity: 'error', code: 'invalid-document-shape', message: 'Runtime scene export must be an object.', path: '$' };
    return { valid: false, issues: [issue], errors: [issue], warnings: [] };
  }
  value = canonical;
  if (!isRecord(value)) {
    const issue: UiValidationIssue = { severity: 'error', code: 'invalid-document-shape', message: 'Runtime scene export must be an object.', path: '$' };
    return { valid: false, issues: [issue], errors: [issue], warnings: [] };
  }
  if (value.runtimeVersion !== UI_DESIGNER_RUNTIME_VERSION) {
    const issue: UiValidationIssue = { severity: 'error', code: 'invalid-runtime-version', message: 'Unsupported UI designer runtime version.', path: 'runtimeVersion' };
    return { valid: false, issues: [issue], errors: [issue], warnings: [] };
  }
  const meta = isRecord(value.meta) ? value.meta : {};
  const canvasWidth = isPositiveFinite(meta.canvasWidth) ? meta.canvasWidth : 1;
  const canvasHeight = isPositiveFinite(meta.canvasHeight) ? meta.canvasHeight : 1;
  return validateUiDesignerDocument({
    version: value.version,
    editorVersion: UI_DESIGNER_EDITOR_VERSION,
    meta: {
      sceneName: meta.sceneName,
      sceneBase: meta.sceneBase,
      canvasWidth,
      canvasHeight,
      author: typeof meta.author === 'string' ? meta.author : '',
      description: typeof meta.description === 'string' ? meta.description : '',
      created: '',
      modified: '',
    },
    transitions: value.transitions,
    globalFilter: value.globalFilter,
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: '#000000',
      backgroundPattern: 'solid',
      grid: { enabled: false, size: 1, color: '#000000' },
      snap: { enabled: false, smartEnabled: false, sensitivity: 1 },
      rulers: false,
      guidesVisible: false,
      mapBackground: { mapId: 0, blur: 0, switchId: 0 },
    },
    guides: [],
    nodes: value.nodes,
    zOrder: value.zOrder,
    sceneScript: value.sceneScript,
  });
}

function validateSceneMeta(value: unknown, addError: AddIssue): void {
  if (!isRecord(value)) {
    addError('invalid-document-shape', 'meta must be an object.', 'meta');
    return;
  }
  if (!isNonEmptyString(value.sceneName)) {
    addError('scene-name-empty', 'meta.sceneName is required.', 'meta.sceneName');
  } else if (!SCENE_NAME_PATTERN.test(value.sceneName.trim())) {
    addError('scene-name-invalid', 'meta.sceneName must be a Scene_* identifier.', 'meta.sceneName');
  }
  if (!isNonEmptyString(value.sceneBase)) {
    addError('invalid-value', 'meta.sceneBase is required.', 'meta.sceneBase');
  } else if (!SCENE_BASE_PATTERN.test(value.sceneBase.trim())) {
    addError('invalid-value', 'meta.sceneBase must be a legal identifier.', 'meta.sceneBase');
  }
  for (const field of ['author', 'description', 'created', 'modified']) {
    if (typeof value[field] !== 'string') addError('invalid-value', `meta.${field} must be a string.`, `meta.${field}`);
  }
  for (const field of ['canvasWidth', 'canvasHeight']) {
    if (!isPositiveFinite(value[field])) addError('invalid-value', `meta.${field} must be positive.`, `meta.${field}`);
  }
}

function validateTransitions(value: unknown, addError: AddIssue): void {
  if (!isRecord(value)) {
    addError('invalid-code', 'transitions must be an object.', 'transitions');
    return;
  }
  for (const key of ['enter', 'exit']) {
    const transition = value[key];
    if (!isRecord(transition) || !['none', 'fade', 'slideLeft', 'slideRight'].includes(String(transition.type)) || !isFiniteNumber(transition.duration) || transition.duration < 0) {
      addError('invalid-value', 'Transition configuration is invalid.', `transitions.${key}`);
    }
  }
}

function validateGlobalFilter(value: unknown, addError: AddIssue): void {
  if (!isRecord(value)) {
    addError('invalid-code', 'globalFilter must be an object.', 'globalFilter');
    return;
  }
  if (typeof value.preset !== 'string') addError('invalid-code', 'globalFilter.preset must be a string.', 'globalFilter.preset');
  for (const field of ['blur', 'glow']) {
    if (!isFiniteNumber(value[field])) addError('invalid-code', `globalFilter.${field} must be finite.`, `globalFilter.${field}`);
  }
}

function validateCanvas(value: unknown, addError: AddIssue): void {
  if (!isRecord(value)) {
    addError('invalid-code', 'canvas must be an object.', 'canvas');
    return;
  }
  for (const field of ['width', 'height']) {
    if (!isPositiveFinite(value[field])) addError('invalid-code', `canvas.${field} must be positive.`, `canvas.${field}`);
  }
  if (typeof value.backgroundColor !== 'string') addError('invalid-code', 'canvas.backgroundColor must be a string.', 'canvas.backgroundColor');
  if (!['solid', 'checkerboard'].includes(String(value.backgroundPattern))) addError('invalid-code', 'canvas.backgroundPattern is invalid.', 'canvas.backgroundPattern');
  if (typeof value.rulers !== 'boolean' || typeof value.guidesVisible !== 'boolean') addError('invalid-code', 'canvas rulers/guidesVisible must be booleans.', 'canvas');
  if (!isRecord(value.grid) || typeof value.grid.enabled !== 'boolean' || !isPositiveFinite(value.grid.size) || typeof value.grid.color !== 'string') {
    addError('invalid-code', 'canvas.grid is invalid.', 'canvas.grid');
  }
  if (!isRecord(value.snap) || typeof value.snap.enabled !== 'boolean' || typeof value.snap.smartEnabled !== 'boolean' || !isPositiveFinite(value.snap.sensitivity)) {
    addError('invalid-code', 'canvas.snap is invalid.', 'canvas.snap');
  }
  if (!isRecord(value.mapBackground) || !Number.isInteger(value.mapBackground.mapId) || value.mapBackground.mapId < 0 || !isFiniteNumber(value.mapBackground.blur) || !Number.isInteger(value.mapBackground.switchId) || value.mapBackground.switchId < 0) {
    addError('invalid-code', 'canvas.mapBackground is invalid.', 'canvas.mapBackground');
  }
}

function validateBaseProps(value: unknown, addError: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value)) {
    addError('invalid-document-shape', 'Node props must be an object.', `${path}.props`, nodeId);
    return;
  }
  for (const field of BASE_NUMERIC_PROP_KEYS) {
    if (!isFiniteNumber(value[field])) addError('invalid-value', `Node prop ${field} must be finite.`, `${path}.props.${field}`, nodeId);
  }
  if (isFiniteNumber(value.width) && value.width <= 0) addError('invalid-value', 'Node prop width must be positive.', `${path}.props.width`, nodeId);
  if (isFiniteNumber(value.height) && value.height <= 0) addError('invalid-value', 'Node prop height must be positive.', `${path}.props.height`, nodeId);
  if (isFiniteNumber(value.opacity) && (value.opacity < 0 || value.opacity > 255)) addError('invalid-value', 'Node prop opacity must be between 0 and 255.', `${path}.props.opacity`, nodeId);
  if (isFiniteNumber(value.anchorX) && (value.anchorX < 0 || value.anchorX > 1)) addError('invalid-value', 'Node prop anchorX must be between 0 and 1.', `${path}.props.anchorX`, nodeId);
  if (isFiniteNumber(value.anchorY) && (value.anchorY < 0 || value.anchorY > 1)) addError('invalid-value', 'Node prop anchorY must be between 0 and 1.', `${path}.props.anchorY`, nodeId);
  if (typeof value.visible !== 'boolean') addError('invalid-value', 'Node prop visible must be boolean.', `${path}.props.visible`, nodeId);
}

function validateNodeTypeProps(type: UiDesignerNodeType, value: unknown, addError: AddIssue, addWarning: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value)) return;
  const typeKeys = TYPE_PROP_KEYS[type] ?? [];
  for (const key of typeKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addError('invalid-value', `Node type ${type} requires props.${key}.`, `${path}.props.${key}`, nodeId);
    }
  }

  switch (type) {
    case 'container':
      requireString(value, 'backgroundPath', addError, path, nodeId);
      requireEnum(value, 'backgroundFillMode', ['stretch', 'cover', 'contain', 'tile'], addError, path, nodeId);
      requireEnum(value, 'backgroundRepeatMode', ['none', 'horizontal', 'vertical', 'both'], addError, path, nodeId);
      requireBoolean(value, 'clip', addError, path, nodeId);
      break;
    case 'sprite':
      requireString(value, 'path', addError, path, nodeId);
      requireEnum(value, 'fillMode', ['stretch', 'cover', 'contain', 'tile'], addError, path, nodeId);
      requireEnum(value, 'repeatMode', ['none', 'horizontal', 'vertical', 'both'], addError, path, nodeId);
      requireString(value, 'tint', addError, path, nodeId);
      requireEnum(value, 'blendMode', ['normal', 'add', 'multiply', 'screen', 'overlay'], addError, path, nodeId);
      requireNumber(value, 'scrollX', addError, path, nodeId);
      requireNumber(value, 'scrollY', addError, path, nodeId);
      break;
    case 'nineSlice':
      requireString(value, 'path', addError, path, nodeId);
      for (const key of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']) requireNumber(value, key, addError, path, nodeId, 0);
      requireBoolean(value, 'showGuides', addError, path, nodeId);
      break;
    case 'frameAnimation':
      requireNumber(value, 'defaultFrameDuration', addError, path, nodeId, 0);
      requireBoolean(value, 'loop', addError, path, nodeId);
      requireNumber(value, 'speed', addError, path, nodeId, 0);
      requireInteger(value, 'initialFrame', addError, path, nodeId, 0);
      requireEnum(value, 'fillMode', ['stretch', 'cover', 'contain', 'tile'], addError, path, nodeId);
      validateFrames(value.frames, addError, addWarning, path, nodeId, value.initialFrame);
      break;
    case 'button':
      validateTextProps(value, addError, path, nodeId);
      if (!isRecord(value.imageStates)) {
        addError('invalid-value', 'button.imageStates must be an object.', `${path}.props.imageStates`, nodeId);
      } else {
        for (const key of ['normal', 'hover', 'pressed', 'disabled']) requireString(value.imageStates, key, addError, `${path}.props.imageStates`, nodeId);
      }
      for (const key of ['backgroundColor', 'borderColor', 'hoverTint', 'disabledCondition', 'focusColor', 'hoverSe', 'clickSe']) requireString(value, key, addError, path, nodeId);
      for (const key of ['borderWidth', 'borderRadius', 'focusWidth']) requireNumber(value, key, addError, path, nodeId, 0);
      requireNumber(value, 'pressedScale', addError, path, nodeId, 0);
      break;
    case 'text':
      validateTextProps(value, addError, path, nodeId);
      break;
    case 'progressBar':
      for (const key of ['trackImage', 'trackColor', 'fillImage', 'fillColor']) requireString(value, key, addError, path, nodeId);
      for (const key of ['trackRadius', 'fillRadius']) requireNumber(value, key, addError, path, nodeId, 0);
      requireEnum(value, 'fillDirection', ['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom'], addError, path, nodeId);
      requireNumber(value, 'currentValue', addError, path, nodeId, 0);
      requireNumber(value, 'maxValue', addError, path, nodeId, 0);
      if (isFiniteNumber(value.currentValue) && isFiniteNumber(value.maxValue) && value.currentValue > value.maxValue) {
        addError('invalid-value', 'progressBar.currentValue cannot exceed maxValue.', `${path}.props.currentValue`, nodeId);
      }
      requireBoolean(value, 'animateValue', addError, path, nodeId);
      break;
    case 'overlay':
      requireString(value, 'fillColor', addError, path, nodeId);
      requireBoolean(value, 'clickThrough', addError, path, nodeId);
      break;
    case 'video':
      requireString(value, 'path', addError, path, nodeId);
      requireBoolean(value, 'autoplay', addError, path, nodeId);
      requireBoolean(value, 'loop', addError, path, nodeId);
      requireBoolean(value, 'muted', addError, path, nodeId);
      requireNumber(value, 'playbackRate', addError, path, nodeId, 0);
      requireString(value, 'posterPath', addError, path, nodeId);
      break;
    case 'particle':
      requireInteger(value, 'maxParticles', addError, path, nodeId, 0);
      if (isFiniteNumber(value.maxParticles) && value.maxParticles > 10000) addError('particle-performance', 'particle.maxParticles cannot exceed 10000.', `${path}.props.maxParticles`, nodeId);
      for (const key of [
        'emissionInterval', 'velocityX', 'velocityY', 'velocityRandomX', 'velocityRandomY', 'gravityX', 'gravityY',
        'rotationSpeed', 'lifetime', 'lifetimeRandom', 'startScale', 'endScale', 'startOpacity', 'endOpacity', 'glow',
      ]) requireNumber(value, key, addError, path, nodeId, ['emissionInterval', 'lifetime', 'lifetimeRandom', 'startScale', 'endScale', 'glow'].includes(key) ? 0 : undefined);
      for (const key of ['startOpacity', 'endOpacity']) {
        if (isFiniteNumber(value[key]) && (value[key] < 0 || value[key] > 255)) addError('invalid-value', `${key} must be between 0 and 255.`, `${path}.props.${key}`, nodeId);
      }
      requireEnum(value, 'emissionArea', ['point', 'rectangle', 'circle'], addError, path, nodeId);
      requireString(value, 'imagePath', addError, path, nodeId);
      requireEnum(value, 'shape', ['circle', 'square', 'star'], addError, path, nodeId);
      requireString(value, 'startColor', addError, path, nodeId);
      requireString(value, 'endColor', addError, path, nodeId);
      requireEnum(value, 'blendMode', ['normal', 'add', 'screen'], addError, path, nodeId);
      break;
  }
}

function validateTextProps(value: Record<string, unknown>, addError: AddIssue, path: string, nodeId?: string): void {
  requireString(value, 'content', addError, path, nodeId);
  requireNumber(value, 'wrapWidth', addError, path, nodeId, 0);
  requireBoolean(value, 'richText', addError, path, nodeId);
  for (const key of ['fontFile', 'textColor', 'strokeColor', 'shadowColor', 'backgroundColor']) requireString(value, key, addError, path, nodeId);
  requireNumber(value, 'fontSize', addError, path, nodeId, 0);
  requireEnum(value, 'fontWeight', ['normal', 'bold', 'light'], addError, path, nodeId);
  requireBoolean(value, 'italic', addError, path, nodeId);
  for (const key of ['letterSpacing', 'strokeWidth', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur']) requireNumber(value, key, addError, path, nodeId, key === 'shadowBlur' || key === 'strokeWidth' ? 0 : undefined);
  requireEnum(value, 'align', ['left', 'center', 'right'], addError, path, nodeId);
  requireEnum(value, 'verticalAlign', ['top', 'middle', 'bottom'], addError, path, nodeId);
  if (!isRecord(value.padding)) {
    addError('invalid-value', 'text.padding must be an object.', `${path}.props.padding`, nodeId);
  } else {
    for (const key of ['top', 'right', 'bottom', 'left']) requireNumber(value.padding, key, addError, `${path}.props.padding`, nodeId, 0);
  }
}

function validateFrames(value: unknown, addError: AddIssue, addWarning: AddIssue, path: string, nodeId?: string, initialFrame?: unknown): void {
  if (!Array.isArray(value)) {
    addError('invalid-value', 'frameAnimation.frames must be an array.', `${path}.props.frames`, nodeId);
    return;
  }
  if (value.length === 0) addWarning('empty-frame-list', 'frameAnimation.frames is empty; add a frame before preview.', `${path}.props.frames`, nodeId);
  const ids = new Set<string>();
  value.forEach((frame, index) => {
    if (!isRecord(frame)) {
      addError('invalid-value', 'Frame entries must be objects.', `${path}.props.frames[${index}]`, nodeId);
      return;
    }
    if (!isNonEmptyString(frame.id)) addError('invalid-value', 'Frame id is required.', `${path}.props.frames[${index}].id`, nodeId);
    else if (ids.has(frame.id)) addError('duplicate-frame-id', `Duplicate frame id: ${frame.id}.`, `${path}.props.frames[${index}].id`, nodeId);
    else ids.add(frame.id);
    requireString(frame, 'path', addError, `${path}.props.frames[${index}]`, nodeId);
    requireNumber(frame, 'duration', addError, `${path}.props.frames[${index}]`, nodeId, 0);
  });
  if (isFiniteNumber(initialFrame) && Number.isInteger(initialFrame) && value.length > 0 && initialFrame >= value.length) {
    addError('invalid-value', 'frameAnimation.initialFrame is outside the frame list.', `${path}.props.initialFrame`, nodeId);
  }
}

function requireString(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string): void {
  if (typeof value[key] !== 'string') addError('invalid-value', `${key} must be a string.`, `${path}.props.${key}`, nodeId);
}

function requireBoolean(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string): void {
  if (typeof value[key] !== 'boolean') addError('invalid-value', `${key} must be a boolean.`, `${path}.props.${key}`, nodeId);
}

function requireNumber(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string, min?: number): void {
  if (!isFiniteNumber(value[key]) || (min !== undefined && value[key] < min)) addError('invalid-value', `${key} must be a finite number${min !== undefined ? ` >= ${min}` : ''}.`, `${path}.props.${key}`, nodeId);
}

function requireInteger(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string, min?: number): void {
  if (!Number.isInteger(value[key]) || (min !== undefined && Number(value[key]) < min)) addError('invalid-value', `${key} must be an integer${min !== undefined ? ` >= ${min}` : ''}.`, `${path}.props.${key}`, nodeId);
}

function requireEnum(value: Record<string, unknown>, key: string, allowed: readonly string[], addError: AddIssue, path: string, nodeId?: string): void {
  if (typeof value[key] !== 'string' || !allowed.includes(value[key])) addError('invalid-value', `${key} has an unsupported value.`, `${path}.props.${key}`, nodeId);
}

function validatePropertyModes(value: unknown, codes: unknown, type: unknown, addError: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value) || !isRecord(codes)) {
    addError('invalid-document-shape', 'propModes and propCodes must be objects.', path, nodeId);
    return;
  }
  const allowed = new Set<string>([
    ...BASE_PROP_KEYS,
    ...(isUiDesignerNodeType(type) ? TYPE_PROP_KEYS[type] ?? [] : []),
  ]);
  for (const [key, mode] of Object.entries(value)) {
    if (!allowed.has(key)) addError('invalid-reference', `Property mode ${key} is not supported by this node type.`, `${path}.propModes.${key}`, nodeId);
    if (mode !== 'value' && mode !== 'code') addError('invalid-value', `Unknown property mode for ${key}.`, `${path}.propModes.${key}`, nodeId);
    if (mode === 'code' && typeof codes[key] !== 'string') addError('invalid-code', `Code property ${key} must have a string source.`, `${path}.propCodes.${key}`, nodeId);
  }
  for (const [key, source] of Object.entries(codes)) {
    if (!allowed.has(key)) addError('invalid-reference', `Property code ${key} is not supported by this node type.`, `${path}.propCodes.${key}`, nodeId);
    if (!Object.prototype.hasOwnProperty.call(value, key)) addError('invalid-reference', `Property code ${key} has no matching prop mode.`, `${path}.propCodes.${key}`, nodeId);
    else if (value[key] !== 'code') addError('invalid-value', `Property code ${key} requires mode code.`, `${path}.propModes.${key}`, nodeId);
    if (typeof source !== 'string') addError('invalid-code', `Property code ${key} must be a string.`, `${path}.propCodes.${key}`, nodeId);
    else if (!compileExpressionCode(source)) addError('invalid-code', `Property expression ${key} has invalid JavaScript syntax.`, `${path}.propCodes.${key}`, nodeId);
  }
}

function validateCondition(value: unknown, addError: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    addError('invalid-code', 'Visibility condition is invalid.', path, nodeId);
    return;
  }
  if (value.type === 'none') return;
  if ((value.type === 'switch_on' || value.type === 'switch_off') && Number.isInteger(value.switchId) && value.switchId > 0) return;
  if (value.type === 'variable' && Number.isInteger(value.variableId) && value.variableId > 0 && ['==', '>=', '<=', '>', '<', '!='].includes(String(value.operator)) && isFiniteNumber(value.value)) return;
  if (value.type === 'code' && typeof value.code === 'string' && compileExpressionCode(value.code)) return;
  if ((value.type === 'and' || value.type === 'or') && Array.isArray(value.children)) {
    value.children.forEach((child, index) => validateCondition(child, addError, `${path}.children[${index}]`, nodeId));
    return;
  }
  addError('invalid-code', 'Visibility condition is invalid.', path, nodeId);
}

function validateAnimation(value: unknown, addError: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value) || !ANIMATION_TYPES.has(String(value.type)) || !isFiniteNumber(value.duration) || value.duration < 0 || !EASINGS.has(String(value.easing))) {
    addError('invalid-code', 'Animation configuration is invalid.', path, nodeId);
  }
}

function validateEvents(value: unknown, addError: AddIssue, addWarning: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value)) {
    addError('invalid-code', 'events must be an object.', path, nodeId);
    return;
  }
  for (const [eventName, handler] of Object.entries(value)) {
    if (!EVENT_NAMES.has(eventName)) addWarning('invalid-code', `Unknown event name ${eventName} will be ignored.`, `${path}.${eventName}`, nodeId);
    if (!isRecord(handler) || !Array.isArray(handler.actions)) {
      addError('invalid-code', `Event ${eventName} must contain an actions array.`, `${path}.${eventName}`, nodeId);
      continue;
    }
    handler.actions.forEach((action, index) => {
      if (!isRecord(action) || !ACTION_TYPES.has(String(action.type))) {
        addError('invalid-value', `Event ${eventName} contains an invalid action type.`, `${path}.${eventName}.actions[${index}]`, nodeId);
        return;
      }
      validateAction(action, addError, `${path}.${eventName}.actions[${index}]`, nodeId);
    });
  }
}

function validateAction(value: Record<string, unknown>, addError: AddIssue, path: string, nodeId?: string): void {
  const type = String(value.type);
  switch (type) {
    case 'none':
    case 'newGame':
    case 'continue':
    case 'options':
    case 'exit':
      break;
    case 'gotoScene':
      if (!isNonEmptyString(value.sceneName) || !SCENE_NAME_PATTERN.test(value.sceneName.trim())) addError('invalid-reference', 'gotoScene.sceneName must reference a Scene_* identifier.', `${path}.sceneName`, nodeId);
      break;
    case 'toggleNode':
      if (!isNonEmptyString(value.targetNodeId)) addError('invalid-reference', 'toggleNode.targetNodeId is required.', `${path}.targetNodeId`, nodeId);
      break;
    case 'playSe':
      requireActionString(value, 'seName', addError, path, nodeId);
      break;
    case 'url':
      requireActionString(value, 'url', addError, path, nodeId);
      if (typeof value.url === 'string') {
        try {
          const parsed = new URL(value.url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
        } catch {
          addError('invalid-value', 'url actions must use an http(s) URL.', `${path}.url`, nodeId);
        }
      }
      break;
    case 'script':
      if (typeof value.code !== 'string' || !compileCode(value.code)) addError('invalid-code', 'Script action has invalid JavaScript syntax.', `${path}.code`, nodeId);
      break;
    case 'setVariable':
      requireActionInteger(value, 'variableId', addError, path, nodeId, 1);
      requireActionEnum(value, 'variableOp', ['=', '+', '-', '*', '/'], addError, path, nodeId);
      requireActionNumber(value, 'variableVal', addError, path, nodeId);
      break;
    case 'setSwitch':
      requireActionInteger(value, 'switchId', addError, path, nodeId, 1);
      requireActionEnum(value, 'switchVal', ['on', 'off', 'toggle'], addError, path, nodeId);
      break;
    case 'showMessage':
      requireActionString(value, 'message', addError, path, nodeId);
      break;
    case 'tweenProp':
      if (!isNonEmptyString(value.tweenNodeId)) addError('invalid-reference', 'tweenProp.tweenNodeId is required.', `${path}.tweenNodeId`, nodeId);
      requireActionString(value, 'tweenProp', addError, path, nodeId);
      requireActionNumber(value, 'tweenTarget', addError, path, nodeId);
      requireActionNumber(value, 'tweenDuration', addError, path, nodeId, 0);
      requireActionEnum(value, 'tweenEasing', [...EASINGS], addError, path, nodeId);
      break;
    case 'wait':
      requireActionNumber(value, 'waitFrames', addError, path, nodeId, 0);
      break;
  }
  if (value.condition !== undefined) validateActionCondition(value.condition, addError, `${path}.condition`, nodeId);
}

function requireActionString(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string): void {
  if (typeof value[key] !== 'string') addError('invalid-value', `${key} must be a string.`, `${path}.${key}`, nodeId);
}

function requireActionNumber(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string, min?: number): void {
  if (!isFiniteNumber(value[key]) || (min !== undefined && value[key] < min)) addError('invalid-value', `${key} must be a finite number${min !== undefined ? ` >= ${min}` : ''}.`, `${path}.${key}`, nodeId);
}

function requireActionInteger(value: Record<string, unknown>, key: string, addError: AddIssue, path: string, nodeId?: string, min?: number): void {
  if (!Number.isInteger(value[key]) || (min !== undefined && Number(value[key]) < min)) addError('invalid-value', `${key} must be an integer${min !== undefined ? ` >= ${min}` : ''}.`, `${path}.${key}`, nodeId);
}

function requireActionEnum(value: Record<string, unknown>, key: string, allowed: readonly string[], addError: AddIssue, path: string, nodeId?: string): void {
  if (typeof value[key] !== 'string' || !allowed.includes(value[key])) addError('invalid-value', `${key} has an unsupported value.`, `${path}.${key}`, nodeId);
}

function validateActionCondition(value: unknown, addError: AddIssue, path: string, nodeId?: string): void {
  if (!isRecord(value) || !['switch', 'variable', 'code'].includes(String(value.type))) {
    addError('invalid-value', 'Action condition is invalid.', path, nodeId);
    return;
  }
  if (value.type === 'switch' && (!Number.isInteger(value.switchId) || value.switchId < 1)) {
    addError('invalid-reference', 'Action switch condition requires a positive switchId.', `${path}.switchId`, nodeId);
  }
  if (value.type === 'variable' && (!Number.isInteger(value.variableId) || value.variableId < 1 || !['==', '>=', '<=', '>', '<', '!='].includes(String(value.operator)) || !isFiniteNumber(value.value))) {
    addError('invalid-reference', 'Action variable condition is invalid.', path, nodeId);
  }
  if (value.type === 'code' && (typeof value.code !== 'string' || !compileExpressionCode(value.code))) {
    addError('invalid-code', 'Action condition code has invalid JavaScript syntax.', `${path}.code`, nodeId);
  }
}

function validateSceneScript(value: unknown, addError: AddIssue): void {
  if (!isRecord(value) || value.version !== UI_DESIGNER_SCENE_SCRIPT_VERSION || typeof value.source !== 'string') {
    addError('empty-code', `sceneScript must contain version ${UI_DESIGNER_SCENE_SCRIPT_VERSION} and a string source.`, 'sceneScript');
    return;
  }
  const syntaxError = uiSceneScriptSyntaxError(value.source);
  if (syntaxError) addError('invalid-code', `Scene script has invalid JavaScript syntax: ${syntaxError}`, 'sceneScript.source');
}

function detectCycles(nodes: unknown[], addError: AddIssue): void {
  const parents = new Map<string, string | null>();
  for (const node of nodes) {
    if (isRecord(node) && isNonEmptyString(node.id)) parents.set(node.id, isNonEmptyString(node.parentId) ? node.parentId : null);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      addError('cycle', `Node tree contains a cycle at ${id}.`, `nodes.${id}`, id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = parents.get(id);
    if (parent && parents.has(parent)) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of parents.keys()) visit(id);
}

function validateNodeReferences(nodes: unknown[], ids: Set<string>, addError: AddIssue): void {
  for (const node of nodes) {
    if (!isRecord(node) || !isNonEmptyString(node.id) || !isRecord(node.events)) continue;
    for (const [eventName, handler] of Object.entries(node.events)) {
      if (!isRecord(handler) || !Array.isArray(handler.actions)) continue;
      handler.actions.forEach((action, index) => {
        if (!isRecord(action)) return;
        if ((action.type === 'toggleNode' && isNonEmptyString(action.targetNodeId) && !ids.has(action.targetNodeId))
          || (action.type === 'tweenProp' && isNonEmptyString(action.tweenNodeId) && !ids.has(action.tweenNodeId))) {
          addError('invalid-reference', `Action in ${eventName} references a missing node.`, `nodes.${node.id}.events.${eventName}.actions[${index}]`, node.id);
        }
      });
    }
  }
}

function compileCode(source: string): boolean {
  try {
    // Compile only; runtime execution is deliberately handled by the runtime
    // adapter and is not claimed to be sandboxed here.
    // eslint-disable-next-line no-new-func
    new Function(source);
    return true;
  } catch {
    return false;
  }
}

function compileExpressionCode(source: string): boolean {
  try {
    // Property/condition fields are expressions in the editor ABI; wrapping
    // them in a return keeps validation aligned with the runtime evaluator.
    new Function(`return (${source});`);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

type AddIssue = (
  code: UiValidationCode,
  message: string,
  path?: string,
  nodeId?: string,
) => void;

export function isUiDesignerNodeType(value: unknown): value is UiDesignerNodeType {
  return typeof value === 'string' && NODE_TYPES.has(value);
}
