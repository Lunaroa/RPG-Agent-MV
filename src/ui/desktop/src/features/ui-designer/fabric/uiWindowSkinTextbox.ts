import type { UiTextVerticalAlign } from '@contract/ui-designer'
import { resolveNineSliceLayout } from '../models/nine-slice'
import { UiLayoutTextbox, type UiLayoutTextboxOptions } from './uiLayoutTextbox'

export type UiWindowSkinTextboxOptions = UiLayoutTextboxOptions & {
  windowSkinElement?: CanvasImageSource
  stateImageElement?: CanvasImageSource
}

const WINDOW_SKIN_CELL_SIZE = 96
const WINDOW_SKIN_FRAME_X = 96
const WINDOW_SKIN_FRAME_BORDER = 24
const WINDOW_SKIN_BACK_MARGIN = 4

export const resolveWindowSkinFrameLayout = (width: number, height: number) => resolveNineSliceLayout(
  WINDOW_SKIN_CELL_SIZE,
  WINDOW_SKIN_CELL_SIZE,
  width,
  height,
  {
    top: WINDOW_SKIN_FRAME_BORDER,
    right: WINDOW_SKIN_FRAME_BORDER,
    bottom: WINDOW_SKIN_FRAME_BORDER,
    left: WINDOW_SKIN_FRAME_BORDER,
  },
)

export const resolveWindowSkinBackgroundRect = (width: number, height: number) => ({
  left: -Math.max(1, width) / 2 + WINDOW_SKIN_BACK_MARGIN,
  top: -Math.max(1, height) / 2 + WINDOW_SKIN_BACK_MARGIN,
  width: Math.max(1, Math.max(1, width) - WINDOW_SKIN_BACK_MARGIN * 2),
  height: Math.max(1, Math.max(1, height) - WINDOW_SKIN_BACK_MARGIN * 2),
})

const imageSourceSize = (source: CanvasImageSource) => {
  const candidate = source as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number }
  return {
    width: candidate.naturalWidth || candidate.videoWidth || Number(candidate.width) || 0,
    height: candidate.naturalHeight || candidate.videoHeight || Number(candidate.height) || 0,
  }
}

export class UiWindowSkinTextbox extends UiLayoutTextbox {
  declare windowSkinElement?: CanvasImageSource
  declare stateImageElement?: CanvasImageSource

  constructor(text: string, options: Partial<UiWindowSkinTextboxOptions> & {
    layoutHeight: number
    verticalTextAlign: UiTextVerticalAlign
  }) {
    super(text, options)
    this.windowSkinElement = options.windowSkinElement
    this.stateImageElement = options.stateImageElement
  }

  override _render(ctx: CanvasRenderingContext2D) {
    this.renderButtonBackground(ctx)
    super._render(ctx)
  }

  private renderButtonBackground(ctx: CanvasRenderingContext2D) {
    const width = Math.max(1, this.width)
    const height = Math.max(1, this.height)
    const left = -width / 2
    const top = -height / 2

    if (this.stateImageElement) {
      ctx.drawImage(this.stateImageElement, left, top, width, height)
      return
    }

    if (!this.windowSkinElement) return
    const sourceSize = imageSourceSize(this.windowSkinElement)
    if (sourceSize.width < WINDOW_SKIN_FRAME_X + WINDOW_SKIN_CELL_SIZE || sourceSize.height < WINDOW_SKIN_CELL_SIZE) return

    const background = resolveWindowSkinBackgroundRect(width, height)
    ctx.save()
    ctx.globalAlpha *= 0.75
    ctx.drawImage(
      this.windowSkinElement,
      0,
      0,
      WINDOW_SKIN_CELL_SIZE,
      WINDOW_SKIN_CELL_SIZE,
      background.left,
      background.top,
      background.width,
      background.height,
    )
    ctx.restore()

    const layout = resolveWindowSkinFrameLayout(width, height)
    for (const [horizontalIndex, horizontal] of layout.horizontal.entries()) {
      for (const [verticalIndex, vertical] of layout.vertical.entries()) {
        if (horizontalIndex === 1 && verticalIndex === 1) continue
        if (horizontal.sourceSize <= 0 || vertical.sourceSize <= 0 || horizontal.targetSize <= 0 || vertical.targetSize <= 0) continue
        ctx.drawImage(
          this.windowSkinElement,
          WINDOW_SKIN_FRAME_X + horizontal.sourceStart,
          vertical.sourceStart,
          horizontal.sourceSize,
          vertical.sourceSize,
          horizontal.targetStart,
          vertical.targetStart,
          horizontal.targetSize,
          vertical.targetSize,
        )
      }
    }
  }
}
