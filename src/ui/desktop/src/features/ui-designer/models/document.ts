import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_EDITOR_VERSION,
  UI_DESIGNER_SCENE_SCRIPT_VERSION,
  type UiActionCondition,
  type UiAnimationConfig,
  type UiBaseNodeProps,
  type UiButtonNode,
  type UiButtonProps,
  type UiContainerNode,
  type UiContainerProps,
  type UiConditionFrequency,
  type UiDesignerDocument,
  type UiDesignerNodeType,
  type UiEventMap,
  type UiFrameAnimationNode,
  type UiFrameAnimationProps,
  type UiGlobalFilter,
  type UiListNode,
  type UiListProps,
  type UiNineSliceNode,
  type UiNineSliceProps,
  type UiNode,
  type UiOverlayNode,
  type UiOverlayProps,
  type UiParticleNode,
  type UiParticleProps,
  type UiProgressBarNode,
  type UiProgressBarProps,
  type UiPropertyCodes,
  type UiPropertyModes,
  type UiSpriteNode,
  type UiSpriteProps,
  type UiTextNode,
  type UiTextProps,
  type UiVideoNode,
  type UiVideoProps,
  type UiVisibilityCondition,
} from '@contract/ui-designer'
import { migrateLegacyUiSourceCode } from '@contract/ui-designer-script'
import { normalizeGeometryInteger } from './geometry'

export interface CreateNodeOptions {
  id?: string
  name?: string
  parentId?: string | null
  x?: number
  y?: number
  width?: number
  height?: number
}

export function defaultVisibilityCondition(): UiVisibilityCondition {
  return { type: 'none' }
}

export function defaultConditionFrequency(): UiConditionFrequency {
  return 'per-frame'
}

export function defaultAnimation(): UiAnimationConfig {
  return { type: 'none', duration: 300, easing: 'EaseOut' }
}

export function defaultEvents(): UiEventMap {
  return {}
}

export function defaultPropertyModes(): UiPropertyModes {
  return {}
}

export function defaultPropertyCodes(): UiPropertyCodes {
  return {}
}

function baseProps(options: CreateNodeOptions = {}): UiBaseNodeProps {
  return {
    x: normalizeGeometryInteger(options.x, 0),
    y: normalizeGeometryInteger(options.y, 0),
    width: normalizeGeometryInteger(options.width, 160, 1),
    height: normalizeGeometryInteger(options.height, 80, 1),
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
    opacity: 255,
    visible: true,
    anchorX: 0,
    anchorY: 0,
    zIndex: 0,
  }
}

function shell<TType extends UiDesignerNodeType, TProps extends UiBaseNodeProps>(
  type: TType,
  props: TProps,
  options: CreateNodeOptions,
): UiNode & { type: TType; props: TProps } {
  const identity = options.id ?? nextDefaultNodeIdentity(type)
  const defaultName = `${type[0].toUpperCase()}${type.slice(1)}_${identity.slice(identity.lastIndexOf('_') + 1)}`
  return {
    id: identity,
    type,
    name: options.name ?? defaultName,
    parentId: options.parentId ?? null,
    children: [],
    props,
    propModes: defaultPropertyModes(),
    propCodes: defaultPropertyCodes(),
    locked: false,
    condition: defaultVisibilityCondition(),
    conditionFrequency: defaultConditionFrequency(),
    enterAnim: defaultAnimation(),
    exitAnim: defaultAnimation(),
    focusAnim: defaultAnimation(),
    events: defaultEvents(),
  } as unknown as UiNode & { type: TType; props: TProps }
}

const defaultNodeSequences = new Map<UiDesignerNodeType, number>()

function nextDefaultNodeIdentity(type: UiDesignerNodeType): string {
  const next = (defaultNodeSequences.get(type) ?? 0) + 1
  defaultNodeSequences.set(type, next)
  return `node_${type}_${String(next).padStart(3, '0')}`
}

export function createDefaultNode(type: 'container', options?: CreateNodeOptions): UiContainerNode
export function createDefaultNode(type: 'list', options?: CreateNodeOptions): UiListNode
export function createDefaultNode(type: 'sprite', options?: CreateNodeOptions): UiSpriteNode
export function createDefaultNode(type: 'nineSlice', options?: CreateNodeOptions): UiNineSliceNode
export function createDefaultNode(type: 'frameAnimation', options?: CreateNodeOptions): UiFrameAnimationNode
export function createDefaultNode(type: 'button', options?: CreateNodeOptions): UiButtonNode
export function createDefaultNode(type: 'text', options?: CreateNodeOptions): UiTextNode
export function createDefaultNode(type: 'progressBar', options?: CreateNodeOptions): UiProgressBarNode
export function createDefaultNode(type: 'overlay', options?: CreateNodeOptions): UiOverlayNode
export function createDefaultNode(type: 'video', options?: CreateNodeOptions): UiVideoNode
export function createDefaultNode(type: 'particle', options?: CreateNodeOptions): UiParticleNode
export function createDefaultNode(type: UiDesignerNodeType, options?: CreateNodeOptions): UiNode
export function createDefaultNode(type: UiDesignerNodeType, options: CreateNodeOptions = {}): UiNode {
  const common = baseProps(options)
  switch (type) {
    case 'container':
      return shell(type, {
        ...common,
        width: options.width ?? 240,
        height: options.height ?? 160,
        backgroundPath: '',
        backgroundFillMode: 'stretch',
        backgroundRepeatMode: 'none',
        clip: false,
      } satisfies UiContainerProps, options) as UiContainerNode
    case 'list':
      return shell(type, {
        ...common,
        width: options.width ?? 480,
        height: options.height ?? 320,
        dataSource: '[]',
        columns: 1,
        rows: 0,
        autoFlow: 'row',
        columnGap: 8,
        rowGap: 8,
        justifyItems: 'stretch',
        alignItems: 'stretch',
        maxItems: 100,
      } satisfies UiListProps, options) as UiListNode
    case 'sprite':
      return shell(type, {
        ...common,
        path: '',
        fillMode: 'stretch',
        repeatMode: 'none',
        tint: '#ffffff',
        blendMode: 'normal',
        scrollX: 0,
        scrollY: 0,
      } satisfies UiSpriteProps, options) as UiSpriteNode
    case 'nineSlice':
      return shell(type, {
        ...common,
        path: '',
        borderTop: 8,
        borderRight: 8,
        borderBottom: 8,
        borderLeft: 8,
        showGuides: false,
      } satisfies UiNineSliceProps, options) as UiNineSliceNode
    case 'frameAnimation':
      return shell(type, {
        ...common,
        defaultFrameDuration: 100,
        loop: true,
        speed: 1,
        initialFrame: 0,
        frames: [],
        fillMode: 'contain',
      } satisfies UiFrameAnimationProps, options) as UiFrameAnimationNode
    case 'text':
      return shell(type, {
        ...common,
        content: 'Text',
        wrapWidth: 0,
        richText: false,
        fontFile: '',
        fontSize: 24,
        fontWeight: 'normal',
        italic: false,
        letterSpacing: 0,
        textColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 0,
        shadowColor: '#00000000',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowBlur: 0,
        align: 'left',
        verticalAlign: 'top',
        backgroundColor: '#00000000',
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      } satisfies UiTextProps, options) as UiTextNode
    case 'button':
      return shell(type, {
        ...common,
        content: 'Button',
        wrapWidth: 0,
        richText: false,
        fontFile: '',
        fontSize: 24,
        fontWeight: 'bold',
        italic: false,
        letterSpacing: 0,
        textColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 0,
        shadowColor: '#00000000',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowBlur: 0,
        align: 'center',
        verticalAlign: 'middle',
        backgroundColor: '#00000000',
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
        imageStates: { normal: '', hover: '', pressed: '', disabled: '' },
        borderColor: '#ffffff00',
        borderWidth: 0,
        borderRadius: 6,
        hoverTint: '#ffffff22',
        pressedScale: 1,
        disabledCondition: '',
        focusColor: '#73daca',
        focusWidth: 2,
        hoverSe: '',
        clickSe: '',
      } satisfies UiButtonProps, options) as UiButtonNode
    case 'progressBar':
      return shell(type, {
        ...common,
        width: options.width ?? 220,
        height: options.height ?? 24,
        trackImage: '',
        trackColor: '#24283b',
        trackRadius: 4,
        fillImage: '',
        fillColor: '#73daca',
        fillRadius: 4,
        fillDirection: 'leftToRight',
        currentValue: 50,
        maxValue: 100,
        animateValue: true,
      } satisfies UiProgressBarProps, options) as UiProgressBarNode
    case 'overlay':
      return shell(type, {
        ...common,
        width: options.width ?? 816,
        height: options.height ?? 624,
        fillColor: '#00000099',
        clickThrough: false,
      } satisfies UiOverlayProps, options) as UiOverlayNode
    case 'video':
      return shell(type, {
        ...common,
        path: '',
        autoplay: true,
        loop: false,
        muted: false,
        playbackRate: 1,
        posterPath: '',
      } satisfies UiVideoProps, options) as UiVideoNode
    case 'particle':
      return shell(type, {
        ...common,
        maxParticles: 32,
        emissionInterval: 3,
        emissionArea: 'rectangle',
        imagePath: '',
        shape: 'circle',
        velocityX: 0,
        velocityY: -1.2,
        velocityRandomX: 0.8,
        velocityRandomY: 0.5,
        gravityX: 0,
        gravityY: 0.04,
        rotationSpeed: 90,
        lifetime: 60,
        lifetimeRandom: 18,
        startScale: 1,
        endScale: 0.25,
        startOpacity: 255,
        endOpacity: 0,
        startColor: '#ffd166',
        endColor: '#ff7b0000',
        blendMode: 'add',
        glow: 6,
      } satisfies UiParticleProps, options) as UiParticleNode
  }
}

export function createUiDocument(sceneName = 'Scene_New', now = new Date()): UiDesignerDocument {
  const timestamp = now.toISOString()
  const root = createDefaultNode('container', {
    id: 'node_root',
    name: 'root',
    width: 816,
    height: 624,
  })
  root.props.clip = true
  const globalFilter: UiGlobalFilter = { blur: 0, glow: 0, preset: '' }
  return {
    version: UI_DESIGNER_DOCUMENT_VERSION,
    editorVersion: UI_DESIGNER_EDITOR_VERSION,
    meta: {
      sceneName: sceneName.trim() || 'Scene_New',
      sceneBase: 'Scene_Base',
      canvasWidth: 816,
      canvasHeight: 624,
      author: '',
      description: '',
      created: timestamp,
      modified: timestamp,
    },
    transitions: {
      enter: { type: 'fade', duration: 300 },
      exit: { type: 'fade', duration: 300 },
    },
    globalFilter,
    canvas: {
      width: 816,
      height: 624,
      backgroundColor: '#1a1b26',
      backgroundPattern: 'solid',
      grid: { enabled: true, size: 32, color: '#414868' },
      snap: { enabled: true, smartEnabled: true, sensitivity: 5 },
      rulers: true,
      guidesVisible: true,
      mapBackground: { mapId: 0, blur: 0, switchId: 0 },
    },
    guides: [],
    nodes: [root],
    zOrder: [root.id],
    sceneScript: {
      version: UI_DESIGNER_SCENE_SCRIPT_VERSION,
      source: migrateLegacyUiSourceCode({ ready: '', update: '' }),
    },
  }
}

export function cloneUiDocument(document: UiDesignerDocument): UiDesignerDocument {
  return JSON.parse(JSON.stringify(document)) as UiDesignerDocument
}

export function findNode(document: UiDesignerDocument, id: string): UiNode | undefined {
  return document.nodes.find((node) => node.id === id)
}

export function findNodes(document: UiDesignerDocument, ids: readonly string[]): UiNode[] {
  const wanted = new Set(ids)
  return document.nodes.filter((node) => wanted.has(node.id))
}

/** Keep editor canvas settings mirrored with the source format's meta size. */
export function setCanvasDimensions(document: UiDesignerDocument, width: number, height: number): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const safeWidth = normalizeGeometryInteger(width, next.meta.canvasWidth, 1)
  const safeHeight = normalizeGeometryInteger(height, next.meta.canvasHeight, 1)
  next.meta.canvasWidth = safeWidth
  next.meta.canvasHeight = safeHeight
  next.canvas.width = safeWidth
  next.canvas.height = safeHeight
  return next
}

export function nextNodeId(document: UiDesignerDocument, type: UiDesignerNodeType): string {
  const prefix = `node_${type}_`
  const numbers = document.nodes
    .filter((node) => node.id.startsWith(prefix))
    .map((node) => Number(node.id.slice(prefix.length)))
    .filter((value) => Number.isInteger(value))
  const next = numbers.length ? Math.max(...numbers) + 1 : 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

export function touchDocument(document: UiDesignerDocument, now = new Date()): UiDesignerDocument {
  const next = cloneUiDocument(document)
  next.meta.modified = now.toISOString()
  return next
}

export function makeActionCondition(type: UiActionCondition['type'] = 'switch'): UiActionCondition {
  if (type === 'switch') return { type, switchId: 1 }
  if (type === 'variable') return { type, variableId: 1, operator: '>=', value: 1 }
  return { type, code: 'true' }
}
