import type { MapOverviewEdge, MapOverviewNode } from './types.ts';

export const MAP_OVERVIEW_SVG_TILE_PX = 12;
export const MAP_OVERVIEW_SVG_LABEL_HEIGHT = 30;
export const MAP_OVERVIEW_EXPORT_PADDING = 48;

export interface MapOverviewSvgPosition {
  x: number;
  y: number;
}

export interface MapOverviewSvgNodeGeometry {
  id: number;
  name: string;
  readState: MapOverviewNode['readState'];
  mapWidth: number;
  mapHeight: number;
  width: number;
  imageHeight: number;
  labelWidth: number;
  collisionHeight: number;
  position: MapOverviewSvgPosition;
}

export interface MapOverviewSvgPoint {
  x: number;
  y: number;
}

export interface MapOverviewSvgEdgeRoute {
  index: number;
  count: number;
}

export interface MapOverviewSvgEdgeGeometry {
  id: string;
  path: string;
  source: MapOverviewSvgPoint;
  target: MapOverviewSvgPoint;
  control: MapOverviewSvgPoint;
  label: MapOverviewSvgPoint;
  bounds: MapOverviewSvgBounds;
  selfLoop: boolean;
}

export interface MapOverviewSvgBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapOverviewSvgExportBounds extends MapOverviewSvgBounds {
  width: number;
  height: number;
  translateX: number;
  translateY: number;
}

export function mapOverviewSvgNodeGeometry(
  node: Pick<MapOverviewNode, 'id' | 'name' | 'readState' | 'width' | 'height'>,
  position: MapOverviewSvgPosition,
): MapOverviewSvgNodeGeometry {
  const valid = Number.isFinite(node.width)
    && Number.isFinite(node.height)
    && Number(node.width) > 0
    && Number(node.height) > 0;
  const mapWidth = valid ? Number(node.width) : 1;
  const mapHeight = valid ? Number(node.height) : 1;
  const width = Math.round(mapWidth * MAP_OVERVIEW_SVG_TILE_PX);
  const imageHeight = Math.round(mapHeight * MAP_OVERVIEW_SVG_TILE_PX);
  const label = `${node.name} MAP${String(node.id).padStart(3, '0')}`;
  const labelWidth = Math.min(width, Math.max(72, label.length * 6.7 + 10));
  return {
    id: node.id,
    name: node.name,
    readState: node.readState,
    mapWidth,
    mapHeight,
    width,
    imageHeight,
    labelWidth,
    collisionHeight: imageHeight + MAP_OVERVIEW_SVG_LABEL_HEIGHT,
    position,
  };
}

export function mapOverviewSvgPortPoint(
  node: MapOverviewSvgNodeGeometry,
  cellX: number,
  cellY: number,
): MapOverviewSvgPoint {
  if (!Number.isInteger(cellX) || !Number.isInteger(cellY)
    || cellX < 0 || cellY < 0 || cellX >= node.mapWidth || cellY >= node.mapHeight) {
    throw new Error(`Transfer coordinates are outside MAP${String(node.id).padStart(3, '0')}.`);
  }
  return {
    x: node.position.x - node.width / 2 + (cellX + 0.5) * MAP_OVERVIEW_SVG_TILE_PX,
    y: node.position.y - node.imageHeight / 2 + (cellY + 0.5) * MAP_OVERVIEW_SVG_TILE_PX,
  };
}

export function buildMapOverviewSvgEdgeRoutes(
  edges: readonly Pick<MapOverviewEdge, 'id' | 'sourceMapId' | 'targetMapId'>[],
): Map<string, MapOverviewSvgEdgeRoute> {
  const groups = new Map<string, Array<Pick<MapOverviewEdge, 'id' | 'sourceMapId' | 'targetMapId'>>>();
  for (const edge of edges) {
    const low = Math.min(edge.sourceMapId, edge.targetMapId);
    const high = Math.max(edge.sourceMapId, edge.targetMapId);
    const key = `${low}:${high}:${edge.sourceMapId}:${edge.targetMapId}`;
    const group = groups.get(key) || [];
    group.push(edge);
    groups.set(key, group);
  }
  const routes = new Map<string, MapOverviewSvgEdgeRoute>();
  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    group.forEach((edge, index) => routes.set(edge.id, { index, count: group.length }));
  }
  return routes;
}

export function mapOverviewSvgEdgeGeometry(
  edge: Pick<MapOverviewEdge, 'id' | 'sourceMapId' | 'sourceX' | 'sourceY' | 'targetMapId' | 'targetX' | 'targetY'>,
  nodes: ReadonlyMap<number, MapOverviewSvgNodeGeometry>,
  route: MapOverviewSvgEdgeRoute = { index: 0, count: 1 },
): MapOverviewSvgEdgeGeometry {
  const sourceNode = nodes.get(edge.sourceMapId);
  const targetNode = nodes.get(edge.targetMapId);
  if (!sourceNode || !targetNode) throw new Error(`Map overview edge ${edge.id} references a missing map.`);
  const source = mapOverviewSvgPortPoint(sourceNode, edge.sourceX, edge.sourceY);
  const target = mapOverviewSvgPortPoint(targetNode, edge.targetX, edge.targetY);
  const exactLoop = source.x === target.x && source.y === target.y;
  const sameMap = edge.sourceMapId === edge.targetMapId;
  const centeredIndex = route.index - (route.count - 1) / 2;

  if (exactLoop) {
    const radius = 34 + Math.abs(centeredIndex) * 14;
    const side = centeredIndex < 0 ? -1 : 1;
    const control = { x: source.x + side * radius, y: source.y - radius };
    const path = `M ${round(source.x)} ${round(source.y)} C ${round(source.x + side * radius)} ${round(source.y - radius * 1.7)} ${round(source.x - side * radius)} ${round(source.y - radius * 1.7)} ${round(target.x)} ${round(target.y)}`;
    return {
      id: edge.id,
      path,
      source,
      target,
      control,
      label: { x: source.x, y: source.y - radius * 1.45 },
      bounds: inflateBounds({
        minX: source.x - radius,
        minY: source.y - radius * 1.8,
        maxX: source.x + radius,
        maxY: source.y,
      }, 16),
      selfLoop: true,
    };
  }

  if (sameMap) {
    const forward = edge.sourceX < edge.targetX
      || (edge.sourceX === edge.targetX && edge.sourceY <= edge.targetY);
    const side = forward ? -1 : 1;
    const radius = 42 + Math.abs(centeredIndex) * 14;
    const loopY = side < 0
      ? Math.min(source.y, target.y) - radius
      : Math.max(source.y, target.y) + radius;
    const firstControl = { x: source.x, y: loopY };
    const secondControl = { x: target.x, y: loopY };
    return {
      id: edge.id,
      path: `M ${round(source.x)} ${round(source.y)} C ${round(firstControl.x)} ${round(firstControl.y)} ${round(secondControl.x)} ${round(secondControl.y)} ${round(target.x)} ${round(target.y)}`,
      source,
      target,
      control: { x: (firstControl.x + secondControl.x) / 2, y: loopY },
      label: cubicPoint(source, firstControl, secondControl, target, 0.5),
      bounds: inflateBounds({
        minX: Math.min(source.x, target.x, firstControl.x, secondControl.x),
        minY: Math.min(source.y, target.y, firstControl.y, secondControl.y),
        maxX: Math.max(source.x, target.x, firstControl.x, secondControl.x),
        maxY: Math.max(source.y, target.y, firstControl.y, secondControl.y),
      }, 20),
      selfLoop: true,
    };
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const baseOffset = Math.min(84, Math.max(24, distance * 0.08));
  // The normal already reverses with the edge direction, so a positive offset
  // places opposite directions on opposite sides of the same map pair.
  const offset = baseOffset + centeredIndex * 14;
  const control = {
    x: (source.x + target.x) / 2 + normalX * offset,
    y: (source.y + target.y) / 2 + normalY * offset,
  };
  const label = quadraticPoint(source, control, target, 0.5);
  return {
    id: edge.id,
    path: `M ${round(source.x)} ${round(source.y)} Q ${round(control.x)} ${round(control.y)} ${round(target.x)} ${round(target.y)}`,
    source,
    target,
    control,
    label,
    bounds: inflateBounds(quadraticBounds(source, control, target), 16),
    selfLoop: false,
  };
}

export function mapOverviewSvgNodeBounds(node: MapOverviewSvgNodeGeometry): MapOverviewSvgBounds {
  const width = Math.max(node.width, node.labelWidth);
  return {
    minX: node.position.x - width / 2,
    minY: node.position.y - node.imageHeight / 2,
    maxX: node.position.x + width / 2,
    maxY: node.position.y + node.imageHeight / 2 + MAP_OVERVIEW_SVG_LABEL_HEIGHT,
  };
}

function cubicPoint(
  source: MapOverviewSvgPoint,
  firstControl: MapOverviewSvgPoint,
  secondControl: MapOverviewSvgPoint,
  target: MapOverviewSvgPoint,
  t: number,
): MapOverviewSvgPoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * source.x
      + 3 * inverse ** 2 * t * firstControl.x
      + 3 * inverse * t ** 2 * secondControl.x
      + t ** 3 * target.x,
    y: inverse ** 3 * source.y
      + 3 * inverse ** 2 * t * firstControl.y
      + 3 * inverse * t ** 2 * secondControl.y
      + t ** 3 * target.y,
  };
}

export function mapOverviewSvgExportBounds(
  nodes: Iterable<MapOverviewSvgNodeGeometry>,
  edges: Iterable<MapOverviewSvgEdgeGeometry>,
  padding = MAP_OVERVIEW_EXPORT_PADDING,
): MapOverviewSvgExportBounds {
  let bounds: MapOverviewSvgBounds | null = null;
  for (const node of nodes) bounds = unionBounds(bounds, mapOverviewSvgNodeBounds(node));
  for (const edge of edges) bounds = unionBounds(bounds, edge.bounds);
  const resolved = bounds || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const minX = Math.floor(resolved.minX - padding);
  const minY = Math.floor(resolved.minY - padding);
  const maxX = Math.ceil(resolved.maxX + padding);
  const maxY = Math.ceil(resolved.maxY + padding);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    translateX: -minX,
    translateY: -minY,
  };
}

export function mapOverviewSvgBoundsIntersect(
  left: MapOverviewSvgBounds,
  right: MapOverviewSvgBounds,
): boolean {
  return left.maxX >= right.minX && left.minX <= right.maxX
    && left.maxY >= right.minY && left.minY <= right.maxY;
}

function quadraticPoint(
  source: MapOverviewSvgPoint,
  control: MapOverviewSvgPoint,
  target: MapOverviewSvgPoint,
  t: number,
): MapOverviewSvgPoint {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * source.x + 2 * inverse * t * control.x + t * t * target.x,
    y: inverse * inverse * source.y + 2 * inverse * t * control.y + t * t * target.y,
  };
}

function quadraticBounds(
  source: MapOverviewSvgPoint,
  control: MapOverviewSvgPoint,
  target: MapOverviewSvgPoint,
): MapOverviewSvgBounds {
  const points = [source, target];
  for (const axis of ['x', 'y'] as const) {
    const denominator = source[axis] - 2 * control[axis] + target[axis];
    if (denominator === 0) continue;
    const t = (source[axis] - control[axis]) / denominator;
    if (t > 0 && t < 1) points.push(quadraticPoint(source, control, target, t));
  }
  return {
    minX: Math.min(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)),
    maxY: Math.max(...points.map(point => point.y)),
  };
}

function inflateBounds(bounds: MapOverviewSvgBounds, amount: number): MapOverviewSvgBounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

function unionBounds(left: MapOverviewSvgBounds | null, right: MapOverviewSvgBounds): MapOverviewSvgBounds {
  if (!left) return { ...right };
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
