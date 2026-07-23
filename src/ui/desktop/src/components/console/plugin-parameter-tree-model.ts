import type { PluginParameterRow } from './plugin-parameter-model';

export type PluginParameterHierarchyIssue =
  | { kind: 'missing-parent'; parentKey: string }
  | { kind: 'circular-parent'; parentKey: string };

export interface PluginParameterTreeNode {
  key: string;
  row: PluginParameterRow;
  declaredParentKey: string;
  parentKey: string;
  children: PluginParameterTreeNode[];
  issue: PluginParameterHierarchyIssue | null;
}

export interface PluginParameterTree {
  roots: PluginParameterTreeNode[];
  nodes: Map<string, PluginParameterTreeNode>;
}

export interface VisiblePluginParameterTreeRow extends PluginParameterRow {
  depth: number;
  parentKey: string;
  childKeys: string[];
  hasChildren: boolean;
  expanded: boolean;
  hierarchyIssue: PluginParameterHierarchyIssue | null;
}

export function buildPluginParameterTree(
  rows: PluginParameterRow[],
): PluginParameterTree {
  const nodes = new Map<string, PluginParameterTreeNode>();
  for (const row of rows) {
    if (nodes.has(row.key)) continue;
    const declaredParentKey = row.field?.parent?.trim() || '';
    nodes.set(row.key, {
      key: row.key,
      row,
      declaredParentKey,
      parentKey: declaredParentKey,
      children: [],
      issue: null,
    });
  }

  for (const node of nodes.values()) {
    if (!node.parentKey) continue;
    if (!nodes.has(node.parentKey)) {
      node.issue = {
        kind: 'missing-parent',
        parentKey: node.parentKey,
      };
      node.parentKey = '';
    }
  }

  for (const cycle of findParentCycles(nodes)) {
    for (const key of cycle) {
      const node = nodes.get(key);
      if (!node) continue;
      node.issue = {
        kind: 'circular-parent',
        parentKey: node.declaredParentKey,
      };
      node.parentKey = '';
    }
  }

  const roots: PluginParameterTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentKey ? nodes.get(node.parentKey) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return { roots, nodes };
}

export function flattenPluginParameterTree(
  tree: PluginParameterTree,
  expandedKeys: ReadonlySet<string>,
  query = '',
): VisiblePluginParameterTreeRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const includedKeys = normalizedQuery
    ? searchIncludedKeys(tree, normalizedQuery)
    : null;
  const result: VisiblePluginParameterTreeRow[] = [];

  const visit = (node: PluginParameterTreeNode, depth: number): void => {
    if (includedKeys && !includedKeys.has(node.key)) return;
    const visibleChildren = includedKeys
      ? node.children.filter((child) => includedKeys.has(child.key))
      : node.children;
    const expanded = normalizedQuery
      ? visibleChildren.length > 0
      : expandedKeys.has(node.key);
    result.push({
      ...node.row,
      depth,
      parentKey: node.parentKey,
      childKeys: visibleChildren.map((child) => child.key),
      hasChildren: node.children.length > 0,
      expanded,
      hierarchyIssue: node.issue,
    });
    if (!expanded) return;
    for (const child of visibleChildren) visit(child, depth + 1);
  };

  for (const root of tree.roots) visit(root, 0);
  return result;
}

function searchIncludedKeys(
  tree: PluginParameterTree,
  query: string,
): Set<string> {
  const included = new Set<string>();
  for (const node of tree.nodes.values()) {
    if (!rowSearchText(node.row).includes(query)) continue;
    includeAncestors(node, tree, included);
    includeDescendants(node, included);
  }
  return included;
}

function includeAncestors(
  node: PluginParameterTreeNode,
  tree: PluginParameterTree,
  included: Set<string>,
): void {
  let current: PluginParameterTreeNode | undefined = node;
  while (current && !included.has(current.key)) {
    included.add(current.key);
    current = current.parentKey ? tree.nodes.get(current.parentKey) : undefined;
  }
}

function includeDescendants(
  node: PluginParameterTreeNode,
  included: Set<string>,
): void {
  included.add(node.key);
  for (const child of node.children) includeDescendants(child, included);
}

function rowSearchText(row: PluginParameterRow): string {
  return [
    row.key,
    row.label,
    row.description,
    row.summary,
    row.fullValue,
  ].filter(Boolean).join('\n').toLocaleLowerCase();
}

function findParentCycles(
  nodes: Map<string, PluginParameterTreeNode>,
): string[][] {
  const cycles: string[][] = [];
  const recorded = new Set<string>();

  for (const start of nodes.values()) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: PluginParameterTreeNode | undefined = start;
    while (current) {
      const cycleStart = positions.get(current.key);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        const signature = [...cycle].sort().join('\u0000');
        if (!recorded.has(signature)) {
          recorded.add(signature);
          cycles.push(cycle);
        }
        break;
      }
      positions.set(current.key, path.length);
      path.push(current.key);
      current = current.parentKey ? nodes.get(current.parentKey) : undefined;
    }
  }
  return cycles;
}
