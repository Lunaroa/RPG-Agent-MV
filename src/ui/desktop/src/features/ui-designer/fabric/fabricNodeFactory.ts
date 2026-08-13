import {
  Circle,
  FabricImage,
  type FabricObject,
  Group,
  Point,
  Rect,
  Shadow,
  Textbox,
  Triangle,
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
import { collectNodeSubtreeIds } from '../models/tree'

export interface UiFabricObjectData {
  nodeId: string
  nodeType: UiNode['type']
  signature: string
  animated?: boolean
  particlePhases?: number[]
  videoElement?: HTMLVideoElement
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

const geometryKeys = new Set(['x', 'y', 'width', 'height', 'scaleX', 'scaleY', 'rotate', 'opacity', 'visible', 'anchorX', 'anchorY', 'zIndex'])

export function fabricNodeVisualSignature(node: UiNode, catalog: UiProjectResourceCatalog | null | undefined): string {
  if (node.type === 'text' || node.type === 'button') return node.type
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
  const visible = node.props.visible && ancestors.every((ancestor) => ancestor.props.visible)
  return ({
  left: node.props.x,
  top: node.props.y,
  originX: node.props.anchorX,
  originY: node.props.anchorY,
  angle: node.props.rotate,
  opacity: Math.max(0, Math.min(1, node.props.opacity / 255)),
  visible,
  selectable: true,
  evented: true,
  lockMovementX: locked,
  lockMovementY: locked,
  lockScalingX: locked,
  lockScalingY: locked,
  lockRotation: locked,
  centeredRotation: false,
  hasControls: !locked,
  hoverCursor: locked ? 'not-allowed' : 'move',
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
  const image = await FabricImage.fromURL(url)
  const sourceWidth = Math.max(1, image.width)
  const sourceHeight = Math.max(1, image.height)
  let cropX = 0
  let cropY = 0
  let renderedWidth = sourceWidth
  let renderedHeight = sourceHeight
  if (fillMode === 'cover') {
    const targetRatio = node.props.width / node.props.height
    const sourceRatio = sourceWidth / sourceHeight
    if (sourceRatio > targetRatio) {
      renderedWidth = sourceHeight * targetRatio
      cropX = (sourceWidth - renderedWidth) / 2
    } else if (sourceRatio < targetRatio) {
      renderedHeight = sourceWidth / targetRatio
      cropY = (sourceHeight - renderedHeight) / 2
    }
  }
  const widthRatio = node.props.width / renderedWidth
  const heightRatio = node.props.height / renderedHeight
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
    selectable: false,
    evented: false,
    objectCaching: true,
  })
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

const textShadow = (node: UiTextNode | UiButtonNode) => node.props.shadowBlur || node.props.shadowOffsetX || node.props.shadowOffsetY
  ? new Shadow({ color: node.props.shadowColor, blur: node.props.shadowBlur, offsetX: node.props.shadowOffsetX, offsetY: node.props.shadowOffsetY })
  : undefined

const applyTextStyle = (object: Textbox, node: UiTextNode | UiButtonNode) => {
  object.set({
    text: node.props.content,
    width: Math.max(20, node.props.width),
    height: Math.max(20, node.props.height),
    fontSize: node.props.fontSize,
    fontWeight: node.props.fontWeight,
    fontStyle: node.props.italic ? 'italic' : 'normal',
    charSpacing: node.props.letterSpacing * 10,
    fill: node.props.textColor,
    stroke: node.props.strokeWidth > 0 ? node.props.strokeColor : undefined,
    strokeWidth: node.props.strokeWidth,
    textAlign: node.props.align,
    backgroundColor: node.props.backgroundColor,
    shadow: textShadow(node),
    splitByGrapheme: true,
    lineHeight: 1.2,
    editable: !node.locked,
    lockScalingY: node.locked,
  })
  object.setCoords()
}

const createTextNode = (node: UiTextNode | UiButtonNode) => {
  const object = new Textbox(node.props.content, {
    ...commonObjectOptions(node),
    width: Math.max(20, node.props.width),
    height: Math.max(20, node.props.height),
    scaleX: node.props.scaleX,
    scaleY: node.props.scaleY,
    splitByGrapheme: true,
    editable: !node.locked,
    backgroundColor: node.props.backgroundColor,
  })
  applyTextStyle(object, node)
  return object
}

const createContainer = async (node: Extract<UiNode, { type: 'container' }>, catalog: UiProjectResourceCatalog | null | undefined) => {
  const url = previewUrlFor(catalog, node.props.backgroundPath)
  if (url) {
    try { return await imageInBounds(node, url, node.props.backgroundFillMode) } catch { /* show the editable container shell */ }
  }
  return new Group([
    boundary(node.props.width, node.props.height, { fill: '#ffffff08', stroke: '#8991a6', dash: [7, 5], radius: 3 }),
    new Textbox(node.children.length ? `${node.name}\n${node.children.length} 个子节点` : node.name, {
      left: -node.props.width / 2 + 8,
      top: -node.props.height / 2 + 8,
      originX: 'left',
      originY: 'top',
      width: Math.max(24, node.props.width - 16),
      fontSize: 12,
      fill: '#9ea6b8',
      selectable: false,
      evented: false,
    }),
  ], { objectCaching: false })
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

type ParticleVisual = FabricObject & { __uiParticleBaseScale?: number }

const createParticle = async (node: UiParticleNode, catalog: UiProjectResourceCatalog | null | undefined) => {
  const count = Math.max(4, Math.min(48, node.props.maxParticles))
  const phases = Array.from({ length: count }, (_, index) => (index * 0.61803398875) % 1)
  const particleUrl = previewUrlFor(catalog, node.props.imagePath)
  let particleImage: FabricImage | undefined
  if (particleUrl) {
    try { particleImage = await FabricImage.fromURL(particleUrl) } catch { particleImage = undefined }
  }
  const shapes = phases.map((phase, index): ParticleVisual => {
    const size = 3 + (index % 4)
    const options = {
      left: 0,
      top: 0,
      originX: 'center' as const,
      originY: 'center' as const,
      fill: node.props.startColor,
      selectable: false,
      evented: false,
      opacity: 1 - phase,
      shadow: node.props.glow > 0 ? new Shadow({ color: node.props.startColor, blur: node.props.glow }) : undefined,
      globalCompositeOperation: (node.props.blendMode === 'add' ? 'lighter' : node.props.blendMode === 'screen' ? 'screen' : 'source-over') as GlobalCompositeOperation,
    }
    let visual: ParticleVisual
    if (particleImage) {
      const sourceWidth = Math.max(1, particleImage.width)
      visual = new FabricImage(particleImage.getElement(), { ...options }) as ParticleVisual
      visual.__uiParticleBaseScale = size * 2 / sourceWidth
      visual.set({ scaleX: visual.__uiParticleBaseScale, scaleY: visual.__uiParticleBaseScale })
    } else if (node.props.shape === 'square') visual = new Rect({ ...options, width: size * 2, height: size * 2 })
    else if (node.props.shape === 'star') visual = new Triangle({ ...options, width: size * 2.4, height: size * 2.4 })
    else visual = new Circle({ ...options, radius: size })
    return visual
  })
  return { object: new Group([boundary(node.props.width, node.props.height, { fill: '#ffffff03', stroke: '#ffffff24', dash: [4, 4] }), ...shapes], { objectCaching: false }), phases }
}

const createVideo = async (node: Extract<UiNode, { type: 'video' }>, catalog: UiProjectResourceCatalog | null | undefined) => {
  const videoUrl = previewUrlFor(catalog, node.props.path)
  const posterUrl = previewUrlFor(catalog, node.props.posterPath)
  if (!videoUrl && posterUrl) return { object: await imageInBounds(node, posterUrl, 'contain') }
  if (!videoUrl) return { object: placeholder(node, '视频\n双击选择资源') }
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
  if (!video.videoWidth || !video.videoHeight) return { object: placeholder(node, `视频\n${node.props.path}`), video }
  const image = new FabricImage(video, { left: 0, top: 0, originX: 'center', originY: 'center', scaleX: node.props.width / video.videoWidth, scaleY: node.props.height / video.videoHeight, selectable: false, evented: false, objectCaching: false })
  void video.play().catch(() => undefined)
  return { object: new Group([boundary(node.props.width, node.props.height), image], { objectCaching: false }), video }
}

export async function createFabricNodeObject(node: UiNode, catalog: UiProjectResourceCatalog | null | undefined, document: UiDesignerDocument): Promise<UiFabricNodeObject> {
  const signature = fabricNodeVisualSignature(node, catalog)
  let object: FabricObject
  let extra: Partial<UiFabricObjectData> = {}
  if (node.type === 'container') object = await createContainer(node, catalog)
  else if (node.type === 'sprite') object = await createImageNode(node, node.props.path, node.props.fillMode, catalog, '图片\n双击选择资源')
  else if (node.type === 'nineSlice') object = await createImageNode(node, node.props.path, 'stretch', catalog, '九宫格\n双击选择资源')
  else if (node.type === 'frameAnimation') object = await createImageNode(node, node.props.frames[node.props.initialFrame]?.path ?? node.props.frames[0]?.path ?? '', node.props.fillMode, catalog, '帧动画\n添加帧后即可播放')
  else if (node.type === 'text' || node.type === 'button') object = createTextNode(node)
  else if (node.type === 'progressBar') object = createProgress(node)
  else if (node.type === 'overlay') object = boundary(node.props.width, node.props.height, { fill: node.props.fillColor })
  else if (node.type === 'video') {
    const result = await createVideo(node, catalog)
    object = result.object
    extra = { animated: Boolean(result.video), videoElement: result.video }
  } else {
    const particle = await createParticle(node, catalog)
    object = particle.object
    extra = { animated: true, particlePhases: particle.phases }
  }
  const decorated = decorate(object, node, signature, document, extra)
  applyFabricNodeGeometry(decorated, node, document)
  return decorated
}

const createHierarchyClipPath = (document: UiDesignerDocument, node: UiNode) => {
  const containers = nodeAncestors(document, node).filter((ancestor): ancestor is Extract<UiNode, { type: 'container' }> => ancestor.type === 'container' && ancestor.props.clip)
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
  if (object instanceof Textbox && (node.type === 'text' || node.type === 'button') && !object.isEditing) applyTextStyle(object, node)
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
  const rotationControl = object.controls.mtr
  if (rotationControl) rotationControl.transformAnchorPoint = { x: node.props.anchorX, y: node.props.anchorY }
  applyHierarchyClipPath(object, node, document)
  object.setCoords()
}

export function positionFabricObjectFromRect(object: UiFabricNodeObject, node: UiNode, rect: { x: number; y: number; width: number; height: number }) {
  const baseWidth = Math.max(1, object.width)
  const baseHeight = Math.max(1, object.height)
  const scaleXSign = object.scaleX < 0 ? -1 : 1
  const scaleYSign = object.scaleY < 0 ? -1 : 1
  object.set({ scaleX: scaleXSign * rect.width / baseWidth, scaleY: scaleYSign * rect.height / baseHeight })
  object.setPositionByOrigin(new Point(rect.x + rect.width * node.props.anchorX, rect.y + rect.height * node.props.anchorY), node.props.anchorX, node.props.anchorY)
  object.setCoords()
}

export function animateFabricNode(object: UiFabricNodeObject, node: UiNode, elapsedMs: number) {
  if (node.type !== 'particle' || !(object instanceof Group) || !object.data.particlePhases) return false
  const children = object.getObjects().slice(1)
  const halfWidth = node.props.width / 2
  const halfHeight = node.props.height / 2
  children.forEach((shape, index) => {
    const basePhase = object.data.particlePhases?.[index] ?? 0
    const lifetimeRandom = Math.sin((index + 1) * 17.213) * node.props.lifetimeRandom
    const particleLifetimeMs = Math.max(250, (node.props.lifetime + lifetimeRandom) * 16.6667)
    const emissionOffset = index * Math.max(1, node.props.emissionInterval) * 16.6667 / particleLifetimeMs
    const phase = ((elapsedMs / particleLifetimeMs) + basePhase + emissionOffset) % 1
    const spreadX = node.props.emissionArea === 'point' ? 0 : (basePhase * 2 - 1) * halfWidth
    const spreadY = node.props.emissionArea === 'rectangle' ? (((basePhase * 1.7) % 1) * 2 - 1) * halfHeight : node.props.emissionArea === 'circle' ? Math.sin(basePhase * Math.PI * 2) * halfHeight : 0
    const seconds = phase * particleLifetimeMs / 1000
    const scale = node.props.startScale + (node.props.endScale - node.props.startScale) * phase
    const baseScale = (shape as ParticleVisual).__uiParticleBaseScale ?? 1
    shape.set({
      left: spreadX + (node.props.velocityX + Math.sin(index * 12.9898) * node.props.velocityRandomX) * seconds * 32 + node.props.gravityX * seconds * seconds * 16,
      top: spreadY + (node.props.velocityY + Math.cos(index * 7.233) * node.props.velocityRandomY) * seconds * 32 + node.props.gravityY * seconds * seconds * 16,
      angle: node.props.rotationSpeed * seconds,
      opacity: Math.max(0, Math.min(1, (node.props.startOpacity + (node.props.endOpacity - node.props.startOpacity) * phase) / 255)),
      scaleX: baseScale * scale,
      scaleY: baseScale * scale,
      fill: phase < 0.5 ? node.props.startColor : node.props.endColor,
    })
  })
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
  const order = new Map(document.zOrder.map((id, index) => [id, index]))
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
