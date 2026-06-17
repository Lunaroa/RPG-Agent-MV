export const MV_FACE_WIDTH = 144;
export const MV_FACE_HEIGHT = 144;
export const MV_FACE_COLUMNS = 4;
export const MV_FACE_ROWS = 2;
export const MV_FACE_MAX_INDEX = MV_FACE_COLUMNS * MV_FACE_ROWS - 1;

export interface MvFaceSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function normalizeMvFaceIndex(value: unknown): number {
  const index = Number(value);
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(MV_FACE_MAX_INDEX, Math.floor(index)));
}

export function mvFaceSourceRect(faceIndex: unknown): MvFaceSourceRect {
  const index = normalizeMvFaceIndex(faceIndex);
  return {
    sx: (index % MV_FACE_COLUMNS) * MV_FACE_WIDTH,
    sy: Math.floor(index / MV_FACE_COLUMNS) * MV_FACE_HEIGHT,
    sw: MV_FACE_WIDTH,
    sh: MV_FACE_HEIGHT,
  };
}

export function mvFaceIndexFromCanvasPoint(x: number, y: number): number {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const column = Math.max(0, Math.min(MV_FACE_COLUMNS - 1, Math.floor(safeX / MV_FACE_WIDTH)));
  const row = Math.max(0, Math.min(MV_FACE_ROWS - 1, Math.floor(safeY / MV_FACE_HEIGHT)));
  return row * MV_FACE_COLUMNS + column;
}
