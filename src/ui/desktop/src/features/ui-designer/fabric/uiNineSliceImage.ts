import { FabricImage, type ImageProps } from 'fabric'
import { resolveNineSliceLayout, type UiNineSliceBorders } from '../models/nine-slice'

export interface UiNineSliceImageOptions extends Partial<ImageProps> {
  borders?: Partial<UiNineSliceBorders>
  showGuides?: boolean
}

export class UiNineSliceImage extends FabricImage {
  private borders: UiNineSliceBorders = { top: 0, right: 0, bottom: 0, left: 0 }
  private showGuides = false

  constructor(element: HTMLImageElement | HTMLCanvasElement, options: UiNineSliceImageOptions = {}) {
    const { borders, showGuides, ...imageOptions } = options
    super(element, imageOptions)
    this.setNineSliceLayout(borders ?? {}, Boolean(showGuides))
  }

  setNineSliceLayout(borders: Partial<UiNineSliceBorders>, showGuides: boolean) {
    const source = this.getElement() as HTMLImageElement | HTMLCanvasElement
    const sourceWidth = 'naturalWidth' in source && source.naturalWidth ? source.naturalWidth : source.width
    const sourceHeight = 'naturalHeight' in source && source.naturalHeight ? source.naturalHeight : source.height
    const layout = resolveNineSliceLayout(sourceWidth, sourceHeight, this.width, this.height, borders)
    this.borders = layout.borders
    this.showGuides = showGuides
    this.dirty = true
  }

  override _renderFill(ctx: CanvasRenderingContext2D) {
    const source = this.getElement() as HTMLImageElement | HTMLCanvasElement
    if (!source) return
    const sourceWidth = 'naturalWidth' in source && source.naturalWidth ? source.naturalWidth : source.width
    const sourceHeight = 'naturalHeight' in source && source.naturalHeight ? source.naturalHeight : source.height
    const layout = resolveNineSliceLayout(sourceWidth, sourceHeight, this.width, this.height, this.borders)
    for (const vertical of layout.vertical) {
      for (const horizontal of layout.horizontal) {
        if (horizontal.sourceSize <= 0 || vertical.sourceSize <= 0 || horizontal.targetSize <= 0 || vertical.targetSize <= 0) continue
        ctx.drawImage(
          source,
          horizontal.sourceStart,
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
    if (!this.showGuides) return
    const [left, , right] = layout.horizontal
    const [top, , bottom] = layout.vertical
    ctx.save()
    ctx.strokeStyle = '#d06b42'
    ctx.lineWidth = 1 / Math.max(0.001, Math.max(Math.abs(this.scaleX), Math.abs(this.scaleY)))
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(left.targetStart + left.targetSize, -this.height / 2)
    ctx.lineTo(left.targetStart + left.targetSize, this.height / 2)
    ctx.moveTo(right.targetStart, -this.height / 2)
    ctx.lineTo(right.targetStart, this.height / 2)
    ctx.moveTo(-this.width / 2, top.targetStart + top.targetSize)
    ctx.lineTo(this.width / 2, top.targetStart + top.targetSize)
    ctx.moveTo(-this.width / 2, bottom.targetStart)
    ctx.lineTo(this.width / 2, bottom.targetStart)
    ctx.stroke()
    ctx.restore()
  }
}
