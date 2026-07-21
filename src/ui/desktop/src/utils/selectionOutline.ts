export const SELECTION_OUTLINE_WHITE_CSS_PX = 2;
export const SELECTION_OUTLINE_BLACK_CSS_PX = 1;

export function selectionOutlineWidths(cssScaleInput: number): { white: number; black: number } {
  const cssScale = Math.max(.01, Number(cssScaleInput) || 1);
  return {
    white: SELECTION_OUTLINE_WHITE_CSS_PX / cssScale,
    black: SELECTION_OUTLINE_BLACK_CSS_PX / cssScale,
  };
}
