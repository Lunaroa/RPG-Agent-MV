import {
  FabricImage,
  type FabricObject,
  Group,
  Rect,
  Shadow,
  Textbox,
  controlsUtils,
} from 'fabric'
import type {
  UiButtonNode,
  UiDesignerDocument,
  UiNode,
  UiParticleNode,
  UiProjectResourceCatalog,
  UiResourceEntry,
  UiTextNode,
} from '@contract/ui-designer'
import { UI_BUTTON_WINDOW_SKIN_RESOURCE_PATH } from '@contract/ui-designer-resources'
import { collectNodeSubtreeIds, resolveTreeOrderRanks } from '../models/tree'
import { resolveUiListGridExtent } from '../models/listLayout'
import { resizeCursor, resolveUiNodeResizePatch, type UiResizeHandle } from '../models/geometry'
import { subtreeContainsLockedNode } from '../models/actions'
import { uiDesignerText } from '../i18n'
import { UiLayoutTextbox } from './uiLayoutTextbox'
import { normalizeUiSingleLineText } from './uiSingleLineText'
import { UiNineSliceImage } from './uiNineSliceImage'
import { UiParticleObject } from './uiParticleObject'
import { resolveUiFabricTextPresentationSync } from './uiFabricTextPresentation'
import { UiWindowSkinTextbox } from './uiWindowSkinTextbox'
import { installUiFabricFontFamily, loadUiFabricFont } from './uiFabricFont'

export interface UiFabricNativeTextProfile {
  fontFamily?: string
  outline?: { color: string; width: number }
}

export interface UiFabricObjectData {
  nodeId: string
  nodeType: UiNode['type']
  signature: string
  animated?: boolean
  particlePhases?: number[]
  videoElement?: HTMLVideoElement
  fontFamily?: string
  nativeTextProfile?: UiFabricNativeTextProfile
  ownClipPath?: FabricObject['clipPath']
  hierarchyClipPath?: FabricObject['clipPath']
}

export type UiFabricNodeObject = FabricObject & { data: UiFabricObjectData }

const normalizeResourcePath = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase()

export function resolveFabricResource(catalog: UiProjectResourceCatalog | null | undefined, path: string): UiResourceEntry | undefined {
  if (!path) return undefined
  const normalized = normalizeResourcePath(path)
  return catalog?.resources.find((entry) => normalizeResourcePath(entry.relativePath ?? entry.path) === normalized)
}

const previewUrlFor = (catalog: UiProjectResourceCatalog | null | undefined, path: string) => {
  const resource = resolveFabricResource(catalog, path)
  return resource?.previewUrl ?? resource?.thumbnailUrl
}

// The engines' native window-text outline defaults; the preview runtime reads
// the live values from the engine Bitmap, this table mirrors them for design
// state so both sides render the same stroke.
const NATIVE_TEXT_OUTLINE: Record<'MV' | 'MZ', { color: string; width: number }> = {
  MV: { color: 'rgba(0, 0, 0, 0.5)', width: 4 },
  MZ: { color: 'rgba(0, 0, 0, 0.5)', width: 3 },
}

const NATIVE_MAIN_FONT_FILES: Record<'MV' | 'MZ', { path: string; family: string }> = {
  MV: { path: 'fonts/mplus-1m-regular.ttf', family: 'GameFont' },
  MZ: { path: 'fonts/rmmz-mainfont.ttf', family: 'rmmz-mainfont' },
}

const catalogEngine = (catalog: UiProjectResourceCatalog | null | undefined): 'MV' | 'MZ' | undefined =>
  catalog?.engine === 'MZ' ? 'MZ' : catalog?.engine === 'MV' ? 'MV' : undefined

/** Identity of the native text profile: changes here rebuild text/button objects. */
export const nativeTextSignature = (catalog: UiProjectResourceCatalog | null | undefined): string => {
  const engine = catalogEngine(catalog)
  if (!engine) return ''
  const file = NATIVE_MAIN_FONT_FILES[engine]
  return JSON.stringify([engine, catalog?.mainFontFace ?? '', previewUrlFor(catalog, file.path) ?? ''])
}

/** Resolve the project's engine-native font family and outline defaults. */
export const resolveNativeTextProfile = async (catalog: UiProjectResourceCatalog | null | undefined): Promise<UiFabricNativeTextProfile> => {
  const engine = catalogEngine(catalog)
  if (!engine) return {}
  const face = catalog?.mainFontFace?.trim() || (engine === 'MV' ? 'GameFont' : 'rmmz-mainfont, sans-serif')
  const file = NATIVE_MAIN_FONT_FILES[engine]
  const url = previewUrlFor(catalog, file.path)
  if (url && face.includes(file.family)) {
    // Install the shipped game font under its engine family name so design
    // state shows the real glyphs; on failure the family string still falls
    // back through its own list.
    await installUiFabricFontFamily(file.family, url).catch(() => undefined)
  }
  return { fontFamily: face, outline: NATIVE_TEXT_OUTLINE[engine] }
}

const geometryKeys = new Set(['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotate', 'opacity', 'visible', 'anchorX', 'anchorY', 'zIndex'])
const scaleControlHandles = {
  tl: 'nw',
  mt: 'n',
  tr: 'ne',
  mr: 'e',
  br: 'se',
  mb: 's',
  bl: 'sw',
  ml: 'w',
} as const satisfies Record<string, UiResizeHandle>

export function configureFabricScaleControls(object: FabricObject) {
  for (const [key, handle] of Object.entries(scaleControlHandles)) {
    const control = object.controls[key]
    if (!control) continue
    control.cursorStyleHandler = (_event, _control, target) => resizeCursor(handle, target.getTotalAngle())
    control.actionHandler = key === 'ml' || key === 'mr'
      ? controlsUtils.scalingX
      : key === 'mt' || key === 'mb'
        ? controlsUtils.scalingY
        : controlsUtils.scalingEqually
    control.actionName = 'scale'
    control.getActionName = () => 'scale'
  }
}

export function fabricNodeVisualSignature(node: UiNode, catalog: UiProjectResourceCatalog | null | undefined): string {
  const native = nativeTextSignature(catalog)
  if (node.type === 'text') return JSON.stringify([node.type, node.props.fontFile, previewUrlFor(catalog, node.props.fontFile) ?? '', native])
  if (node.type === 'button') {
    const statePath = node.props.imageStates.normal
    return JSON.stringify([
      node.type,
      statePath,
      previewUrlFor(catalog, statePath) ?? '',
      previewUrlFor(catalog, UI_BUTTON_WINDOW_SKIN_RESOURCE_PATH) ?? '',
      node.props.fontFile,
      previewUrlFor(catalog, node.props.fontFile) ?? '',
      native,
    ])
  }
  if (node.type === 'nineSlice') return JSON.stringify([node.type, node.props.path, previewUrlFor(catalog, node.props.path) ?? ''])
  if (node.type === 'particle') return JSON.stringify([node.type, node.props.imagePath, previewUrlFor(catalog, node.props.imagePath) ?? ''])
  const visual = Object.fromEntries(Object.entries(node.props).filter(([key]) => !geometryKeys.has(key)))
  const paths = Object.values(visual).flatMap((value) => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap((item) => typeof item === 'object' && item && 'path' in item ? [String(item.path)] : []) : [])
  const resources = paths.map((path) => previewUrlFor(catalog, path) ?? '')
  return JSON.stringify([node.type, node.props.width, node.props.height, visual, resources])
}

const nodeAncestors = (document: UiDesignerDocument, node: UiNode) => {
  const byId = new Map(document.nodes.map((candidate) => [candidate.id, candidate]))
  const ancestors: UiNode[] = []
  const visited = new Set<string>()
  let parentId = node.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parentId
  }
  return ancestors
}

const commonObjectOptions = (node: UiNode, document?: UiDesignerDocument) => {
  const ancestors = document ? nodeAncestors(document, node) : []
  const locked = node.locked || ancestors.some((ancestor) => ancestor.locked)
  // A node whose subtree contains a locked descendant fails the shared
  // transform policy; block the canvas gesture itself so the visual never
  // diverges from the document when the commit is refused.
  const transformLocked = locked || (document ? subtreeContainsLockedNode(document, node) : false)
  const visible = node.props.visible && ancestors.every((ancestor) => ancestor.props.visible)
  return ({
  left: node.props.x,
  top: node.props.y,
  originX: node.props.anchorX,
  originY: node.props.anchorY,
  angle: node.props.rotate,
  opacity: Math.max(0, Math.min(1, node.props.opacity / 255)),
  visible,
  // Locked nodes (directly or via an ancestor) must not be selectable on the
  // canvas: pointer events pass through to whatever sits underneath.
  selectable: !locked,
  evented: !locked,
  lockMovementX: transformLocked,
  lockMovementY: transformLocked,
  lockScalingX: transformLocked,
  lockScalingY: transformLocked,
  lockRotation: transformLocked,
  centeredRotation: true,
  hasControls: !transformLocked,
  hoverCursor: locked ? 'default' : transformLocked ? 'not-allowed' : 'move',
  borderColor: '#d06b42',
  cornerColor: '#d06b42',
  cornerStrokeColor: '#171a24',
  cornerStyle: 'rect' as const,
  cornerSize: 9,
  transparentCorners: false,
  padding: 0,
  objectCaching: false,
  })
}

const decorate = <T extends FabricObject>(object: T, node: UiNode, signature: string, document: UiDesignerDocument, extra: Partial<UiFabricObjectData> = {}): T & { data: UiFabricObjectData } => {
  const decorated = object as T & { data: UiFabricObjectData }
  decorated.data = { nodeId: node.id, nodeType: node.type, signature, ownClipPath: object.clipPath, ...extra }
  decorated.set(commonObjectOptions(node, document))
  configureFabricScaleControls(decorated)
  decorated.setCoords()
  return decorated
}

const boundary = (width: number, height: number, options: { fill?: string; stroke?: string; dash?: number[]; radius?: number } = {}) => new Rect({
  left: 0,
  top: 0,
  originX: 'center',
  originY: 'center',
  width,
  height,
  fill: options.fill ?? '#00000000',
  stroke: options.stroke,
  strokeDashArray: options.dash,
  strokeWidth: options.stroke ? 1 : 0,
  rx: options.radius ?? 0,
  ry: options.radius ?? 0,
  selectable: false,
  evented: false,
  objectCaching: false,
})

const imageSourceDimensions = (image: FabricImage) => {
  const source = image.getElement() as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number }
  return {
    width: Math.max(1, source.naturalWidth || source.videoWidth || Number(source.width) || image.width || 1),
    height: Math.max(1, source.naturalHeight || source.videoHeight || Number(source.height) || image.height || 1),
  }
}

const applyImageBounds = (image: FabricImage, width: number, height: number, fillMode: string) => {
  const source = imageSourceDimensions(image)
  let cropX = 0
  let cropY = 0
  let renderedWidth = source.width
  let renderedHeight = source.height
  if (fillMode === 'cover') {
    const targetRatio = width / height
    const sourceRatio = source.width / source.height
    if (sourceRatio > targetRatio) {
      renderedWidth = source.height * targetRatio
      cropX = (source.width - renderedWidth) / 2
    } else if (sourceRatio < targetRatio) {
      renderedHeight = source.width / targetRatio
      cropY = (source.height - renderedHeight) / 2
    }
  }
  const widthRatio = width / renderedWidth
  const heightRatio = height / renderedHeight
  const scale = fillMode === 'contain' ? Math.min(widthRatio, heightRatio) : 1
  image.set({
    left: 0,
    top: 0,
    originX: 'center',
    originY: 'center',
    width: renderedWidth,
    height: renderedHeight,
    cropX,
    cropY,
    scaleX: fillMode === 'contain' ? scale : widthRatio,
    scaleY: fillMode === 'contain' ? scale : heightRatio,
  })
}

const clipBoundary = (width: number, height: number) => boundary(width, height, { fill: '#000000' })

const placeholder = (node: UiNode, label: string, fill = '#1d2230') => new Group([
  boundary(node.props.width, node.props.height, { fill, stroke: '#7f879b', dash: [5, 4], radius: 4 }),
  new Textbox(label, {
    left: 0,
    top: 0,
    originX: 'center',
    originY: 'center',
    width: Math.max(32, node.props.width - 16),
    fontSize: Math.max(11, Math.min(16, node.props.height / 4)),
    fill: '#c7cbd6',
    textAlign: 'center',
    splitByGrapheme: true,
    selectable: false,
    evented: false,
  }),
], { objectCaching: false })

const imageInBounds = async (node: UiNode, url: string, fillMode: string) => {
  const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
  image.set({
    selectable: false,
    evented: false,
    objectCaching: true,
  })
  applyImageBounds(image, node.props.width, node.props.height, fillMode)
  return new Group([boundary(node.props.width, node.props.height), image], { objectCaching: false })
}

const createImageNode = async (node: UiNode, path: string, fillMode: string, catalog: UiProjectResourceCatalog | null | undefined, emptyLabel: string) => {
  const url = previewUrlFor(catalog, path)
  if (!url) return placeholder(node, path ? `${emptyLabel}\n${path}` : emptyLabel)
  try {
    return await imageInBounds(node, url, fillMode)
  } catch {
    return placeholder(node, `${emptyLabel}\n${path}`, '#2b1d25')
  }
}

const createNineSliceNode = async (node: Extract<UiNode, { type: 'nineSlice' }>, catalog: UiProjectResourceCatalog | null | undefined, emptyLabel: string) => {
  const url = previewUrlFor(catalog, node.props.path)
  if (!url) return placeholder(node, node.props.path ? `${emptyLabel}\n${node.props.path}` : emptyLabel)
  try {
    const source = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    return new UiNineSliceImage(source.getElement() as HTMLImageElement | HTMLCanvasElement, {
      width: node.props.width,
      height: node.props.height,
      originX: 'center',
      originY: 'center',
      objectCaching: false,
      borders: {
        top: node.props.borderTop,
        right: node.props.borderRight,
        bottom: node.props.borderBottom,
        left: node.props.borderLeft,
      },
      showGuides: node.props.showGuides,
    })
  } catch {
    return placeholder(node, `${emptyLabel}\n${node.props.path}`, '#2b1d25')
  }
}

const textShadow = (node: UiTextNode | UiButtonNode) => node.props.shadowBlur || node.props.shadowOffsetX || node.props.shadowOffsetY
  ? new Shadow({ color: node.props.shadowColor, blur: node.props.shadowBlur, offsetX: node.props.shadowOffsetX, offsetY: node.props.shadowOffsetY })
  : undefined

const applyTextStyle = (object: Textbox, node: UiTextNode | UiButtonNode, fontFamily?: string, native?: UiFabricNativeTextProfile) => {
  const strokeWidth = node.props.strokeWidth > 0 ? node.props.strokeWidth : (native?.outline?.width ?? 0)
  const strokeColor = node.props.strokeWidth > 0 ? node.props.strokeColor : native?.outline?.color
  object.set({
    text: normalizeUiSingleLineText(node.props.content),
    width: Math.max(20, node.props.width),
    height: Math.max(20, node.props.height),
    fontSize: node.props.fontSize,
    fontWeight: node.props.fontWeight,
    fontStyle: node.props.italic ? 'italic' : 'normal',
    fontFamily: fontFamily || native?.fontFamily || 'sans-serif',
    charSpacing: node.props.letterSpacing * 10,
    fill: node.props.textColor,
    stroke: strokeWidth > 0 ? strokeColor : undefined,
    strokeWidth,
    // The engine draws the outline behind the fill; match that paint order.
    paintFirst: strokeWidth > 0 ? 'stroke' : 'fill',
    textAlign: node.props.align,
    backgroundColor: node.type === 'button' ? '#00000000' : node.props.backgroundColor,
    shadow: textShadow(node),
    splitByGrapheme: true,
    lineHeight: 1.2,
    editable: !node.locked,
    lockScalingY: node.locked,
    ...(object instanceof UiLayoutTextbox
      ? { layoutHeight: Math.max(20, node.props.height), verticalTextAlign: node.props.verticalAlign }
      : {}),
  })
  object.setCoords()
}

const createTextNode = (node: UiTextNode | UiButtonNode, fontFamily?: string, native?: UiFabricNativeTextProfile) => {
  const object = new UiLayoutTextbox(node.props.content, {
    ...commonObjectOptions(node),
    width: Math.max(20, node.props.width),
    layoutHeight: Math.max(20, node.props.height),
    verticalTextAlign: node.props.verticalAlign,
    scaleX: node.props.scaleX,
    scaleY: node.props.scaleY,
    splitByGrapheme: true,
    editable: !node.locked,
    backgroundColor: node.props.backgroundColor,
  })
  applyTextStyle(object, node, fontFamily, native)
  return object
}

const loadFabricImageSource = async (url: string | undefined) => {
  if (!url) return undefined
  try {
    return (await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })).getElement() as CanvasImageSource
  } catch {
    return undefined
  }
}

const createButtonNode = async (node: UiButtonNode, catalog: UiProjectResourceCatalog | null | undefined, fontFamily?: string, native?: UiFabricNativeTextProfile) => {
  const [stateImageElement, windowSkinElement] = await Promise.all([
    loadFabricImageSource(previewUrlFor(catalog, node.props.imageStates.normal)),
    loadFabricImageSource(previewUrlFor(catalog, UI_BUTTON_WINDOW_SKIN_RESOURCE_PATH)),
  ])
  const object = new UiWindowSkinTextbox(node.props.content, {
    ...commonObjectOptions(node),
    width: Math.max(20, node.props.width),
    layoutHeight: Math.max(20, node.props.height),
    verticalTextAlign: node.props.verticalAlign,
    scaleX: node.props.scaleX,
    scaleY: node.props.scaleY,
    splitByGrapheme: true,
    editable: !node.locked,
    backgroundColor: '#00000000',
    stateImageElement,
    windowSkinElement,
  })
  applyTextStyle(object, node, fontFamily, native)
  return object
}

const loadNodeFontFamily = async (node: UiTextNode | UiButtonNode, catalog: UiProjectResourceCatalog | null | undefined) => {
  if (!node.props.fontFile) return undefined
  const url = previewUrlFor(catalog, node.props.fontFile)
  if (!url) return undefined
  try { return await loadUiFabricFont(node.props.fontFile, url) } catch { return undefined }
}

const createContainer = async (node: Extract<UiNode, { type: 'container' }>, catalog: UiProjectResourceCatalog | null | undefined) => {
  const url = previewUrlFor(catalog, node.props.backgroundPath)
  if (url) {
    try { return await imageInBounds(node, url, node.props.backgroundFillMode) } catch { /* show the editable container shell */ }
  }
  return boundary(node.props.width, node.props.height, { fill: '#ffffff08', stroke: '#8991a6', dash: [7, 5], radius: 3 })
}

const createProgress = (node: Extract<UiNode, { type: 'progressBar' }>) => {
  const ratio = Math.max(0, Math.min(1, node.props.maxValue > 0 ? node.props.currentValue / node.props.maxValue : 0))
  const horizontal = node.props.fillDirection === 'leftToRight' || node.props.fillDirection === 'rightToLeft'
  const fillWidth = horizontal ? node.props.width * ratio : node.props.width
  const fillHeight = horizontal ? node.props.height : node.props.height * ratio
  const directionX = node.props.fillDirection === 'rightToLeft' ? 1 : -1
  const directionY = node.props.fillDirection === 'bottomToTop' ? 1 : -1
  const fillX = horizontal ? directionX * (node.props.width - fillWidth) / 2 : 0
  const fillY = horizontal ? 0 : directionY * (node.props.height - fillHeight) / 2
  return new Group([
    boundary(node.props.width, node.props.height, { fill: node.props.trackColor, radius: node.props.trackRadius }),
    new Rect({ left: fillX, top: fillY, originX: 'center', originY: 'center', width: Math.max(1, fillWidth), height: Math.max(1, fillHeight), fill: node.props.fillColor, rx: node.props.fillRadius, ry: node.props.fillRadius, selectable: false, evented: false }),
  ], { objectCaching: false })
}

const applyProgressGeometry = (object: Group, node: Extract<UiNode, { type: 'progressBar' }>) => {
  const [track, fill] = object.getObjects()
  if (!(track instanceof Rect) || !(fill instanceof Rect)) return
  const ratio = Math.max(0, Math.min(1, node.props.maxValue > 0 ? node.props.currentValue / node.props.maxValue : 0))
  const horizontal = node.props.fillDirection === 'leftToRight' || node.props.fillDirection === 'rightToLeft'
  const fillWidth = horizontal ? node.props.width * ratio : node.props.width
  const fillHeight = horizontal ? node.props.height : node.props.height * ratio
  const directionX = node.props.fillDirection === 'rightToLeft' ? 1 : -1
  const directionY = node.props.fillDirection === 'bottomToTop' ? 1 : -1
  track.set({ width: node.props.width, height: node.props.height, rx: node.props.trackRadius, ry: node.props.trackRadius })
  fill.set({
    left: horizontal ? directionX * (node.props.width - fillWidth) / 2 : 0,
    top: horizontal ? 0 : directionY * (node.props.height - fillHeight) / 2,
    width: Math.max(1, fillWidth),
    height: Math.max(1, fillHeight),
    rx: node.props.fillRadius,
    ry: node.props.fillRadius,
  })
}

const applyGroupGeometry = (object: Group, node: UiNode) => {
  if (node.type === 'progressBar') {
    applyProgressGeometry(object, node)
    object.triggerLayout()
    return
  }
  const [frame, content] = object.getObjects()
  if (frame instanceof Rect) frame.set({ width: node.props.width, height: node.props.height })
  if (content instanceof FabricImage) {
    const fillMode = node.type === 'sprite' || node.type === 'frameAnimation'
      ? node.props.fillMode
      : node.type === 'container'
        ? node.props.backgroundFillMode
        : node.type === 'video'
          ? 'stretch'
          : 'contain'
    applyImageBounds(content, node.props.width, node.props.height, fillMode)
  } else if (content instanceof Textbox) {
    content.set({
      width: Math.max(32, node.props.width - 16),
      fontSize: Math.max(11, Math.min(16, node.props.height / 4)),
    })
    content.initDimensions()
  }
  object.triggerLayout()
}

const createParticle = async (node: UiParticleNode, catalog: UiProjectResourceCatalog | null | undefined) => {
  const particleUrl = previewUrlFor(catalog, node.props.imagePath)
  const imageElement = particleUrl ? await loadFabricImageSource(particleUrl) : undefined
  return new UiParticleObject({ particleProps: node.props, imageElement, objectCaching: false })
}

const createVideo = async (node: Extract<UiNode, { type: 'video' }>, catalog: UiProjectResourceCatalog | null | undefined, emptyLabel: string) => {
  const videoUrl = previewUrlFor(catalog, node.props.path)
  const posterUrl = previewUrlFor(catalog, node.props.posterPath)
  if (!videoUrl && posterUrl) return { object: await imageInBounds(node, posterUrl, 'contain') }
  if (!videoUrl) return { object: placeholder(node, emptyLabel) }
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true
  video.loop = node.props.loop
  video.autoplay = true
  video.playsInline = true
  video.playbackRate = Math.max(0.1, node.props.playbackRate)
  if (posterUrl) video.poster = posterUrl
  await new Promise<void>((resolve) => {
    const settle = () => resolve()
    video.addEventListener('loadeddata', settle, { once: true })
    video.addEventListener('error', settle, { once: true })
    window.setTimeout(settle, 1200)
  })
  if (!video.videoWidth || !video.videoHeight) {
    const shortLabel = emptyLabel.split('\n')[0]
    return { object: placeholder(node, `${shortLabel}\n${node.props.path}`), video }
  }
  const image = new FabricImage(video, { left: 0, top: 0, originX: 'center', originY: 'center', scaleX: node.props.width / video.videoWidth, scaleY: node.props.height / video.videoHeight, selectable: false, evented: false, objectCaching: false })
  void video.play().catch(() => undefined)
  return { object: new Group([boundary(node.props.width, node.props.height), image], { objectCaching: false }), video }
}

export async function createFabricNodeObject(node: UiNode, catalog: UiProjectResourceCatalog | null | undefined, document: UiDesignerDocument, language = 'zh-CN'): Promise<UiFabricNodeObject> {
  const signature = fabricNodeVisualSignature(node, catalog)
  let object: FabricObject
  let extra: Partial<UiFabricObjectData> = {}
  if (node.type === 'container') object = await createContainer(node, catalog)
  else if (node.type === 'list') {
    const extent = resolveUiListGridExtent(node.props)
    object = boundary(extent.width, extent.height, { fill: '#ffffff04', stroke: '#d99473', dash: [8, 5], radius: 3 })
  }
  else if (node.type === 'sprite') object = await createImageNode(node, node.props.path, node.props.fillMode, catalog, uiDesignerText(language, 'canvasPlaceholderImage'))
  else if (node.type === 'nineSlice') object = await createNineSliceNode(node, catalog, uiDesignerText(language, 'canvasPlaceholderNineSlice'))
  else if (node.type === 'frameAnimation') object = await createImageNode(node, node.props.frames[node.props.initialFrame]?.path ?? node.props.frames[0]?.path ?? '', node.props.fillMode, catalog, uiDesignerText(language, 'canvasPlaceholderFrameAnimation'))
  else if (node.type === 'text') {
    const fontFamily = await loadNodeFontFamily(node, catalog)
    const native = await resolveNativeTextProfile(catalog)
    object = createTextNode(node, fontFamily, native)
    extra = { fontFamily, nativeTextProfile: native }
  }
  else if (node.type === 'button') {
    const fontFamily = await loadNodeFontFamily(node, catalog)
    const native = await resolveNativeTextProfile(catalog)
    object = await createButtonNode(node, catalog, fontFamily, native)
    extra = { fontFamily, nativeTextProfile: native }
  }
  else if (node.type === 'progressBar') object = createProgress(node)
  else if (node.type === 'overlay') object = boundary(node.props.width, node.props.height, { fill: node.props.fillColor })
  else if (node.type === 'video') {
    const result = await createVideo(node, catalog, uiDesignerText(language, 'canvasPlaceholderVideo'))
    object = result.object
    extra = { animated: Boolean(result.video), videoElement: result.video }
  } else {
    object = await createParticle(node, catalog)
    extra = { animated: true }
  }
  const decorated = decorate(object, node, signature, document, extra)
  applyFabricNodeGeometry(decorated, node, document)
  return decorated
}

const createHierarchyClipPath = (document: UiDesignerDocument, node: UiNode) => {
  // The root canvas crops at render/preview time only; the design view keeps
  // off-canvas content visible and selectable.
  const containers = nodeAncestors(document, node).filter((ancestor): ancestor is Extract<UiNode, { type: 'container' }> => ancestor.type === 'container' && ancestor.props.clip && ancestor.id !== 'node_root')
  let clipPath: FabricObject | undefined
  for (const container of containers) {
    const clip = clipBoundary(container.props.width, container.props.height)
    clip.set({
      left: container.props.x,
      top: container.props.y,
      originX: container.props.anchorX,
      originY: container.props.anchorY,
      angle: container.props.rotate,
      scaleX: container.props.scaleX,
      scaleY: container.props.scaleY,
      absolutePositioned: true,
    })
    if (clipPath) clip.clipPath = clipPath
    clipPath = clip
  }
  return clipPath
}

const applyHierarchyClipPath = (object: UiFabricNodeObject, node: UiNode, document: UiDesignerDocument) => {
  const ownClipPath = object.data.ownClipPath
  if (ownClipPath) ownClipPath.clipPath = undefined
  else object.clipPath = undefined
  object.data.hierarchyClipPath?.dispose()
  const hierarchyClipPath = createHierarchyClipPath(document, node)
  object.data.hierarchyClipPath = hierarchyClipPath
  if (ownClipPath) {
    ownClipPath.clipPath = hierarchyClipPath
    object.clipPath = ownClipPath
  } else {
    object.clipPath = hierarchyClipPath
  }
}

export function applyFabricNodeGeometry(object: UiFabricNodeObject, node: UiNode, document: UiDesignerDocument) {
  if (object instanceof Textbox && (node.type === 'text' || node.type === 'button')) {
    // Clicking the Inspector can leave Fabric's inline editor active even
    // though its hidden textarea no longer has focus. Inline typing already
    // changed object.text, while Inspector typing changes the document first.
    // Sync the latter immediately without disturbing the former's caret.
    const presentedContent = normalizeUiSingleLineText(node.props.content)
    const textSync = resolveUiFabricTextPresentationSync(object.isEditing, object.text, presentedContent)
    if (textSync.shouldSync) {
      applyTextStyle(object, node, object.data.fontFamily, object.data.nativeTextProfile)
      if (object instanceof UiLayoutTextbox) object.initDimensions()
      if (textSync.syncEditingTextarea && object.hiddenTextarea) object.hiddenTextarea.value = presentedContent
    }
  }
  if (object instanceof UiNineSliceImage && node.type === 'nineSlice') {
    object.set({ width: Math.max(1, node.props.width), height: Math.max(1, node.props.height) })
    object.setNineSliceLayout({
      top: node.props.borderTop,
      right: node.props.borderRight,
      bottom: node.props.borderBottom,
      left: node.props.borderLeft,
    }, node.props.showGuides)
  }
  if (object instanceof UiParticleObject && node.type === 'particle') object.setParticleState(node.props)
  else if (object instanceof Group) applyGroupGeometry(object, node)
  else if (object instanceof Rect && node.type === 'list') {
    // The boundary is the derived grid extent; dragging it updates track sizes.
    const extent = resolveUiListGridExtent(node.props)
    object.set({ width: extent.width, height: extent.height })
  }
  else if (object instanceof Rect && node.type !== 'nineSlice') object.set({ width: node.props.width, height: node.props.height })
  object.set({
    ...commonObjectOptions(node, document),
    left: node.props.x,
    top: node.props.y,
    originX: node.props.anchorX,
    originY: node.props.anchorY,
    angle: node.props.rotate,
    scaleX: node.props.scaleX,
    scaleY: node.props.scaleY,
  })
  applyHierarchyClipPath(object, node, document)
  object.setCoords()
}

export function positionFabricNodeFromRect(object: UiFabricNodeObject, node: UiNode, document: UiDesignerDocument, rect: { x: number; y: number; width: number; height: number }) {
  const draftNode = {
    ...node,
    props: {
      ...node.props,
      ...resolveUiNodeResizePatch(node, rect),
    },
  } as UiNode
  const draftDocument = { ...document, nodes: document.nodes.map((candidate) => candidate.id === node.id ? draftNode : candidate) }
  applyFabricNodeGeometry(object, draftNode, draftDocument)
}

export function animateFabricNode(object: UiFabricNodeObject, node: UiNode, elapsedMs: number) {
  if (node.type !== 'particle' || !(object instanceof UiParticleObject)) return false
  object.setParticleState(node.props, elapsedMs)
  return true
}

export function disposeFabricNodeObject(object: UiFabricNodeObject) {
  const video = object.data.videoElement
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  if (object.data.ownClipPath) object.data.ownClipPath.clipPath = undefined
  else object.clipPath = undefined
  object.data.hierarchyClipPath?.dispose()
  object.dispose()
}

export function scopeNodes(document: UiDesignerDocument, scopeNodeId: string) {
  const order = resolveTreeOrderRanks(document)
  const scopedIds = new Set(collectNodeSubtreeIds(document, [scopeNodeId]))
  if (scopeNodeId === 'node_root') scopedIds.delete(scopeNodeId)
  return document.nodes
    .filter((node) => scopedIds.has(node.id))
    .sort((left, right) => {
      if (left.id === scopeNodeId) return -1
      if (right.id === scopeNodeId) return 1
      return left.props.zIndex - right.props.zIndex || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
    })
}
