/** Build Windows-style breadcrumb crumbs from a project-relative directory and tree. */

export type ProjectAssetPathCrumb = {
  label: string
  /** Cumulative directory path for this crumb (e.g. img/pictures). */
  directory: string
  /** Matching browser node id when found in the tree; null if not navigable. */
  nodeId: string | null
}

export type ProjectAssetPathTreeNode = {
  id: string
  directory: string
  children?: ProjectAssetPathTreeNode[]
}

function findNodeByDirectory(
  nodes: readonly ProjectAssetPathTreeNode[],
  directory: string,
): ProjectAssetPathTreeNode | null {
  const normalized = directory.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  for (const node of nodes) {
    if (node.directory.replace(/\\/g, '/') === normalized) return node
    if (node.children?.length) {
      const found = findNodeByDirectory(node.children, normalized)
      if (found) return found
    }
  }
  return null
}

/**
 * Split `img/pictures/busts` into clickable crumbs with node ids when the tree contains that directory.
 */
export function buildProjectAssetPathCrumbs(
  directory: string,
  nodes: readonly ProjectAssetPathTreeNode[],
): ProjectAssetPathCrumb[] {
  const normalized = String(directory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return []
  const segments = normalized.split('/').filter(Boolean)
  const crumbs: ProjectAssetPathCrumb[] = []
  let cumulative = ''
  for (const segment of segments) {
    cumulative = cumulative ? `${cumulative}/${segment}` : segment
    const node = findNodeByDirectory(nodes, cumulative)
    crumbs.push({
      label: segment,
      directory: cumulative,
      nodeId: node?.id ?? null,
    })
  }
  return crumbs
}
