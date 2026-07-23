import type { TreeNode } from '../components/editor/editorTypes';

export interface MapTreeSearchResult {
  tree: TreeNode[];
  expandedAncestorIds: number[];
}

export function searchMapTree(nodes: TreeNode[], query: string): MapTreeSearchResult {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { tree: nodes, expandedAncestorIds: [] };

  const mapId = parseMapIdQuery(normalized);
  const expandedAncestorIds = new Set<number>();

  function visit(node: TreeNode, ancestors: number[]): TreeNode | null {
    if (matchesMapTreeNode(node, normalized, mapId)) {
      for (const ancestorId of ancestors) expandedAncestorIds.add(ancestorId);
      return node;
    }

    const children = (node.children || [])
      .map((child) => visit(child, [...ancestors, node.id]))
      .filter((child): child is TreeNode => child !== null);
    if (!children.length) return null;

    expandedAncestorIds.add(node.id);
    return { ...node, children };
  }

  return {
    tree: nodes.map((node) => visit(node, [])).filter((node): node is TreeNode => node !== null),
    expandedAncestorIds: [...expandedAncestorIds],
  };
}

export function matchesMapTreeNode(node: TreeNode, normalizedQuery: string, mapId = parseMapIdQuery(normalizedQuery)): boolean {
  if (mapId !== null) return node.id === mapId;
  return node.name.toLowerCase().includes(normalizedQuery);
}

export function parseMapIdQuery(query: string): number | null {
  const compact = query.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(?:map)?(\d+)$/.exec(compact);
  if (!match) return null;
  const mapId = Number(match[1]);
  return Number.isSafeInteger(mapId) ? mapId : null;
}
