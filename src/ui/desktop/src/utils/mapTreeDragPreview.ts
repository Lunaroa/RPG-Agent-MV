import type { TreeNode } from '../components/editor/editorTypes';

export type MapTreeDropPosition = 'before' | 'after' | 'inside';
export type MapTreeProjectionFailure = 'same-node' | 'descendant' | 'missing-node' | 'no-op';

export interface MapTreeProjection {
  tree: TreeNode[];
  valid: boolean;
  failure?: MapTreeProjectionFailure;
}

export function resolveMapTreeDropPosition(clientY: number, rowTop: number, rowHeight: number): MapTreeDropPosition {
  const safeHeight = Math.max(1, rowHeight);
  const ratio = Math.max(0, Math.min(1, (clientY - rowTop) / safeHeight));
  if (ratio < .25) return 'before';
  if (ratio > .75) return 'after';
  return 'inside';
}

export function projectMapTreeMove(
  tree: TreeNode[],
  sourceId: number,
  targetId: number,
  position: MapTreeDropPosition,
): MapTreeProjection {
  if (sourceId === targetId) return invalid(tree, 'same-node');
  const source = findTreeNode(tree, sourceId);
  const target = findTreeNode(tree, targetId);
  if (!source || !target) return invalid(tree, 'missing-node');
  if (treeContains(source, targetId)) return invalid(tree, 'descendant');

  const projected = cloneTree(tree);
  const detached = detachTreeNode(projected, sourceId);
  if (!detached) return invalid(tree, 'missing-node');
  const inserted = insertTreeNode(projected, detached, targetId, position);
  if (!inserted) return invalid(tree, 'missing-node');
  if (treeSignature(projected) === treeSignature(tree)) return invalid(tree, 'no-op');
  synchronizeParentIds(projected, 0);
  return { tree: projected, valid: true };
}

export function findTreeNode(tree: TreeNode[], mapId: number): TreeNode | undefined {
  for (const node of tree) {
    if (node.id === mapId) return node;
    const child = node.children && findTreeNode(node.children, mapId);
    if (child) return child;
  }
  return undefined;
}

function invalid(tree: TreeNode[], failure: MapTreeProjectionFailure): MapTreeProjection {
  return { tree, valid: false, failure };
}

function cloneTree(tree: TreeNode[]): TreeNode[] {
  return tree.map((node) => ({
    ...node,
    ...(node.children?.length ? { children: cloneTree(node.children) } : { children: undefined }),
  }));
}

function treeContains(root: TreeNode, mapId: number): boolean {
  return root.id === mapId || Boolean(root.children?.some((child) => treeContains(child, mapId)));
}

function detachTreeNode(nodes: TreeNode[], mapId: number): TreeNode | undefined {
  const index = nodes.findIndex((node) => node.id === mapId);
  if (index >= 0) return nodes.splice(index, 1)[0];
  for (const node of nodes) {
    if (!node.children) continue;
    const detached = detachTreeNode(node.children, mapId);
    if (!node.children.length) delete node.children;
    if (detached) return detached;
  }
  return undefined;
}

function insertTreeNode(
  nodes: TreeNode[],
  source: TreeNode,
  targetId: number,
  position: MapTreeDropPosition,
): boolean {
  if (position === 'inside') {
    const target = findTreeNode(nodes, targetId);
    if (!target) return false;
    if (!target.children) target.children = [];
    target.children.push(source);
    return true;
  }
  return insertBeside(nodes, source, targetId, position);
}

function insertBeside(
  nodes: TreeNode[],
  source: TreeNode,
  targetId: number,
  position: Exclude<MapTreeDropPosition, 'inside'>,
): boolean {
  const index = nodes.findIndex((node) => node.id === targetId);
  if (index >= 0) {
    nodes.splice(position === 'before' ? index : index + 1, 0, source);
    return true;
  }
  for (const node of nodes) {
    if (node.children && insertBeside(node.children, source, targetId, position)) return true;
  }
  return false;
}

function treeSignature(tree: TreeNode[]): string {
  const entries: string[] = [];
  const visit = (nodes: TreeNode[], parentId: number): void => {
    nodes.forEach((node, index) => {
      entries.push(`${node.id}:${parentId}:${index}`);
      if (node.children) visit(node.children, node.id);
    });
  };
  visit(tree, 0);
  return entries.join('|');
}

function synchronizeParentIds(nodes: TreeNode[], parentId: number): void {
  for (const node of nodes) {
    node.parentId = parentId;
    if (node.children) synchronizeParentIds(node.children, node.id);
  }
}
