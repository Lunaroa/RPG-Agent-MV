export interface MoveRoutePreviewStep {
  code: number;
  parameters?: unknown[];
}

export interface MoveRoutePreviewState {
  x: number;
  y: number;
  direction: 2 | 4 | 6 | 8;
  elapsedFrames: number;
  directionFixed: boolean;
}

export interface MoveRoutePreviewPoint extends MoveRoutePreviewState {
  stepIndex: number;
  code: number;
}

export type MoveRoutePreviewStopKind = 'random' | 'player-dependent' | 'script' | 'unknown';

export interface MoveRoutePreviewStop {
  kind: MoveRoutePreviewStopKind;
  stepIndex: number;
  code: number;
}

export interface MoveRoutePreviewResult {
  points: MoveRoutePreviewPoint[];
  finalState: MoveRoutePreviewState;
  stop: MoveRoutePreviewStop | null;
}

const DIRECTIONS = new Set([2, 4, 6, 8]);

export function simulateMoveRoute(
  steps: readonly MoveRoutePreviewStep[],
  origin: Partial<Pick<MoveRoutePreviewState, 'x' | 'y' | 'direction'>> = {},
): MoveRoutePreviewResult {
  const state: MoveRoutePreviewState = {
    x: finiteInteger(origin.x, 0),
    y: finiteInteger(origin.y, 0),
    direction: DIRECTIONS.has(Number(origin.direction)) ? Number(origin.direction) as 2 | 4 | 6 | 8 : 2,
    elapsedFrames: 0,
    directionFixed: false,
  };
  const points: MoveRoutePreviewPoint[] = [{ ...state, stepIndex: -1, code: 0 }];

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const code = Number(step?.code);
    if (code === 0) break;
    const stopKind = stopKindForCode(code);
    if (stopKind) return { points, finalState: { ...state }, stop: { kind: stopKind, stepIndex, code } };

    applyDeterministicStep(state, code, step?.parameters ?? []);
    points.push({ ...state, stepIndex, code });
  }

  return { points, finalState: { ...state }, stop: null };
}

function stopKindForCode(code: number): MoveRoutePreviewStopKind | null {
  if ([9, 23, 24].includes(code)) return 'random';
  if ([10, 11, 25, 26].includes(code)) return 'player-dependent';
  if (code === 45) return 'script';
  if (!Number.isInteger(code) || code < 0 || code > 45) return 'unknown';
  return null;
}

function applyDeterministicStep(state: MoveRoutePreviewState, code: number, parameters: readonly unknown[]): void {
  if (code >= 1 && code <= 8) {
    const [dx, dy, horizontal, vertical] = movementForCode(code);
    state.x += dx;
    state.y += dy;
    if (!state.directionFixed) {
      if (horizontal && state.direction === reverseDirection(horizontal)) state.direction = horizontal;
      if (vertical && state.direction === reverseDirection(vertical)) state.direction = vertical;
      if (!horizontal && vertical) state.direction = vertical;
      if (horizontal && !vertical) state.direction = horizontal;
    }
    return;
  }
  if (code === 12 || code === 13) {
    const direction = code === 12 ? state.direction : reverseDirection(state.direction);
    const [dx, dy] = directionOffset(direction);
    state.x += dx;
    state.y += dy;
    return;
  }
  if (code === 14) {
    const dx = finiteInteger(parameters[0], 0);
    const dy = finiteInteger(parameters[1], 0);
    state.x += dx;
    state.y += dy;
    if (!state.directionFixed) {
      if (Math.abs(dx) > Math.abs(dy) && dx !== 0) state.direction = dx < 0 ? 4 : 6;
      else if (dy !== 0) state.direction = dy < 0 ? 8 : 2;
    }
    return;
  }
  if (code === 15) {
    state.elapsedFrames += Math.max(1, finiteInteger(parameters[0], 1));
    return;
  }
  if (code >= 16 && code <= 19) {
    if (!state.directionFixed) state.direction = [2, 4, 6, 8][code - 16] as 2 | 4 | 6 | 8;
    return;
  }
  if (code === 20 && !state.directionFixed) state.direction = turnRight(state.direction);
  if (code === 21 && !state.directionFixed) state.direction = turnLeft(state.direction);
  if (code === 22 && !state.directionFixed) state.direction = reverseDirection(state.direction);
  if (code === 35) state.directionFixed = true;
  if (code === 36) state.directionFixed = false;
}

function movementForCode(code: number): [number, number, 4 | 6 | null, 2 | 8 | null] {
  const movements: Record<number, [number, number, 4 | 6 | null, 2 | 8 | null]> = {
    1: [0, 1, null, 2],
    2: [-1, 0, 4, null],
    3: [1, 0, 6, null],
    4: [0, -1, null, 8],
    5: [-1, 1, 4, 2],
    6: [1, 1, 6, 2],
    7: [-1, -1, 4, 8],
    8: [1, -1, 6, 8],
  };
  return movements[code];
}

function directionOffset(direction: 2 | 4 | 6 | 8): [number, number] {
  if (direction === 2) return [0, 1];
  if (direction === 4) return [-1, 0];
  if (direction === 6) return [1, 0];
  return [0, -1];
}

function reverseDirection(direction: 2 | 4 | 6 | 8): 2 | 4 | 6 | 8 {
  return (10 - direction) as 2 | 4 | 6 | 8;
}

function turnRight(direction: 2 | 4 | 6 | 8): 2 | 4 | 6 | 8 {
  return ({ 2: 4, 4: 8, 8: 6, 6: 2 } as const)[direction];
}

function turnLeft(direction: 2 | 4 | 6 | 8): 2 | 4 | 6 | 8 {
  return ({ 2: 6, 6: 8, 8: 4, 4: 2 } as const)[direction];
}

function finiteInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}
