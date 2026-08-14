import { FabricObject, type FabricObjectProps } from 'fabric'
import type { UiParticleProps } from '@contract/ui-designer'

export interface UiParticleFrame {
  x: number
  y: number
  angle: number
  opacity: number
  scale: number
  size: number
  color: string
}

export type UiParticleObjectOptions = Partial<FabricObjectProps> & {
  particleProps: UiParticleProps
  imageElement?: CanvasImageSource
}

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export const resolveUiParticleCount = (value: number) => clamp(Math.floor(finite(value, 4)), 4, 48)

const parseHexColor = (value: string) => {
  const normalized = value.trim().replace(/^#/, '')
  const expanded = normalized.length === 3 || normalized.length === 4
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized
  if (expanded.length !== 6 && expanded.length !== 8 || !/^[0-9a-f]+$/i.test(expanded)) return { red: 255, green: 255, blue: 255, alpha: 1 }
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  }
}

export const mixUiParticleColor = (from: string, to: string, progress: number) => {
  const start = parseHexColor(from)
  const end = parseHexColor(to)
  const ratio = clamp(finite(progress), 0, 1)
  const channel = (left: number, right: number) => Math.round(left + (right - left) * ratio)
  const alpha = start.alpha + (end.alpha - start.alpha) * ratio
  return `rgba(${channel(start.red, end.red)}, ${channel(start.green, end.green)}, ${channel(start.blue, end.blue)}, ${alpha})`
}

export function resolveUiParticleFrames(props: UiParticleProps, elapsedMs: number): UiParticleFrame[] {
  const count = resolveUiParticleCount(props.maxParticles)
  const halfWidth = Math.max(1, finite(props.width, 1)) / 2
  const halfHeight = Math.max(1, finite(props.height, 1)) / 2
  return Array.from({ length: count }, (_, index) => {
    const basePhase = (index * 0.61803398875) % 1
    const lifetimeRandom = Math.sin((index + 1) * 17.213) * finite(props.lifetimeRandom)
    const particleLifetimeMs = Math.max(250, (finite(props.lifetime, 1) + lifetimeRandom) * 16.6667)
    const emissionOffset = index * Math.max(1, finite(props.emissionInterval, 1)) * 16.6667 / particleLifetimeMs
    const phase = ((Math.max(0, finite(elapsedMs)) / particleLifetimeMs) + basePhase + emissionOffset) % 1
    const spreadX = props.emissionArea === 'point' ? 0 : (basePhase * 2 - 1) * halfWidth
    const spreadY = props.emissionArea === 'rectangle'
      ? (((basePhase * 1.7) % 1) * 2 - 1) * halfHeight
      : props.emissionArea === 'circle'
        ? Math.sin(basePhase * Math.PI * 2) * halfHeight
        : 0
    const seconds = phase * particleLifetimeMs / 1000
    const opacity = finite(props.startOpacity, 255) + (finite(props.endOpacity) - finite(props.startOpacity, 255)) * phase
    return {
      x: spreadX + (finite(props.velocityX) + Math.sin(index * 12.9898) * finite(props.velocityRandomX)) * seconds * 32 + finite(props.gravityX) * seconds * seconds * 16,
      y: spreadY + (finite(props.velocityY) + Math.cos(index * 7.233) * finite(props.velocityRandomY)) * seconds * 32 + finite(props.gravityY) * seconds * seconds * 16,
      angle: finite(props.rotationSpeed) * seconds,
      opacity: clamp(opacity / 255, 0, 1),
      scale: Math.max(0, finite(props.startScale, 1) + (finite(props.endScale, 1) - finite(props.startScale, 1)) * phase),
      size: 3 + (index % 4),
      color: mixUiParticleColor(props.startColor, props.endColor, phase),
    }
  })
}

const imageSourceSize = (source: CanvasImageSource) => {
  const candidate = source as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number }
  return {
    width: candidate.naturalWidth || candidate.videoWidth || Number(candidate.width) || 1,
    height: candidate.naturalHeight || candidate.videoHeight || Number(candidate.height) || 1,
  }
}

export class UiParticleObject extends FabricObject {
  declare particleProps: UiParticleProps
  declare imageElement?: CanvasImageSource
  private elapsedMs = 0

  constructor(options: UiParticleObjectOptions) {
    const { particleProps, imageElement, ...objectOptions } = options
    super({
      ...objectOptions,
      width: Math.max(1, finite(particleProps.width, 1)),
      height: Math.max(1, finite(particleProps.height, 1)),
      objectCaching: false,
    })
    this.particleProps = particleProps
    this.imageElement = imageElement
  }

  setParticleState(props: UiParticleProps, elapsedMs = this.elapsedMs) {
    this.particleProps = props
    this.elapsedMs = Math.max(0, finite(elapsedMs))
    this.set({ width: Math.max(1, finite(props.width, 1)), height: Math.max(1, finite(props.height, 1)) })
    this.dirty = true
  }

  override _render(ctx: CanvasRenderingContext2D) {
    const props = this.particleProps
    ctx.save()
    ctx.fillStyle = '#ffffff03'
    ctx.strokeStyle = '#ffffff24'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height)
    ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height)
    ctx.restore()

    const composite = props.blendMode === 'add' ? 'lighter' : props.blendMode === 'screen' ? 'screen' : 'source-over'
    for (const frame of resolveUiParticleFrames(props, this.elapsedMs)) {
      ctx.save()
      ctx.translate(frame.x, frame.y)
      ctx.rotate(frame.angle * Math.PI / 180)
      ctx.globalAlpha *= frame.opacity
      ctx.globalCompositeOperation = composite
      if (finite(props.glow) > 0) {
        ctx.shadowColor = frame.color
        ctx.shadowBlur = Math.max(0, finite(props.glow))
      }
      ctx.fillStyle = frame.color
      if (this.imageElement) this.renderImage(ctx, frame)
      else if (props.shape === 'square') ctx.fillRect(-frame.size * frame.scale, -frame.size * frame.scale, frame.size * frame.scale * 2, frame.size * frame.scale * 2)
      else if (props.shape === 'star') this.renderStar(ctx, frame.size * frame.scale)
      else {
        ctx.beginPath()
        ctx.arc(0, 0, frame.size * frame.scale, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  private renderImage(ctx: CanvasRenderingContext2D, frame: UiParticleFrame) {
    if (!this.imageElement) return
    const source = imageSourceSize(this.imageElement)
    const targetWidth = frame.size * frame.scale * 2
    const targetHeight = targetWidth * source.height / source.width
    ctx.drawImage(this.imageElement, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight)
  }

  private renderStar(ctx: CanvasRenderingContext2D, radius: number) {
    ctx.beginPath()
    for (let point = 0; point < 10; point += 1) {
      const angle = -Math.PI / 2 + point * Math.PI / 5
      const distance = point % 2 === 0 ? radius : radius * 0.45
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      if (point === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }
}
