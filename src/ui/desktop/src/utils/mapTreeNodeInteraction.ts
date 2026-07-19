export interface ExpandableMapTreeNode {
  isLeaf: boolean;
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
}

export function toggleMapTreeNodeExpansion(node: ExpandableMapTreeNode): boolean {
  if (node.isLeaf) return false;
  if (node.expanded) node.collapse();
  else node.expand();
  return true;
}

export function isPrimaryMapTreeNodeClick(detail: number | undefined): boolean {
  return detail == null || detail <= 1;
}
