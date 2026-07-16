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

export function mvFaceSourceRect(faceIndex: unknown, faceSize = MV_FACE_WIDTH): MvFaceSourceRect {
  const index = normalizeMvFaceIndex(faceIndex);
  const size = normalizeFaceSize(faceSize);
  return {
    sx: (index % MV_FACE_COLUMNS) * size,
    sy: Math.floor(index / MV_FACE_COLUMNS) * size,
    sw: size,
    sh: size,
  };
}

export function mvFaceIndexFromCanvasPoint(x: number, y: number, faceSize = MV_FACE_WIDTH): number {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const size = normalizeFaceSize(faceSize);
  const column = Math.max(0, Math.min(MV_FACE_COLUMNS - 1, Math.floor(safeX / size)));
  const row = Math.max(0, Math.min(MV_FACE_ROWS - 1, Math.floor(safeY / size)));
  return row * MV_FACE_COLUMNS + column;
}

export function normalizeFaceSize(value: unknown): number {
  const size = Number(value);
  return Number.isInteger(size) && size > 0 ? size : MV_FACE_WIDTH;
}
