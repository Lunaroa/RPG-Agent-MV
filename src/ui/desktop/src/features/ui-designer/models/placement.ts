import type { UiDesignerDocument, UiNode } from '@contract/ui-designer'

const CASCADE_START = 24
const CASCADE_STEP = 24
const CASCADE_SLOTS = 10

export const nextSiblingCascadePosition = (
  document: UiDesignerDocument,
  node: Pick<UiNode, 'parentId' | 'props'>,
) => {
  const siblings = document.nodes.filter((candidate) => candidate.parentId === node.parentId)
  const slot = siblings.length % CASCADE_SLOTS
  const desired = CASCADE_START + slot * CASCADE_STEP
  const parent = node.parentId ? document.nodes.find((candidate) => candidate.id === node.parentId) : undefined
  const width = parent?.props.width ?? document.canvas.width
  const height = parent?.props.height ?? document.canvas.height
  return {
    x: Math.min(desired, Math.max(0, width - node.props.width)),
    y: Math.min(desired, Math.max(0, height - node.props.height)),
  }
}
