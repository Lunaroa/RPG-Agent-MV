import { Point, Rect } from 'fabric'

/** A layout box owns its dimensions; its decorative stroke cannot enlarge them. */
export class UiLayoutRect extends Rect {
  override _getNonTransformedDimensions() {
    return new Point(this.width, this.height)
  }

  override _getTransformedDimensions(options: Parameters<Rect['_getTransformedDimensions']>[0] = {}) {
    return super._getTransformedDimensions({ ...options, strokeWidth: 0 })
  }

  protected override isStrokeAccountedForInDimensions() {
    return true
  }
}
